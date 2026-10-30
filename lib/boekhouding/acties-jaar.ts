import 'server-only';
import { NextResponse } from 'next/server';
import { fout, json, leesJson, isUuid } from './api';
import { naarCenten, type Centen } from './kern/geld';
import { isKwartaal, jaarVan, kwartaalLabel, vandaagNL, type Kwartaal } from './kern/periode';
import { aangifteVoorKwartaal } from './kern/aangifte';
import { factuurLabel, uitgaveLabel } from './kern/bronnen';
import { parseAandelen, parseGrootboekInvoer, parseInstellingen, parseMemoriaalInvoer } from './kern/memoriaal';
import { boekingenCsv, journaalCsv, wvCsv, balansCsv, proefbalansCsv, kapitaalCsv } from './kern/csv';
import { proefbalansRapport, jaarBegin } from './kern/rapporten';
import { xafAuditfile } from './kern/xaf';
import { isBtwCode } from './kern/btw';
import { afsluitStatus, jaarrapport, jaarSamenvatting, rapportTot } from './jaarwerk';
import { aangifteHtml, jaarrapportHtml } from './pdf-template';
import { journaalVan, laadAlles, type BoekhoudRepo } from './repo/types';

// De acties achter de API van stap 4 (memoriaal, jaarafsluiting, instellingen, exports), los
// van de route-wrapper (bkRoute: teamcheck, herkomst, opslag kiezen, fouten vertalen).

/** Een jaartal uit de URL (2000–2999), anders null. */
export function leesJaar(v: string | null | undefined): number | null {
  if (!v || !/^\d{4}$/.test(v)) return null;
  const j = Number(v);
  return j >= 2000 && j <= 2999 ? j : null;
}

// ------------------------------------------------------------------ memoriaal
export async function memoriaalToevoegenActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const body = await leesJson(request);
  const stam = await repo.stamdata();
  const p = parseMemoriaalInvoer(body, stam, { vandaag: vandaagNL() });
  if (!p.ok) return json({ error: p.fout, veld: p.veld }, p.fout.includes('vergrendeld') || p.fout.includes('afgesloten') ? 409 : 400);
  const m = await repo.memoriaalToevoegen(p.waarde);
  return json({ memoriaal: m }, 201);
}

export async function memoriaalVerwijderenActie(repo: BoekhoudRepo, id: string | null): Promise<Response> {
  if (!isUuid(id)) return fout(400, 'Ongeldige memoriaalpost.');
  const lijst = await repo.memoriaal();
  const m = lijst.find((x) => x.id === id);
  if (!m) return fout(404, 'Deze memoriaalpost bestaat niet (meer).');
  if (m.soort === 'jaarafsluiting') return fout(400, 'Een jaarafsluiting maak je ongedaan door het boekjaar te heropenen.');
  await repo.memoriaalVerwijderen(id);
  return json({ ok: true });
}

// ------------------------------------------------------------------ jaarafsluiting
/**
 * Boekjaar afsluiten: de server controleert de checklist zelf (met de banksaldi volgens het
 * afschrift die de gebruiker invulde), berekent de afsluitpost en bewaart die samen met de
 * vergrendeling. `verwacht` = het resultaat dat de gebruiker zag; wijkt dat af, dan 409.
 */
export async function jaarAfsluitenActie(request: Request, repo: BoekhoudRepo, jaar: number): Promise<Response> {
  const body = await leesJson(request);
  const ruw = (body.banksaldi ?? {}) as Record<string, unknown>;
  const banksaldi: Record<string, Centen | null> = {};
  for (const [k, v] of Object.entries(typeof ruw === 'object' && ruw ? ruw : {})) {
    if (!isUuid(k)) continue;
    banksaldi[k] = typeof v === 'number' && Number.isSafeInteger(v) ? v : naarCenten(v);
  }
  const data = await laadAlles(repo);
  const posten = journaalVan(data);
  const st = afsluitStatus(data, posten, jaar, vandaagNL(), banksaldi);
  if (st.afgesloten) return fout(409, `Boekjaar ${jaar} is al afgesloten.`, 'bestaat_al');
  if (st.fout || !st.voorstel) return fout(400, st.fout ?? 'De afsluitpost kon niet worden berekend.');
  const open = st.controles.filter((c) => c.blokkeert && !c.ok);
  if (open.length) return json({ error: `Nog niet alles is in orde: ${open.map((c) => c.titel.toLowerCase()).join(', ')}.`, code: 'checklist', controles: st.controles, banksaldi: st.banksaldi }, 409);
  if (body.verwacht !== undefined && body.verwacht !== null && Number(body.verwacht) !== st.voorstel.resultaat) {
    return fout(409, 'De cijfers zijn intussen veranderd. Bekijk de afsluiting opnieuw.', 'gewijzigd');
  }
  const bj = await repo.jaarAfsluiten({
    jaar,
    omschrijving: `Jaarafsluiting ${jaar}: resultaat en privé naar kapitaal`,
    regels: st.voorstel.regels,
    samenvatting: jaarSamenvatting(data, posten, jaar, st.voorstel, st.banksaldi)
  });
  return json({ boekjaar: bj }, 201);
}

export async function jaarHeropenenActie(repo: BoekhoudRepo, jaar: number): Promise<Response> {
  const jaren = await repo.boekjaren();
  if (!jaren.some((j) => j.jaar === jaar)) return fout(404, 'Dit boekjaar is niet afgesloten.');
  if (jaren.some((j) => j.jaar > jaar)) return fout(409, 'Heropen eerst het latere boekjaar.', 'jaar_volgorde');
  await repo.jaarHeropenen(jaar);
  return json({ ok: true });
}

// ------------------------------------------------------------------ instellingen
export async function instellingenActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const p = parseInstellingen(await leesJson(request));
  if (!p.ok) return json({ error: p.fout, veld: p.veld }, 400);
  const inst = await repo.instellingenWijzigen(p.waarde);
  return json({ instellingen: inst });
}

export async function aandelenActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const stam = await repo.stamdata();
  const p = parseAandelen(await leesJson(request), stam);
  if (!p.ok) return json({ error: p.fout, veld: p.veld }, 400);
  await repo.aandelenWijzigen(p.waarde);
  return json({ ok: true });
}

export async function grootboekToevoegenActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const stam = await repo.stamdata();
  const p = parseGrootboekInvoer(await leesJson(request), stam);
  if (!p.ok) return json({ error: p.fout, veld: p.veld }, 400);
  const g = await repo.grootboekToevoegen(p.waarde);
  return json({ grootboek: g }, 201);
}

export async function grootboekWijzigenActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const body = await leesJson(request);
  const stam = await repo.stamdata();
  const g = stam.grootboek.find((x) => x.code === body.code);
  if (!g) return fout(404, 'Deze rekening bestaat niet (meer).');
  if (g.systeem) return fout(400, 'Dit is een vaste rekening van het systeem; die kun je niet wijzigen.', 'grootboek_systeem');
  const w: { naam?: string; actief?: boolean; btw?: ReturnType<typeof btwOfNull> } = {};
  if (body.naam !== undefined) {
    const naam = typeof body.naam === 'string' ? body.naam.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    if (!naam) return json({ error: 'Geef de categorie een naam.', veld: 'naam' }, 400);
    if (stam.grootboek.some((x) => x.code !== g.code && x.naam.toLowerCase() === naam.toLowerCase())) return json({ error: 'Die naam bestaat al.', veld: 'naam' }, 400);
    w.naam = naam;
  }
  if (body.actief !== undefined) {
    if (typeof body.actief !== 'boolean') return fout(400, 'Ongeldige waarde voor actief.');
    w.actief = body.actief;
  }
  if (body.btw !== undefined) {
    const b = btwOfNull(body.btw);
    if (b === undefined) return json({ error: 'Kies het standaard btw-tarief.', veld: 'btw' }, 400);
    w.btw = b;
  }
  const uit = await repo.grootboekWijzigen(g.code, w);
  return json({ grootboek: uit });
}

function btwOfNull(v: unknown) {
  if (v === null || v === '') return null;
  return isBtwCode(v) ? v : undefined;
}

// ------------------------------------------------------------------ exports
export const EXPORT_SOORTEN = ['boekingen', 'journaal', 'wv', 'balans', 'proefbalans', 'vennoten', 'xaf', 'pdf', 'aangifte'] as const;
export type ExportSoort = (typeof EXPORT_SOORTEN)[number];

function bestand(inhoud: string | Buffer, naam: string, type: string): Response {
  const body = typeof inhoud === 'string' ? inhoud : new Uint8Array(inhoud);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${naam}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

/**
 * GET /api/boekhouding/export?soort=…&jaar=JJJJ[&kw=1-4]
 *   boekingen | journaal | wv | balans | proefbalans | vennoten → CSV (Excel, puntkomma)
 *   xaf → XML Auditfile Financieel 3.2;  pdf → jaarrapport;  aangifte (&kw) → btw-aangifte als PDF.
 */
export async function exportActie(request: Request, repo: BoekhoudRepo): Promise<Response> {
  const url = new URL(request.url);
  const soort = url.searchParams.get('soort') as ExportSoort | null;
  if (!soort || !EXPORT_SOORTEN.includes(soort)) return fout(400, 'Onbekende export.');
  const vandaag = vandaagNL();
  const jaar = leesJaar(url.searchParams.get('jaar')) ?? jaarVan(vandaag);
  const data = await laadAlles(repo);
  const posten = journaalVan(data);
  const naam = data.stam.instellingen.bedrijfsnaam.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'boekhouding';
  const demo = repo.modus === 'demo' ? '-demo' : '';
  const csv = (inhoud: string, wat: string) => bestand(inhoud, `${naam}-${wat}-${jaar}${demo}.csv`, 'text/csv; charset=utf-8');
  const tot = rapportTot(jaar, vandaag);

  switch (soort) {
    case 'boekingen': {
      const facturen = new Map(data.facturen.map((f) => [f.id, f]));
      const uitgaven = new Map(data.uitgaven.map((u) => [u.id, u]));
      return csv(
        boekingenCsv({
          boekingen: data.boekingen,
          stam: data.stam,
          koppelingen: data.koppelingen,
          jaar,
          documentLabel: (k) => {
            if (k.bron === 'factuur') {
              const f = facturen.get(k.bronId);
              return f ? factuurLabel(f) : 'Factuur (verwijderd)';
            }
            const u = uitgaven.get(k.bronId);
            return u ? uitgaveLabel(u) : 'Bonnetje (verwijderd)';
          }
        }),
        'bankregels'
      );
    }
    case 'journaal':
      return csv(journaalCsv(posten, data.stam, jaarBegin(jaar), `${jaar}-12-31`), 'journaal');
    case 'wv':
      return csv(wvCsv(jaarrapport(data, posten, jaar, vandaag).wv), 'winst-en-verlies');
    case 'balans': {
      const r = jaarrapport(data, posten, jaar, vandaag);
      return csv(balansCsv(r.balansBegin, r.balansEind), 'balans');
    }
    case 'proefbalans':
      return csv(proefbalansCsv(proefbalansRapport(posten, data.stam.grootboek, jaarBegin(jaar), tot)), 'proefbalans');
    case 'vennoten':
      return csv(kapitaalCsv(jaarrapport(data, posten, jaar, vandaag).kapitaal), 'kapitaal-vennoten');
    case 'xaf': {
      const x = xafAuditfile({ stam: data.stam, posten, jaar, vandaag });
      return bestand(x.xml, `${naam}-auditfile-${jaar}${demo}.xaf`, 'application/xml; charset=utf-8');
    }
    case 'pdf': {
      const html = jaarrapportHtml({ inst: data.stam.instellingen, r: jaarrapport(data, posten, jaar, vandaag), vandaag, demo: repo.modus === 'demo' });
      const { renderPdf } = await import('../invoice/pdf');
      return bestand(await renderPdf(html), `${naam}-jaarrapport-${jaar}${demo}.pdf`, 'application/pdf');
    }
    case 'aangifte': {
      const kw = Number(url.searchParams.get('kw'));
      if (!isKwartaal(kw)) return fout(400, 'Kies een kwartaal.');
      const q = kw as Kwartaal;
      const aangifte = data.aangiften.find((a) => a.jaar === jaar && a.kwartaal === q) ?? null;
      // Ingediend: het overzicht zoals ingediend (de snapshot), niet een latere herberekening;
      // anders de eigen boekingen plus de correcties van eerdere kwartalen (zoals je invult).
      const getoond = aangifteVoorKwartaal(posten, data.aangiften, jaar, q).formulier;
      const html = aangifteHtml({ inst: data.stam.instellingen, ber: getoond, aangifte, vandaag, demo: repo.modus === 'demo' });
      const { renderPdf } = await import('../invoice/pdf');
      return bestand(await renderPdf(html), `${naam}-btw-${kwartaalLabel(jaar, q).replace(' ', '-').toLowerCase()}${demo}.pdf`, 'application/pdf');
    }
  }
}
