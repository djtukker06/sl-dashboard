// Bankafschriften inlezen (CSV). Pure module: geen netwerk, geen klok, geen '@/'-imports.
//
// Formaten:
//   - RegioBank (De Volksbank, zelfde platform als SNS/ASN): CSV zonder kopregel, komma of
//     puntkomma, datum dd-mm-jjjj, bedrag met teken en punt. Kolommen (0-based) volgens de
//     Volksbank-export: 0 boekdatum · 1 eigen IBAN · 2 tegenrekening · 3 naam tegenpartij ·
//     10 bedrag · 15 volgnummer · 16 betalingskenmerk · 17 omschrijving.
//     NIET GEVERIFIEERD met een echte export: wijkt die af, dan vangt de kolomkeuze het op.
//   - Revolut (Business en persoonlijk): kopregel met o.a. "Date completed (UTC)" of
//     "Completed Date", Description, Amount, Fee, Currency, State, ID. Alleen COMPLETED;
//     een Fee wordt een eigen regel (bankkosten, geen btw). Kolommen herkennen we op naam.
//   - Generiek: elke CSV met een kolomkeuze (datum, bedrag of af/bij, omschrijving, …).
//
// Dubbele regels: elke regel krijgt een importsleutel (bank-ID of volgnummer, anders een hash
// van datum|bedrag|omschrijving|tegenrekening plus het hoeveelste gelijke exemplaar). De
// database weigert dezelfde sleutel twee keer per rekening (unieke index), dus opnieuw
// importeren voegt niets toe.

import { MAX_CENTEN, naarCenten, type Centen } from './geld';
import { isDatum, maakDatum, type Datum } from './periode';
import type { BtwCode } from './btw';
import { GB } from './constanten';
import { berekenBoeking, standaardRichting, type Boeking, type BoekingSoort, type BoekingWaarde, type Rekening } from '../model';

export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_IMPORT_REGELS = 5000;

// ---------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------
/** Raadt het scheidingsteken aan de eerste regels (buiten aanhalingstekens). */
export function raadScheiding(tekst: string): string {
  const regels = tekst.split(/\r?\n/).filter((r) => r.trim()).slice(0, 10);
  let beste = ',';
  let hoogst = 0;
  for (const s of [';', ',', '\t']) {
    const tellingen = regels.map((r) => {
      let n = 0;
      let q = false;
      for (const ch of r) {
        if (ch === '"') q = !q;
        else if (ch === s && !q) n++;
      }
      return n;
    });
    const min = Math.min(...tellingen);
    // Een consistent aantal per regel weegt het zwaarst.
    const score = min > 0 ? min * 10 + (tellingen.every((t) => t === tellingen[0]) ? 5 : 0) : 0;
    if (score > hoogst) {
      hoogst = score;
      beste = s;
    }
  }
  return beste;
}

/** RFC 4180-achtige CSV-parser (aanhalingstekens, "" als escape, regeleinden in velden). */
export function leesCsv(tekst: string, scheiding = raadScheiding(tekst)): string[][] {
  const t = tekst.replace(/^﻿/, '');
  const rijen: string[][] = [];
  let rij: string[] = [];
  let veld = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          veld += '"';
          i++;
        } else q = false;
      } else veld += ch;
    } else if (ch === '"' && veld === '') q = true;
    else if (ch === scheiding) {
      rij.push(veld);
      veld = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      rij.push(veld);
      if (rij.some((v) => v.trim() !== '')) rijen.push(rij);
      rij = [];
      veld = '';
    } else veld += ch;
  }
  rij.push(veld);
  if (rij.some((v) => v.trim() !== '')) rijen.push(rij);
  return rijen.map((r) => r.map((v) => v.trim()));
}

/** "24-10-2026", "24/10/2026", "2026-10-24", "2026-10-24 13:05:00", "20261024" → Datum. */
export function leesDatum(v: string): Datum | null {
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return geldig(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T].*)?$/.exec(s);
  if (m) return geldig(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return geldig(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}
function geldig(j: number, m: number, d: number): Datum | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const x = maakDatum(j, m, d);
  return isDatum(x) ? x : null;
}

/** Bedrag uit een bankexport: "-12.50", "12,50", "1.234,56", "€ -3,00". */
export function leesBedrag(v: string): Centen | null {
  const c = naarCenten(v.replace(/\s/g, ''));
  return c === null || Math.abs(c) > MAX_CENTEN ? null : c;
}

/** Deterministische hash (cyrb53) als hex: genoeg om dubbele regels te herkennen. */
export function hash(tekst: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < tekst.length; i++) {
    const ch = tekst.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------
// Formaten
// ---------------------------------------------------------------------------------
export type AfschriftFormaat = 'regiobank' | 'revolut' | 'generiek';

/** Kolomkeuze voor een onbekend (generiek) formaat; indexen zijn 0-based, null = geen. */
export interface Kolommapping {
  heeftKop: boolean;
  datum: number;
  /** Eén kolom met een bedrag met teken … */
  bedrag: number | null;
  /** … of een kolom "Af/Bij" (of D/C) naast een bedrag zonder teken. */
  afBij: number | null;
  omschrijving: number[];
  tegenpartij: number | null;
  tegenrekening: number | null;
  sleutel: number | null;
}

export interface ImportRegel {
  /** Regelnummer in het bestand (1-based, voor meldingen). */
  rij: number;
  datum: Datum;
  /** Mutatie met teken: + bij, − af. */
  bedrag: Centen;
  omschrijving: string;
  tegenpartij: string | null;
  tegenrekening: string | null;
  kenmerk: string | null;
  sleutel: string;
  /** Bankkosten (Revolut Fee): altijd uitgave 4900 zonder btw. */
  bankkosten?: boolean;
}

export interface Afschrift {
  formaat: AfschriftFormaat;
  regels: ImportRegel[];
  overgeslagen: { rij: number; reden: string }[];
  /** Kolomnamen (kopregel) of "Kolom 1", … voor de kolomkeuze. */
  kolommen: string[];
  /** Eerste rijen ter illustratie bij de kolomkeuze. */
  voorbeeld: string[][];
  /** Eigen IBAN uit het bestand (RegioBank), voor de controle op de juiste rekening. */
  iban: string | null;
  mapping: Kolommapping | null;
  /** Kon het formaat niet worden gelezen: de kolomkeuze is nodig. */
  mappingNodig: boolean;
}

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/;
const kaleIban = (v: string | undefined) => (v ?? '').replace(/\s/g, '').toUpperCase();

function isRegioBank(rijen: string[][]): boolean {
  const r = rijen[0];
  return Boolean(r && r.length >= 18 && leesDatum(r[0]) && IBAN.test(kaleIban(r[1])) && leesBedrag(r[10]) !== null);
}

function kopIndex(kop: string[], ...patronen: RegExp[]): number {
  for (const p of patronen) {
    const i = kop.findIndex((k) => p.test(k.trim()));
    if (i >= 0) return i;
  }
  return -1;
}

function isRevolut(kop: string[]): boolean {
  return kopIndex(kop, /^date completed/i, /^completed date$/i) >= 0 && kopIndex(kop, /^amount$/i) >= 0 && kopIndex(kop, /^state$/i) >= 0;
}

/** Herkent het formaat aan de kopregel of de vorm van de regels. */
export function herkenFormaat(rijen: string[][]): AfschriftFormaat {
  if (!rijen.length) return 'generiek';
  if (isRevolut(rijen[0])) return 'revolut';
  if (isRegioBank(rijen)) return 'regiobank';
  return 'generiek';
}

/** Een eerste gok voor de kolomkeuze op basis van de kopregel (of de inhoud). */
export function raadMapping(rijen: string[][]): Kolommapping {
  const eerste = rijen[0] ?? [];
  const heeftKop = !eerste.some((v) => leesDatum(v)) && eerste.some((v) => /[a-z]/i.test(v));
  const kop = heeftKop ? eerste : [];
  const data = rijen[heeftKop ? 1 : 0] ?? [];
  const zoek = (...p: RegExp[]) => (heeftKop ? kopIndex(kop, ...p) : -1);
  let datum = zoek(/^(boek|transactie|rente)?datum/i, /date/i);
  if (datum < 0) datum = Math.max(0, data.findIndex((v) => leesDatum(v)));
  let bedrag = zoek(/^bedrag/i, /^amount$/i, /bedrag/i, /amount/i);
  if (bedrag < 0) bedrag = data.findIndex((v, i) => i !== datum && /[.,]\d{2}$/.test(v) && leesBedrag(v) !== null);
  const afBij = zoek(/^af.?bij$/i, /debet.?credit/i, /^(d\/c|c\/d)$/i);
  const oms = [zoek(/omschrijving|mededeling|description|reference|kenmerk/i)].filter((i) => i >= 0);
  const tegenpartij = zoek(/naam|tegenpartij|counterparty|payee|payer/i);
  const tegenrekening = zoek(/tegenrekening|iban/i);
  return {
    heeftKop,
    datum,
    bedrag: bedrag >= 0 ? bedrag : null,
    afBij: afBij >= 0 ? afBij : null,
    omschrijving: oms.length ? oms : tegenpartij >= 0 ? [tegenpartij] : [],
    tegenpartij: tegenpartij >= 0 ? tegenpartij : null,
    tegenrekening: tegenrekening >= 0 ? tegenrekening : null,
    sleutel: null
  };
}

export function isKolommapping(v: unknown): v is Kolommapping {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  const idx = (x: unknown) => x === null || (Number.isInteger(x) && (x as number) >= 0 && (x as number) < 100);
  return (
    typeof m.heeftKop === 'boolean' &&
    Number.isInteger(m.datum) &&
    (m.datum as number) >= 0 &&
    (m.datum as number) < 100 &&
    idx(m.bedrag) &&
    idx(m.afBij) &&
    Array.isArray(m.omschrijving) &&
    m.omschrijving.length <= 5 &&
    m.omschrijving.every((x) => idx(x) && x !== null) &&
    idx(m.tegenpartij) &&
    idx(m.tegenrekening) &&
    idx(m.sleutel) &&
    m.bedrag !== null
  );
}

const kort = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const schoon = (t: string | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();

type RuweRegel = Omit<ImportRegel, 'sleutel'> & { sleutel?: string };

/** Maakt de sleutels uniek: gelijke regels zonder bank-ID krijgen een volgnummer. */
function metSleutels(regels: RuweRegel[], voorvoegsel: string): ImportRegel[] {
  const teller = new Map<string, number>();
  return regels.map((r) => {
    if (r.sleutel) return { ...r, sleutel: r.sleutel };
    const basis = `${r.datum}|${r.bedrag}|${r.omschrijving.toLowerCase()}|${r.tegenrekening ?? ''}`;
    const n = (teller.get(basis) ?? 0) + 1;
    teller.set(basis, n);
    return { ...r, sleutel: `${voorvoegsel}h:${hash(basis)}:${n}` };
  });
}

/**
 * Leest een bankafschrift. `formaat` dwingt een formaat af; zonder herkennen we het. Bij een
 * generiek formaat is een kolomkeuze nodig (`mapping`; anders een gok en mappingNodig).
 */
export function leesAfschrift(tekst: string, opties: { formaat?: AfschriftFormaat; mapping?: Kolommapping | null } = {}): Afschrift {
  const rijen = leesCsv(tekst).slice(0, MAX_IMPORT_REGELS + 1);
  const formaat: AfschriftFormaat = opties.formaat ?? (opties.mapping ? 'generiek' : herkenFormaat(rijen));
  const overgeslagen: Afschrift['overgeslagen'] = [];
  const breedte = Math.max(0, ...rijen.slice(0, 20).map((r) => r.length));
  const kolomNamen = (kop: string[] | null) => Array.from({ length: breedte }, (_, i) => (kop?.[i] ? kop[i] : `Kolom ${i + 1}`));

  if (formaat === 'revolut' && rijen.length && isRevolut(rijen[0])) {
    const kop = rijen[0];
    const k = {
      datum: kopIndex(kop, /^date completed/i, /^completed date$/i),
      start: kopIndex(kop, /^date started/i, /^started date$/i),
      id: kopIndex(kop, /^id$/i),
      state: kopIndex(kop, /^state$/i),
      oms: kopIndex(kop, /^description$/i),
      ref: kopIndex(kop, /^reference$/i),
      payer: kopIndex(kop, /^payer$/i),
      bedrag: kopIndex(kop, /^amount$/i),
      fee: kopIndex(kop, /^fee$/i),
      valuta: kopIndex(kop, /^payment currency$/i, /^currency$/i),
      iban: kopIndex(kop, /^beneficiary iban$/i)
    };
    const regels: RuweRegel[] = [];
    rijen.slice(1).forEach((r, i) => {
      const rij = i + 2;
      const state = (r[k.state] ?? '').toUpperCase();
      if (state !== 'COMPLETED') {
        overgeslagen.push({ rij, reden: state ? `status ${state.toLowerCase()}` : 'geen status' });
        return;
      }
      const valuta = k.valuta >= 0 ? (r[k.valuta] ?? '').toUpperCase() : 'EUR';
      if (valuta && valuta !== 'EUR') {
        overgeslagen.push({ rij, reden: `in ${valuta} (alleen euro's)` });
        return;
      }
      const datum = leesDatum(r[k.datum] ?? '') ?? (k.start >= 0 ? leesDatum(r[k.start] ?? '') : null);
      const bedrag = leesBedrag(r[k.bedrag] ?? '');
      if (!datum || bedrag === null) {
        overgeslagen.push({ rij, reden: 'datum of bedrag onleesbaar' });
        return;
      }
      const id = k.id >= 0 ? schoon(r[k.id]) : '';
      const oms = schoon(r[k.oms]);
      const ref = k.ref >= 0 ? schoon(r[k.ref]) : '';
      const tegenpartij = (k.payer >= 0 ? schoon(r[k.payer]) : '') || oms || null;
      const omschrijving = kort([oms, ref && ref !== oms ? ref : ''].filter(Boolean).join(' · ') || 'Revolut', 200);
      const iban = k.iban >= 0 ? kaleIban(r[k.iban]) : '';
      if (bedrag !== 0) {
        regels.push({ rij, datum, bedrag, omschrijving, tegenpartij: tegenpartij ? kort(tegenpartij, 200) : null, tegenrekening: IBAN.test(iban) ? iban : null, kenmerk: ref || null, sleutel: id ? `rv:${id}` : undefined });
      }
      const fee = k.fee >= 0 ? leesBedrag(r[k.fee] ?? '') : null;
      if (fee) {
        regels.push({
          rij,
          datum,
          bedrag: -Math.abs(fee),
          omschrijving: kort(`Revolut kosten · ${oms || 'transactie'}`, 200),
          tegenpartij: 'Revolut',
          tegenrekening: null,
          kenmerk: null,
          sleutel: id ? `rv:${id}:fee` : undefined,
          bankkosten: true
        });
      }
    });
    return { formaat, regels: metSleutels(regels, 'rv:'), overgeslagen, kolommen: kolomNamen(kop), voorbeeld: rijen.slice(1, 4), iban: null, mapping: null, mappingNodig: false };
  }

  if (formaat === 'regiobank' && isRegioBank(rijen)) {
    const regels: RuweRegel[] = [];
    rijen.forEach((r, i) => {
      const rij = i + 1;
      const datum = leesDatum(r[0] ?? '');
      const bedrag = leesBedrag(r[10] ?? '');
      if (!datum || bedrag === null) {
        overgeslagen.push({ rij, reden: 'datum of bedrag onleesbaar' });
        return;
      }
      if (bedrag === 0) {
        overgeslagen.push({ rij, reden: 'bedrag € 0' });
        return;
      }
      const naam = schoon(r[3]);
      const oms = schoon(r[17]);
      const kenmerk = schoon(r[16]);
      const tegen = kaleIban(r[2]);
      const volgnummer = schoon(r[15]);
      regels.push({
        rij,
        datum,
        bedrag,
        omschrijving: kort(oms || naam || 'RegioBank', 200),
        tegenpartij: naam ? kort(naam, 200) : null,
        tegenrekening: IBAN.test(tegen) ? tegen : null,
        kenmerk: kenmerk ? kort(kenmerk, 120) : null,
        sleutel: volgnummer ? `rb:${volgnummer}` : undefined
      });
    });
    const iban = kaleIban(rijen[0]?.[1]);
    return { formaat, regels: metSleutels(regels, 'rb:'), overgeslagen, kolommen: kolomNamen(null), voorbeeld: rijen.slice(0, 3), iban: IBAN.test(iban) ? iban : null, mapping: null, mappingNodig: false };
  }

  // Generiek: met de kolomkeuze (of een gok).
  const mapping = opties.mapping ?? raadMapping(rijen);
  const geldigeMapping = isKolommapping(mapping);
  const kop = mapping.heeftKop ? rijen[0] : null;
  const data = mapping.heeftKop ? rijen.slice(1) : rijen;
  const regels: RuweRegel[] = [];
  if (geldigeMapping) {
    data.forEach((r, i) => {
      const rij = i + (mapping.heeftKop ? 2 : 1);
      const datum = leesDatum(r[mapping.datum] ?? '');
      let bedrag = mapping.bedrag !== null ? leesBedrag(r[mapping.bedrag] ?? '') : null;
      if (bedrag !== null && mapping.afBij !== null) {
        const ab = (r[mapping.afBij] ?? '').trim().toLowerCase();
        const af = /^(af|d|debet|debit|-)$/.test(ab);
        bedrag = af ? -Math.abs(bedrag) : Math.abs(bedrag);
      }
      if (!datum || bedrag === null) {
        overgeslagen.push({ rij, reden: 'datum of bedrag onleesbaar' });
        return;
      }
      if (bedrag === 0) {
        overgeslagen.push({ rij, reden: 'bedrag € 0' });
        return;
      }
      const oms = mapping.omschrijving.map((c) => schoon(r[c])).filter(Boolean).join(' · ');
      const naam = mapping.tegenpartij !== null ? schoon(r[mapping.tegenpartij]) : '';
      const tegen = mapping.tegenrekening !== null ? kaleIban(r[mapping.tegenrekening]) : '';
      const sleutel = mapping.sleutel !== null ? schoon(r[mapping.sleutel]) : '';
      regels.push({
        rij,
        datum,
        bedrag,
        omschrijving: kort(oms || naam || 'Bankregel', 200),
        tegenpartij: naam ? kort(naam, 200) : null,
        tegenrekening: IBAN.test(tegen) ? tegen : null,
        kenmerk: null,
        sleutel: sleutel ? `g:${kort(sleutel, 100)}` : undefined
      });
    });
  }
  const mappingNodig = !opties.mapping && (!geldigeMapping || regels.length === 0 || overgeslagen.length > regels.length);
  return {
    formaat: 'generiek',
    regels: metSleutels(regels, 'g:'),
    overgeslagen,
    kolommen: kolomNamen(kop),
    voorbeeld: data.slice(0, 3),
    iban: null,
    mapping,
    mappingNodig
  };
}

// ---------------------------------------------------------------------------------
// Voorstel per regel: soort, categorie en btw (uit de geschiedenis)
// ---------------------------------------------------------------------------------
export interface ImportVoorstel {
  soort: BoekingSoort;
  btwCode: BtwCode;
  grootboek: string | null;
  vennootId: string | null;
  /** Waar het voorstel vandaan komt (voor de uitleg). */
  bron: 'eigen_rekening' | 'geschiedenis' | 'belastingdienst' | 'bankkosten' | 'standaard';
}

const norm = (t: string | null | undefined) =>
  (t ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(bv|b v|nv|vof|ltd|gmbh|inc)\b/g, '')
    .trim();

/** Een vergelijkingssleutel voor de tegenpartij: de eerste twee woorden zonder getallen. */
export function partijSleutel(t: string | null | undefined): string {
  return norm(t)
    .split(' ')
    .filter((w) => w && !/\d/.test(w))
    .slice(0, 2)
    .join(' ');
}

/**
 * Stelt per geïmporteerde regel de soort, btw en categorie voor:
 *   1. tegenrekening is een eigen rekening → overboeking;
 *   2. Revolut-fee → bankkosten (4900, geen btw);
 *   3. dezelfde tegenrekening of tegenpartij eerder geboekt → dezelfde soort/btw/categorie;
 *   4. Belastingdienst → btw-aangifte;
 *   5. anders: bij → inkomst omzet 21%, af → uitgave overige kosten 21%.
 */
export function stelVoor(r: ImportRegel, geschiedenis: readonly Boeking[], rekeningen: readonly Rekening[]): ImportVoorstel {
  const richting = r.bedrag > 0 ? 'bij' : 'af';
  if (r.tegenrekening && rekeningen.some((x) => x.iban && x.iban === r.tegenrekening)) {
    return { soort: 'overboeking', btwCode: 'geen', grootboek: null, vennootId: null, bron: 'eigen_rekening' };
  }
  if (r.bankkosten) return { soort: 'uitgave', btwCode: 'geen', grootboek: '4900', vennootId: null, bron: 'bankkosten' };
  const sleutel = partijSleutel(r.tegenpartij || r.omschrijving);
  const oms = partijSleutel(r.omschrijving);
  let beste: Boeking | null = null;
  for (const b of geschiedenis) {
    if (b.richting !== richting) continue;
    const zelfde =
      (r.tegenrekening && b.tegenrekening === r.tegenrekening) ||
      (sleutel && partijSleutel(b.tegenpartij || b.omschrijving) === sleutel) ||
      (oms && partijSleutel(b.omschrijving) === oms);
    if (!zelfde) continue;
    if (!beste || b.datum > beste.datum) beste = b;
  }
  if (beste) {
    return { soort: beste.soort, btwCode: beste.btwCode, grootboek: beste.grootboek, vennootId: beste.vennootId, bron: 'geschiedenis' };
  }
  if (/belastingdienst/i.test(`${r.tegenpartij ?? ''} ${r.omschrijving}`)) {
    return { soort: 'btw', btwCode: 'geen', grootboek: null, vennootId: null, bron: 'belastingdienst' };
  }
  return richting === 'bij'
    ? { soort: 'inkomst', btwCode: '21', grootboek: GB.omzet, vennootId: null, bron: 'standaard' }
    : { soort: 'uitgave', btwCode: '21', grootboek: GB.overigeKosten, vennootId: null, bron: 'standaard' };
}

/**
 * Bankregels die al los in de boekhouding staan (handmatig ingevoerd of uit de Excel-jaarrekening
 * overgenomen: geen import_id) op deze rekening, geteld per datum|bankmutatie. Zo'n regel heeft
 * een andere importsleutel dan dezelfde regel in een CSV-afschrift; zonder deze controle komt de
 * betaling er bij het importeren van het afschrift een tweede keer in.
 */
export function losGeboekteRegels(boekingen: readonly Boeking[], rekeningId: string): Map<string, number> {
  const teller = new Map<string, number>();
  for (const b of boekingen) {
    if (b.rekeningId !== rekeningId || b.importId !== null) continue;
    const k = `${b.datum}|${berekenBoeking(b).bankMutatie}`;
    teller.set(k, (teller.get(k) ?? 0) + 1);
  }
  return teller;
}

/**
 * Staat deze afschriftregel al los geboekt? Verbruikt één exemplaar uit de teller, zodat twee
 * gelijke CSV-regels tegenover één losse boeking er één als dubbel geven en één als nieuw.
 */
export function neemLosGeboekt(teller: Map<string, number>, r: Pick<ImportRegel, 'datum' | 'bedrag'>): boolean {
  const k = `${r.datum}|${r.bedrag}`;
  const n = teller.get(k) ?? 0;
  if (n <= 0) return false;
  teller.set(k, n - 1);
  return true;
}

/** Een geïmporteerde regel als boeking (status "te verwerken"), met het voorstel. */
export interface ImportBoeking extends BoekingWaarde {
  tegenrekening: string | null;
  kenmerk: string | null;
  sleutel: string;
}

export function naarImportBoeking(r: ImportRegel, rekeningId: string, v: ImportVoorstel): ImportBoeking {
  const richting = r.bedrag > 0 ? 'bij' : 'af';
  // Een privé-voorstel zonder vennoot kan niet: dan wordt het een uitgave of inkomst.
  const soort: BoekingSoort = v.soort === 'prive' && !v.vennootId ? (richting === standaardRichting('inkomst') ? 'inkomst' : 'uitgave') : v.soort;
  const metBtw = soort === 'inkomst' || soort === 'uitgave';
  const btwCode: BtwCode = metBtw ? v.btwCode : 'geen';
  const grootboek = metBtw ? v.grootboek ?? (soort === 'inkomst' ? GB.omzet : GB.overigeKosten) : null;
  const bedrag = Math.abs(r.bedrag);
  const ber = berekenBoeking({ soort, richting, bedrag, isExcl: false, btwCode, datum: r.datum });
  return {
    rekeningId,
    datum: r.datum,
    omschrijving: r.omschrijving,
    tegenpartij: r.tegenpartij,
    soort,
    richting,
    bedrag,
    isExcl: false,
    btwCode,
    btw: ber.btw.btw,
    btwHandmatig: false,
    grootboek,
    vennootId: soort === 'prive' ? v.vennootId : null,
    status: 'te_verwerken',
    notities: null,
    tegenrekening: r.tegenrekening,
    kenmerk: r.kenmerk,
    sleutel: r.sleutel
  };
}
