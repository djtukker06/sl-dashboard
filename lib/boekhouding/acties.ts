import 'server-only';
import { fout, isUuid, json, leesJson } from './api';
import { naarCenten } from './kern/geld';
import { isBtwCode } from './kern/btw';
import { plusDagen, vandaagNL, vergrendeldReden } from './kern/periode';
import { factuurPosten, koppelFout, koppelVergrendelFout, restVanBoeking, standaardBedrag, uitgavePosten } from './kern/afletteren';
import { isKoppelBron, type BronExtra } from './kern/bronnen';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_REGELS,
  isKolommapping,
  leesAfschrift,
  losGeboekteRegels,
  naarImportBoeking,
  neemLosGeboekt,
  stelVoor,
  type AfschriftFormaat,
  type ImportBoeking,
  type Kolommapping
} from './kern/bankimport';
import { kiesbareCategorieen } from './model';
import { BoekhoudFout, journaalVan, laadAlles, type BoekhoudRepo } from './repo/types';
import { aangifteRubrieken, betalingFout, naarSnapshot, teBetalenCenten } from './kern/aangifte';
import { activumAlsInvoer, activumVergrendelFout, parseActivumInvoer, type ActivumWaarde } from './kern/afschrijving';
import { activumBronFout, herkomstVan } from './kern/activeren';
import { isKwartaal, isVergrendeld, kwartaalGrenzen, kwartaalLabel, type Kwartaal } from './kern/periode';

// De acties achter de boekhoud-API (stap 2), los van de route-wrapper: de routes in
// app/api/boekhouding/** doen eerst de teamcheck en herkomstcontrole (bkRoute) en roepen dan
// deze functies aan met de gekozen opslag (live met RLS of de demo).

export type ImportRegelStatus = 'nieuw' | 'dubbel' | 'vergrendeld' | 'buiten_bereik';

const FORMATEN: AfschriftFormaat[] = ['regiobank', 'revolut', 'generiek'];

/**
 * Bankafschrift importeren. Zonder bevestig: voorbeeld (per regel nieuw/dubbel/vergrendeld +
 * voorstel voor soort, btw en categorie). Met bevestig: de nieuwe regels worden toegevoegd
 * met status "te verwerken". Een onbekend formaat geeft mappingNodig + kolommen.
 */
export async function importActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const body = await leesJson(request);
  if (!isUuid(body.rekeningId)) return json({ error: 'Kies de rekening van dit afschrift.', veld: 'rekeningId' }, 400);
  if (typeof body.tekst !== 'string' || !body.tekst.trim()) return json({ error: 'Kies een CSV-bestand.', veld: 'bestand' }, 400);
  if (body.tekst.length > MAX_IMPORT_BYTES) return json({ error: 'Dit bestand is te groot (maximaal 2 MB). Exporteer een kortere periode.', veld: 'bestand' }, 400);
  const bestandsnaam = typeof body.bestandsnaam === 'string' ? body.bestandsnaam.slice(0, 200) : 'afschrift.csv';
  const formaat = FORMATEN.includes(body.formaat as AfschriftFormaat) ? (body.formaat as AfschriftFormaat) : undefined;
  if (body.mapping !== undefined && body.mapping !== null && !isKolommapping(body.mapping)) return json({ error: 'Kies in elk geval de kolommen voor datum en bedrag.', veld: 'mapping' }, 400);

  const [stam, boekingen] = await Promise.all([repo.stamdata(), repo.boekingen()]);
  const rek = stam.rekeningen.find((r) => r.id === body.rekeningId && r.actief);
  if (!rek) return json({ error: 'Kies een bestaande, actieve rekening.', veld: 'rekeningId' }, 400);
  const onthouden = isKolommapping(rek.importMapping) ? (rek.importMapping as Kolommapping) : null;
  const mapping: Kolommapping | null = (body.mapping as Kolommapping | undefined) ?? (formaat === 'generiek' || (!formaat && rek.importFormaat === 'generiek') ? onthouden : null);

  const afschrift = leesAfschrift(body.tekst, { formaat, mapping });
  if (afschrift.regels.length > MAX_IMPORT_REGELS) return fout(400, `Maximaal ${MAX_IMPORT_REGELS} regels per keer. Exporteer een kortere periode.`);

  const sleutels = await repo.importSleutels(rek.id);
  const losGeboekt = losGeboekteRegels(boekingen, rek.id);
  const vandaag = vandaagNL();
  const gezien = new Set<string>();
  const regels = afschrift.regels.map((r) => {
    let status: ImportRegelStatus = 'nieuw';
    let reden: string | null = null;
    if (sleutels.has(r.sleutel) || gezien.has(r.sleutel)) status = 'dubbel';
    else if (neemLosGeboekt(losGeboekt, r)) {
      status = 'dubbel';
      reden = 'staat al in de boekhouding (handmatig ingevoerd of uit Excel overgenomen)';
    } else if (r.datum < '2000-01-01' || r.datum > plusDagen(vandaag, 1)) {
      status = 'buiten_bereik';
      reden = 'datum in de toekomst of te ver terug';
    } else if (rek.begindatum && r.datum < rek.begindatum) {
      // Het beginsaldo bevat deze mutatie al; meetellen zou dubbel zijn.
      status = 'buiten_bereik';
      reden = 'vóór het beginsaldo van deze rekening';
    } else {
      reden = vergrendeldReden(r.datum, stam.vergrendeling);
      if (reden) status = 'vergrendeld';
    }
    gezien.add(r.sleutel);
    const voorstel = stelVoor(r, boekingen, stam.rekeningen);
    return { regel: r, status, reden, voorstel, boeking: naarImportBoeking(r, rek.id, voorstel) };
  });
  const telling = {
    nieuw: regels.filter((r) => r.status === 'nieuw').length,
    dubbel: regels.filter((r) => r.status === 'dubbel').length,
    vergrendeld: regels.filter((r) => r.status === 'vergrendeld').length,
    buitenBereik: regels.filter((r) => r.status === 'buiten_bereik').length,
    overgeslagen: afschrift.overgeslagen.length
  };

  if (body.bevestig !== true) {
    return json({
      formaat: afschrift.formaat,
      kolommen: afschrift.kolommen,
      voorbeeld: afschrift.voorbeeld,
      mapping: afschrift.mapping,
      mappingNodig: afschrift.mappingNodig,
      ibanAnders: Boolean(afschrift.iban && rek.iban && afschrift.iban !== rek.iban),
      ibanBestand: afschrift.iban,
      overgeslagen: afschrift.overgeslagen.slice(0, 200),
      telling,
      regels: regels.slice(0, 1000).map((r) => ({
        rij: r.regel.rij,
        datum: r.regel.datum,
        bedrag: r.regel.bedrag,
        omschrijving: r.regel.omschrijving,
        tegenpartij: r.regel.tegenpartij,
        status: r.status,
        reden: r.reden,
        voorstel: { ...r.voorstel, soort: r.boeking.soort, btwCode: r.boeking.btwCode, grootboek: r.boeking.grootboek, btw: r.boeking.btw }
      }))
    });
  }

  if (afschrift.mappingNodig) return fout(400, 'Kies eerst welke kolommen de datum, het bedrag en de omschrijving bevatten.', 'mapping_nodig');
  const nieuw: ImportBoeking[] = regels.filter((r) => r.status === 'nieuw').map((r) => r.boeking);
  const uitkomst = nieuw.length ? await repo.importeer(rek.id, { bestandsnaam, formaat: afschrift.formaat }, nieuw) : { nieuw: 0, dubbel: 0 };
  if (body.onthoudMapping === true && afschrift.formaat === 'generiek' && afschrift.mapping) await repo.importMappingOpslaan(rek.id, afschrift.mapping);
  return json({
    nieuw: uitkomst.nieuw,
    dubbel: telling.dubbel + uitkomst.dubbel,
    vergrendeld: telling.vergrendeld,
    overgeslagen: telling.overgeslagen + telling.buitenBereik
  });}

/** Een bankregel afletteren tegen een factuur of bonnetje (deelbetaling kan). */
export async function koppelActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const body = await leesJson(request);
  if (!isUuid(body.boekingId)) return fout(400, 'Kies een bankregel.');
  if (!isKoppelBron(body.bron) || !isUuid(body.bronId)) return fout(400, 'Kies een factuur of bonnetje.');
  const data = await laadAlles(repo);
  const boeking = data.boekingen.find((b) => b.id === body.boekingId);
  if (!boeking) return fout(404, 'Deze boeking bestaat niet (meer).');
  if (data.activa.some((a) => a.boekingId === boeking.id)) {
    return fout(409, 'Deze bankregel is geactiveerd. Verwijder eerst het activum en activeer daarna het bonnetje (daar komen de kosten dan vandaan).', 'geactiveerd');
  }
  const vandaag = vandaagNL();
  const post =
    body.bron === 'factuur'
      ? factuurPosten(data.facturen.filter((f) => f.id === body.bronId), data.koppelingen, vandaag)[0]
      : uitgavePosten(data.uitgaven.filter((u) => u.id === body.bronId), data.koppelingen, vandaag)[0];
  if (!post) return fout(404, body.bron === 'factuur' ? 'Deze factuur bestaat niet (meer).' : 'Dit bonnetje bestaat niet (meer) of telt (nog) niet mee.');
  let bedrag: number | null;
  if (body.bedrag === undefined || body.bedrag === null || body.bedrag === '') bedrag = standaardBedrag(restVanBoeking(boeking, data.koppelingen), post.open);
  else bedrag = typeof body.bedrag === 'number' ? body.bedrag : naarCenten(body.bedrag);
  if (bedrag === null || !Number.isSafeInteger(bedrag)) return json({ error: 'Ongeldig bedrag.', veld: 'bedrag' }, 400);
  const f = koppelFout(boeking, { bron: body.bron, id: body.bronId, totaal: post.totaal, open: post.open }, bedrag, data.koppelingen, data.stam.vergrendeling);
  if (f) return koppelVergrendelFout(boeking, data.stam.vergrendeling) ? fout(409, f, 'periode_vergrendeld') : fout(400, f, 'koppeling_ongeldig');
  const koppeling = await repo.koppelingToevoegen({ boekingId: boeking.id, bron: body.bron, bronId: body.bronId, bedrag });
  return json({ koppeling }, 201);}

/** Ontkoppelen: de betaling staat weer los. */
export async function ontkoppelActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id');
  if (!isUuid(id)) return fout(404, 'Deze koppeling bestaat niet (meer).');
  const [koppelingen, boekingen, stam] = await Promise.all([repo.koppelingen(), repo.boekingen(), repo.stamdata()]);
  const k = koppelingen.find((x) => x.id === id);
  if (!k) return fout(404, 'Deze koppeling bestaat niet (meer).');
  const b = boekingen.find((x) => x.id === k.boekingId);
  const slot = b ? koppelVergrendelFout(b, stam.vergrendeling) : null;
  if (slot) return fout(409, slot, 'periode_vergrendeld');
  await repo.koppelingVerwijderen(id);
  return json({ ok: true });}

/** Verfijning van een factuur of bonnetje (btw-rubriek, categorie, vennoot) zonder het origineel te wijzigen. */
export async function bronExtraActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const body = await leesJson(request);
  if (!isKoppelBron(body.bron) || !isUuid(body.bronId)) return fout(400, 'Kies een factuur of bonnetje.');
  const [stam, bronnen, extra] = await Promise.all([repo.stamdata(), repo.bronnen(), repo.bronExtra()]);
  const doc = body.bron === 'factuur' ? bronnen.facturen.find((f) => f.id === body.bronId) : bronnen.uitgaven.find((u) => u.id === body.bronId);
  if (!doc) return fout(404, 'Dit document bestaat niet (meer).');
  const oud = extra.find((e) => e.bron === body.bron && e.bronId === body.bronId);
  const leeg = (v: unknown) => v === null || v === '' || v === undefined;

  let btwCode = oud?.btwCode ?? null;
  if (body.btwCode !== undefined) {
    if (leeg(body.btwCode)) btwCode = null;
    else if (!isBtwCode(body.btwCode) || (body.bron === 'factuur' && body.btwCode === 'geen')) return json({ error: 'Kies een geldig btw-tarief.', veld: 'btwCode' }, 400);
    else btwCode = body.btwCode;
  }
  let grootboek = oud?.grootboek ?? null;
  if (body.grootboek !== undefined) {
    if (leeg(body.grootboek)) grootboek = null;
    else if (!kiesbareCategorieen(stam.grootboek, body.bron === 'factuur' ? 'inkomst' : 'uitgave').some((g) => g.code === body.grootboek)) {
      return json({ error: 'Kies een geldige categorie.', veld: 'grootboek' }, 400);
    } else grootboek = String(body.grootboek);
  }
  let vennootId = oud?.vennootId ?? null;
  if (body.vennootId !== undefined) {
    if (leeg(body.vennootId)) vennootId = null;
    else if (!stam.vennoten.some((v) => v.id === body.vennootId && v.actief)) return json({ error: 'Kies een vennoot.', veld: 'vennootId' }, 400);
    else vennootId = String(body.vennootId);
  }
  const notitie = body.notitie !== undefined ? (typeof body.notitie === 'string' ? body.notitie.trim().slice(0, 2000) || null : null) : oud?.notitie ?? null;

  const nieuw: BronExtra = { bron: body.bron, bronId: body.bronId, btwCode, grootboek, vennootId, notitie };
  const financieel = (oud?.btwCode ?? null) !== btwCode || (oud?.grootboek ?? null) !== grootboek || (oud?.vennootId ?? null) !== vennootId;
  const slot = financieel && doc.datum ? vergrendeldReden(doc.datum, stam.vergrendeling) : null;
  if (slot) return fout(409, slot, 'periode_vergrendeld');
  const bronExtra = await repo.bronExtraOpslaan(nieuw);
  return json({ bronExtra });}


// ---------------------------------------------------------------------------------
// Stap 3: btw-aangifte (indienen, intrekken, betaling koppelen) en activa
// ---------------------------------------------------------------------------------
/** Jaar en kwartaal uit de route; null als ze ongeldig zijn. */
export function leesKwartaal(jaar: string, kw: string): { jaar: number; kwartaal: Kwartaal } | null {
  const j = Number(jaar);
  const q = Number(kw);
  if (!/^\d{4}$/.test(jaar) || j < 2000 || j > 2999 || !isKwartaal(q)) return null;
  return { jaar: j, kwartaal: q };
}

const vrijeTekst = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) || null : null);

/**
 * Markeer een kwartaal als ingediend. De server rekent de aangifte zelf uit (nooit de cijfers
 * van de browser overnemen) en bewaart die als snapshot; daarmee is het kwartaal vergrendeld.
 */
export async function indienenActie(request: Request, repo: BoekhoudRepo, kw: { jaar: number; kwartaal: Kwartaal }): Promise<Response> {
  const body = await leesJson(request);
  const { tot } = kwartaalGrenzen(kw.jaar, kw.kwartaal);
  if (vandaagNL() <= tot) return fout(400, `${kwartaalLabel(kw.jaar, kw.kwartaal)} loopt nog; je kunt pas na afloop aangifte doen.`, 'kwartaal_loopt');
  const data = await laadAlles(repo);
  if (data.aangiften.some((a) => a.jaar === kw.jaar && a.kwartaal === kw.kwartaal)) return fout(409, 'Dit kwartaal is al ingediend.', 'bestaat_al');
  if (data.stam.vergrendeling.boekjaren.includes(kw.jaar)) return fout(409, `Boekjaar ${kw.jaar} is afgesloten.`, 'periode_vergrendeld');
  const ber = aangifteRubrieken(journaalVan(data), kw.jaar, kw.kwartaal);
  // De browser stuurt mee wat de gebruiker zag; is er intussen iets veranderd, dan eerst opnieuw bekijken.
  if (body.verwacht !== undefined && body.verwacht !== null && Number(body.verwacht) !== teBetalenCenten(ber)) {
    return fout(409, 'De cijfers zijn intussen veranderd. Bekijk de aangifte opnieuw en dien dan in.', 'gewijzigd');
  }
  const aangifte = await repo.aangifteIndienen({
    jaar: kw.jaar,
    kwartaal: kw.kwartaal,
    snapshot: naarSnapshot(ber),
    teBetalen: teBetalenCenten(ber),
    kenmerk: vrijeTekst(body.kenmerk, 120),
    opmerking: vrijeTekst(body.opmerking, 2000)
  });
  return json({ aangifte }, 201);
}

/** Intrekken = het kwartaal weer openzetten (alleen de eigenaar; de route controleert dat). */
export async function intrekkenActie(repo: BoekhoudRepo, kw: { jaar: number; kwartaal: Kwartaal }): Promise<Response> {
  const [aangiften, stam] = await Promise.all([repo.aangiften(), repo.stamdata()]);
  const a = aangiften.find((x) => x.jaar === kw.jaar && x.kwartaal === kw.kwartaal);
  if (!a) return fout(404, 'Dit kwartaal is niet ingediend.');
  if (stam.vergrendeling.boekjaren.includes(kw.jaar)) return fout(409, `Boekjaar ${kw.jaar} is afgesloten; heropen eerst het boekjaar.`, 'periode_vergrendeld');
  await repo.aangifteIntrekken(a.id);
  return json({ ok: true });
}

/** Een btw-betaling (of teruggaaf) op de bank koppelen aan de ingediende aangifte. */
export async function aangifteBetalingActie(request: Request, repo: BoekhoudRepo, kw: { jaar: number; kwartaal: Kwartaal }): Promise<Response> {
  const body = await leesJson(request);
  if (!isUuid(body.boekingId)) return fout(400, 'Kies een bankregel.');
  const data = await laadAlles(repo);
  const a = data.aangiften.find((x) => x.jaar === kw.jaar && x.kwartaal === kw.kwartaal);
  if (!a) return fout(404, 'Dit kwartaal is niet ingediend.');
  const b = data.boekingen.find((x) => x.id === body.boekingId);
  if (!b) return fout(404, 'Deze boeking bestaat niet (meer).');
  if (data.aangifteBetalingen.some((x) => x.boekingId === b.id && x.aangifteId === a.id)) return fout(409, 'Deze betaling is al gekoppeld.', 'bestaat_al');
  const alGekoppeld = data.aangifteBetalingen.filter((x) => x.boekingId === b.id).reduce((t, x) => t + Math.abs(x.bedrag), 0);
  const betaald = data.aangifteBetalingen.filter((x) => x.aangifteId === a.id).reduce((t, x) => t + x.bedrag, 0);
  const teken = a.teBetalen < 0 ? -1 : 1;
  let bedrag: number | null;
  if (body.bedrag === undefined || body.bedrag === null || body.bedrag === '') {
    bedrag = teken * Math.min(b.bedrag - alGekoppeld, Math.max(0, Math.abs(a.teBetalen) - Math.abs(betaald)));
  } else bedrag = typeof body.bedrag === 'number' ? body.bedrag : naarCenten(body.bedrag);
  if (bedrag === null) return json({ error: 'Ongeldig bedrag.', veld: 'bedrag' }, 400);
  const f = betalingFout({ soort: b.soort, richting: b.richting, bankBedrag: b.bedrag, alGekoppeld, aangifte: a, bedrag });
  if (f) return fout(400, f, 'koppeling_ongeldig');
  const betaling = await repo.aangifteBetalingKoppelen({ boekingId: b.id, aangifteId: a.id, bedrag });
  return json({ betaling }, 201);
}

export async function aangifteBetalingLosActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id');
  if (!isUuid(id)) return fout(404, 'Deze koppeling bestaat niet (meer).');
  await repo.aangifteBetalingOntkoppelen(id);
  return json({ ok: true });
}

/** Controleert een activum (invoer, bron, vergrendeling); gooit een nette fout of geeft de waarde. */
async function controleerActivum(repo: BoekhoudRepo, body: Record<string, unknown>, eigenId: string | null): Promise<ActivumWaarde> {
  const data = await laadAlles(repo);
  const ctx = { boekingen: data.boekingen, uitgaven: data.uitgaven, koppelingen: data.koppelingen, bronExtra: data.bronExtra, activa: data.activa };
  const oud = eigenId ? data.activa.find((a) => a.id === eigenId) ?? null : null;
  if (eigenId && !oud) throw new BoekhoudFout(404, 'Dit activum bestaat niet (meer).', 'onbekend');
  const invoer = oud ? { ...activumAlsInvoer(oud), ...body } : { ...body };
  // Bij een bron: de aanschafdatum is de datum van de aankoop (zo valt de investering in het
  // juiste jaar); de ingebruikname mag later liggen.
  const h = herkomstVan({ boekingId: typeof invoer.boekingId === 'string' ? invoer.boekingId : null, uitgaveId: typeof invoer.uitgaveId === 'string' ? invoer.uitgaveId : null }, ctx);
  if (!h.ok) throw new BoekhoudFout(400, h.fout, 'herkomst');
  if (h.herkomst) {
    invoer.aanschafdatum = h.herkomst.datum;
    if (!invoer.ingebruikname) invoer.ingebruikname = h.herkomst.datum;
  }
  const p = parseActivumInvoer(invoer, { vandaag: vandaagNL() });
  if (!p.ok) throw Object.assign(new BoekhoudFout(400, p.fout, 'ongeldig'), { veld: p.veld });
  const bronFout = activumBronFout(p.waarde, ctx, eigenId);
  if (bronFout) throw new BoekhoudFout(400, bronFout, 'herkomst');
  const v = data.stam.vergrendeling;
  const slot = activumVergrendelFout(oud, p.waarde, { boekjaren: v.boekjaren, open: (d) => !isVergrendeld(d, v) });
  if (slot) throw new BoekhoudFout(409, slot, 'periode_vergrendeld');
  return p.waarde;
}

function activumFout(e: unknown): Response {
  if (e instanceof BoekhoudFout) {
    const veld = (e as BoekhoudFout & { veld?: string }).veld;
    return json(veld ? { error: e.message, code: e.code, veld } : { error: e.message, code: e.code }, e.status);
  }
  throw e;
}

export async function activumToevoegenActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const body = await leesJson(request);
  try {
    const w = await controleerActivum(repo, body, null);
    const activum = await repo.activumToevoegen(w);
    return json({ activum }, 201);
  } catch (e) {
    return activumFout(e);
  }
}

export async function activumWijzigenActie(request: Request, repo: BoekhoudRepo, id: string): Promise<Response> {
  const body = await leesJson(request);
  // De bron (bonnetje/bankregel) ligt vast na het aanmaken.
  delete body.uitgaveId;
  delete body.boekingId;
  try {
    const w = await controleerActivum(repo, body, id);
    const activum = await repo.activumWijzigen(id, w);
    return json({ activum });
  } catch (e) {
    return activumFout(e);
  }
}

export async function activumVerwijderenActie(repo: BoekhoudRepo, id: string): Promise<Response> {
  const [activa, stam] = await Promise.all([repo.activa(), repo.stamdata()]);
  const a = activa.find((x) => x.id === id);
  if (!a) return fout(404, 'Dit activum bestaat niet (meer).');
  const v = stam.vergrendeling;
  const slot = activumVergrendelFout(a, null, { boekjaren: v.boekjaren, open: (d) => !isVergrendeld(d, v) });
  if (slot) return fout(409, slot, 'periode_vergrendeld');
  await repo.activumVerwijderen(id);
  return json({ ok: true });
}
