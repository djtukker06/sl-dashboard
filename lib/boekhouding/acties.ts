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
  naarImportBoeking,
  stelVoor,
  type AfschriftFormaat,
  type ImportBoeking,
  type Kolommapping
} from './kern/bankimport';
import { kiesbareCategorieen } from './model';
import { laadAlles, type BoekhoudRepo } from './repo/types';

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
  const vandaag = vandaagNL();
  const gezien = new Set<string>();
  const regels = afschrift.regels.map((r) => {
    let status: ImportRegelStatus = 'nieuw';
    let reden: string | null = null;
    if (sleutels.has(r.sleutel) || gezien.has(r.sleutel)) status = 'dubbel';
    else if (r.datum < '2000-01-01' || r.datum > plusDagen(vandaag, 1)) {
      status = 'buiten_bereik';
      reden = 'datum in de toekomst of te ver terug';
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
