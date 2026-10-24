// Memoriaal (vrije journaalposten voor de beginbalans en correcties) en de invoercontrole van
// de instellingen (bedrijfsgegevens, winstverdeling, eigen categorieën). Pure module.
//
// Een memoriaalpost moet sluiten (debet = credit) en mag niet op rekeningen die het systeem
// zelf bijhoudt: de bankrekeningen (die volgen het afschrift), debiteuren en crediteuren
// (die volgen facturen en bonnetjes) en de btw-rekeningen (die volgen de aangifte). Zo blijven
// de saldocontrole, het afletteren en de btw-aangifte kloppen.

import { MAX_CENTEN, naarCenten, som, type Centen } from './geld';
import { GB } from './constanten';
import { isBtwCode, type BtwCode } from './btw';
import { isDatum, plusDagen, vergrendeldReden, type Datum } from './periode';
import type { MemoriaalRegel } from './journaal';
import { winstverdeling } from './rapporten';
import type { Grootboekrekening, Stamdata } from '../model';

export type Uitkomst<T> = { ok: true; waarde: T } | { ok: false; fout: string; veld?: string };

export interface MemoriaalWaarde {
  datum: Datum;
  omschrijving: string;
  soort: 'beginbalans' | 'correctie';
  regels: MemoriaalRegel[];
}

/** De rekeningen die in een memoriaalpost mogen. */
export function memoriaalRekeningen(stam: Pick<Stamdata, 'grootboek' | 'rekeningen'>): Grootboekrekening[] {
  const bank = new Set(stam.rekeningen.map((r) => r.grootboek));
  const verboden = new Set<string>([GB.debiteuren, GB.crediteuren, GB.kas]);
  return stam.grootboek.filter((g) => g.actief && !bank.has(g.code) && !verboden.has(g.code) && g.rubriek !== 'btw');
}

const tekst = (v: unknown, max: number): string | null => (typeof v === 'string' && v.replace(/\s+/g, ' ').trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);

function centenVan(v: unknown): Centen | null {
  if (v === null || v === undefined || v === '') return 0;
  const c = typeof v === 'number' ? v : naarCenten(v);
  return c === null || !Number.isSafeInteger(c) || c < 0 || c > MAX_CENTEN ? null : c;
}

/** Controleert een memoriaalpost: datum in een open periode, ≥ 2 regels, elke regel één kant, sluitend. */
export function parseMemoriaalInvoer(body: Record<string, unknown>, stam: Stamdata, opties: { vandaag: Datum }): Uitkomst<MemoriaalWaarde> {
  if (!isDatum(body.datum)) return { ok: false, fout: 'Vul een geldige datum in.', veld: 'datum' };
  if (body.datum < '2000-01-01' || body.datum > plusDagen(opties.vandaag, 366)) return { ok: false, fout: 'Die datum valt buiten het bereik.', veld: 'datum' };
  const slot = vergrendeldReden(body.datum, stam.vergrendeling);
  if (slot) return { ok: false, fout: slot, veld: 'datum' };
  const omschrijving = tekst(body.omschrijving, 200);
  if (!omschrijving) return { ok: false, fout: 'Vul een omschrijving in.', veld: 'omschrijving' };
  const soort = body.soort === 'beginbalans' ? 'beginbalans' : body.soort === 'correctie' || body.soort === undefined ? 'correctie' : null;
  if (!soort) return { ok: false, fout: 'Kies beginbalans of correctie.', veld: 'soort' };
  if (!Array.isArray(body.regels)) return { ok: false, fout: 'Voeg regels toe.', veld: 'regels' };
  const toegestaan = new Map(memoriaalRekeningen(stam).map((g) => [g.code, g]));
  const vennoten = new Map(stam.vennoten.map((v) => [v.id, v]));
  const regels: MemoriaalRegel[] = [];
  for (const [i, ruw] of body.regels.entries()) {
    if (!ruw || typeof ruw !== 'object') return { ok: false, fout: `Regel ${i + 1} is ongeldig.`, veld: 'regels' };
    const r = ruw as Record<string, unknown>;
    const debet = centenVan(r.debet);
    const credit = centenVan(r.credit);
    if (debet === null || credit === null) return { ok: false, fout: `Regel ${i + 1}: ongeldig bedrag.`, veld: 'regels' };
    if (!debet && !credit && !r.grootboek) continue; // lege regel
    if (typeof r.grootboek !== 'string' || !toegestaan.has(r.grootboek)) {
      return { ok: false, fout: `Regel ${i + 1}: kies een rekening (bank, debiteuren, crediteuren en btw kunnen niet in het memoriaal).`, veld: 'regels' };
    }
    if ((debet > 0) === (credit > 0)) return { ok: false, fout: `Regel ${i + 1}: vul óf debet óf credit in.`, veld: 'regels' };
    // Kapitaal en privé horen bij een vennoot.
    const vennoot = stam.vennoten.find((v) => v.grootboekKapitaal === r.grootboek || v.grootboekPrive === r.grootboek);
    const vennootId = vennoot?.id ?? (typeof r.vennootId === 'string' && vennoten.has(r.vennootId) ? r.vennootId : null);
    regels.push({ grootboek: r.grootboek, debet, credit, vennootId, omschrijving: tekst(r.omschrijving, 200) });
  }
  if (regels.length < 2) return { ok: false, fout: 'Een memoriaalpost heeft minstens twee regels.', veld: 'regels' };
  if (regels.length > 200) return { ok: false, fout: 'Maximaal 200 regels.', veld: 'regels' };
  const d = som(regels.map((r) => r.debet));
  const c = som(regels.map((r) => r.credit));
  if (d !== c) return { ok: false, fout: 'De post sluit niet: debet en credit moeten even groot zijn.', veld: 'regels' };
  return { ok: true, waarde: { datum: body.datum, omschrijving, soort, regels } };
}

/**
 * Voorstel om het beginvermogen (saldo van 0900, creditsaldo = positief) te verdelen over de
 * kapitaalrekeningen naar winstaandeel. Leeg als er niets te verdelen is.
 */
export function beginvermogenVoorstel(onverdeeld: Centen, stam: Pick<Stamdata, 'vennoten'>): MemoriaalRegel[] {
  if (!onverdeeld) return [];
  const delen = winstverdeling(stam.vennoten, onverdeeld);
  if (!delen.length) return [];
  const regels: MemoriaalRegel[] = [onverdeeld > 0 ? { grootboek: GB.beginbalans, debet: onverdeeld, credit: 0 } : { grootboek: GB.beginbalans, debet: 0, credit: -onverdeeld }];
  for (const w of delen) {
    const v = stam.vennoten.find((x) => x.id === w.vennootId)!;
    if (w.bedrag) regels.push(w.bedrag > 0 ? { grootboek: v.grootboekKapitaal, debet: 0, credit: w.bedrag, vennootId: v.id } : { grootboek: v.grootboekKapitaal, debet: -w.bedrag, credit: 0, vennootId: v.id });
  }
  return regels;
}

// ---------------------------------------------------------------------------------
// Instellingen
// ---------------------------------------------------------------------------------
export interface InstellingenVelden {
  bedrijfsnaam?: string;
  kvk?: string | null;
  btwNummer?: string | null;
  startdatum?: Datum | null;
}

export function parseInstellingen(body: Record<string, unknown>): Uitkomst<InstellingenVelden> {
  const uit: InstellingenVelden = {};
  if (body.bedrijfsnaam !== undefined) {
    const n = tekst(body.bedrijfsnaam, 200);
    if (!n) return { ok: false, fout: 'Vul de bedrijfsnaam in.', veld: 'bedrijfsnaam' };
    uit.bedrijfsnaam = n;
  }
  if (body.kvk !== undefined) {
    const k = typeof body.kvk === 'string' ? body.kvk.replace(/\s/g, '') : '';
    if (k && !/^[0-9]{8}$/.test(k)) return { ok: false, fout: 'Een KvK-nummer heeft 8 cijfers.', veld: 'kvk' };
    uit.kvk = k || null;
  }
  if (body.btwNummer !== undefined) {
    const b = typeof body.btwNummer === 'string' ? body.btwNummer.replace(/[\s.]/g, '').toUpperCase() : '';
    if (b && !/^NL[0-9]{9}B[0-9]{2}$/.test(b)) return { ok: false, fout: 'Een btw-identificatienummer ziet eruit als NL123456789B01.', veld: 'btwNummer' };
    uit.btwNummer = b || null;
  }
  if (body.startdatum !== undefined) {
    if (body.startdatum === null || body.startdatum === '') uit.startdatum = null;
    else if (!isDatum(body.startdatum)) return { ok: false, fout: 'Ongeldige startdatum.', veld: 'startdatum' };
    else uit.startdatum = body.startdatum;
  }
  return { ok: true, waarde: uit };
}

/** Winstaandelen: per actieve vennoot 0–100 (max. 2 decimalen), samen precies 100. */
export function parseAandelen(body: Record<string, unknown>, stam: Pick<Stamdata, 'vennoten'>): Uitkomst<{ id: string; aandeel: number }[]> {
  if (!Array.isArray(body.aandelen)) return { ok: false, fout: 'Geef de winstaandelen op.', veld: 'aandelen' };
  const uit: { id: string; aandeel: number }[] = [];
  for (const x of body.aandelen) {
    const r = (x ?? {}) as Record<string, unknown>;
    const v = stam.vennoten.find((y) => y.id === r.id);
    if (!v) return { ok: false, fout: 'Onbekende vennoot.', veld: 'aandelen' };
    const n = typeof r.aandeel === 'number' ? r.aandeel : typeof r.aandeel === 'string' ? Number(r.aandeel.replace(',', '.')) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > 100 || Math.round(n * 100) !== n * 100) return { ok: false, fout: `Ongeldig aandeel voor ${v.naam} (0–100%).`, veld: 'aandelen' };
    uit.push({ id: v.id, aandeel: n });
  }
  const somAandelen = stam.vennoten.filter((v) => v.actief).reduce((t, v) => t + Math.round((uit.find((u) => u.id === v.id)?.aandeel ?? v.aandeel) * 100), 0);
  if (somAandelen !== 10000) return { ok: false, fout: `De aandelen tellen op tot ${somAandelen / 100}%; dat moet 100% zijn.`, veld: 'aandelen' };
  return { ok: true, waarde: uit };
}

export interface GrootboekVelden {
  code: string;
  naam: string;
  soort: 'kosten' | 'opbrengst';
  btw: BtwCode | null;
}

/** Een eigen categorie: kosten (4000–4999) of opbrengst (8000–8999), met een vrije code. */
export function parseGrootboekInvoer(body: Record<string, unknown>, stam: Pick<Stamdata, 'grootboek'>): Uitkomst<GrootboekVelden> {
  const soort = body.soort === 'opbrengst' ? 'opbrengst' : body.soort === 'kosten' ? 'kosten' : null;
  if (!soort) return { ok: false, fout: 'Kies kosten of opbrengst.', veld: 'soort' };
  const naam = tekst(body.naam, 120);
  if (!naam) return { ok: false, fout: 'Geef de categorie een naam.', veld: 'naam' };
  if (stam.grootboek.some((g) => g.naam.toLowerCase() === naam.toLowerCase())) return { ok: false, fout: 'Die naam bestaat al.', veld: 'naam' };
  const btw = body.btw === null || body.btw === undefined || body.btw === '' ? null : isBtwCode(body.btw) ? body.btw : undefined;
  if (btw === undefined) return { ok: false, fout: 'Kies het standaard btw-tarief.', veld: 'btw' };
  let code = typeof body.code === 'string' ? body.code.trim() : '';
  const [min, max] = soort === 'kosten' ? [4000, 4999] : [8000, 8999];
  if (code) {
    if (!/^\d{4}$/.test(code) || Number(code) < min || Number(code) > max) return { ok: false, fout: `De code moet tussen ${min} en ${max} liggen.`, veld: 'code' };
    if (stam.grootboek.some((g) => g.code === code)) return { ok: false, fout: 'Die code bestaat al.', veld: 'code' };
  } else {
    const bezet = new Set(stam.grootboek.map((g) => g.code));
    let c = min + 10;
    while (c <= max && bezet.has(String(c))) c += 10;
    if (c > max) return { ok: false, fout: 'Geen vrije code meer.', veld: 'code' };
    code = String(c);
  }
  return { ok: true, waarde: { code, naam, soort, btw } };
}
