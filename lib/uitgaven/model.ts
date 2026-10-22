// Uitgaven: vormen, vaste lijsten en pure rekenfuncties (geen netwerk, geen klok, geen
// imports), zodat zowel de server, de browser als scripts/test-uitgaven.mjs dit bestand
// direct kunnen gebruiken.

// ---------- vaste lijsten ----------

export const CATEGORIEEN = [
  { id: 'software', label: 'Software & abonnementen' },
  { id: 'hardware', label: 'Hardware & apparatuur' },
  { id: 'kantoor', label: 'Kantoor & werkplek' },
  { id: 'reiskosten', label: 'Reiskosten & vervoer' },
  { id: 'marketing', label: 'Marketing & advertenties' },
  { id: 'representatie', label: 'Representatie & eten' },
  { id: 'opleiding', label: 'Opleiding & boeken' },
  { id: 'uitbesteed', label: 'Uitbesteed werk' },
  { id: 'telefoon', label: 'Telefoon & internet' },
  { id: 'bankkosten', label: 'Bankkosten' },
  { id: 'overig', label: 'Overig' }
] as const;
export type Categorie = (typeof CATEGORIEEN)[number]['id'];

export const BTW_TARIEVEN = [
  { id: '21', label: '21%' },
  { id: '9', label: '9%' },
  { id: '0', label: '0%' },
  { id: 'verlegd', label: 'Verlegd' },
  { id: 'geen', label: 'Geen btw' }
] as const;
export type BtwTarief = (typeof BTW_TARIEVEN)[number]['id'];

export const BETAALWIJZEN = [
  { id: 'zakelijk', label: 'Zakelijke rekening' },
  { id: 'prive', label: 'Privé voorgeschoten' },
  { id: 'creditcard', label: 'Creditcard' },
  { id: 'contant', label: 'Contant' }
] as const;
export type Betaalwijze = (typeof BETAALWIJZEN)[number]['id'];

/** Wat voor document het is (alleen om te filteren; optioneel). */
export const SOORTEN = [
  { id: 'bonnetje', label: 'Bonnetje', meervoud: 'Bonnetjes' },
  { id: 'inkoopfactuur', label: 'Inkoopfactuur', meervoud: 'Inkoopfacturen' },
  { id: 'overig', label: 'Overig', meervoud: 'Overig' }
] as const;
export type Soort = (typeof SOORTEN)[number]['id'];

export const STATUSSEN = [
  { id: 'concept', label: 'Te controleren' },
  { id: 'verwerkt', label: 'Verwerkt' }
] as const;
export type Status = (typeof STATUSSEN)[number]['id'];

/** Velden die het uitlezen kan invullen (en die de app dan markeert). */
export const AI_VELDEN = [
  'leverancier',
  'datum',
  'totaal',
  'btwBedrag',
  'btwTarief',
  'valuta',
  'factuurnummer',
  'omschrijving',
  'categorie',
  'betaaldVia'
] as const;
export type AiVeld = (typeof AI_VELDEN)[number];

export const TOEGESTANE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'] as const;
export type BestandsType = (typeof TOEGESTANE_TYPES)[number];
export const MAX_BESTAND_BYTES = 25 * 1024 * 1024;

export const isCategorie = (v: unknown): v is Categorie => CATEGORIEEN.some((c) => c.id === v);
export const isBtwTarief = (v: unknown): v is BtwTarief => BTW_TARIEVEN.some((c) => c.id === v);
export const isBetaalwijze = (v: unknown): v is Betaalwijze => BETAALWIJZEN.some((c) => c.id === v);
export const isSoort = (v: unknown): v is Soort => SOORTEN.some((c) => c.id === v);
export const isStatus = (v: unknown): v is Status => STATUSSEN.some((c) => c.id === v);
export const isBestandsType = (v: unknown): v is BestandsType => (TOEGESTANE_TYPES as readonly string[]).includes(String(v));

export const categorieLabel = (id: string | null | undefined) => CATEGORIEEN.find((c) => c.id === id)?.label ?? '';
export const tariefLabel = (id: string | null | undefined) => BTW_TARIEVEN.find((c) => c.id === id)?.label ?? '';
export const betaalLabel = (id: string | null | undefined) => BETAALWIJZEN.find((c) => c.id === id)?.label ?? '';
export const soortLabel = (id: string | null | undefined) => SOORTEN.find((c) => c.id === id)?.label ?? '';

// ---------- vormen (API ↔ client) ----------

export interface UitgaveBestand {
  id: string;
  naam: string;
  type: BestandsType;
  grootte: number | null;
}

export interface Uitgave {
  id: string;
  datum: string | null; // YYYY-MM-DD
  leverancier: string;
  omschrijving: string;
  categorie: Categorie | null;
  totaal: number | null; // incl. btw
  btwBedrag: number | null;
  btwTarief: BtwTarief | null;
  valuta: string;
  factuurnummer: string;
  betaaldVia: Betaalwijze | null;
  klantId: string | null;
  klantNaam: string | null;
  projectNotitie: string;
  notitie: string;
  status: Status;
  aiVelden: AiVeld[];
  aiStatus: 'geen' | 'klaar' | 'mislukt';
  aiMelding: string;
  bron: 'upload' | 'mail' | 'handmatig';
  bronInfo: string;
  bestanden: UitgaveBestand[];
  /** Bonnetje / inkoopfactuur (null = onbekend; zie afgeleideSoort). */
  soort: Soort | null;
  /** Wie het uploadde (auth user-id), of null. */
  aangemaaktDoor: string | null;
  aangemaakt: string;
  gewijzigd: string;
}

/** Wat de client mag sturen bij aanmaken/wijzigen (alles optioneel). */
export interface UitgaveInvoer {
  datum?: string | null;
  leverancier?: string;
  omschrijving?: string;
  categorie?: string | null;
  totaal?: number | string | null;
  btwBedrag?: number | string | null;
  btwTarief?: string | null;
  valuta?: string;
  factuurnummer?: string;
  betaaldVia?: string | null;
  klantId?: string | null;
  projectNotitie?: string;
  notitie?: string;
  status?: string;
  soort?: string | null;
  aiVelden?: string[];
}

export interface Leverancier {
  naam: string;
  categorie: Categorie | null;
  betaaldVia: Betaalwijze | null;
  aantal: number;
}

// ---------- getallen ----------

export const opCenten = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Leest een bedrag: number, of tekst als "12,50", "€ 1.234,56", "1,234.56", "-3.10".
 * Geeft null bij leeg of onleesbaar.
 */
export function leesBedrag(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? opCenten(v) : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[€$£\s]|EUR|USD|GBP/gi, '').replace(/^\+/, '');
  if (!s) return null;
  const negatief = /^-|-$|^\(.*\)$/.test(s);
  s = s.replace(/[-()]/g, '');
  const laatsteKomma = s.lastIndexOf(',');
  const laatstePunt = s.lastIndexOf('.');
  if (laatsteKomma > -1 && laatstePunt > -1) {
    // Het laatste scheidingsteken is het decimaalteken.
    s = laatsteKomma > laatstePunt ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (laatsteKomma > -1) {
    // "1,234" (precies 3 cijfers na één komma, zonder decimalen ervoor) blijft een decimaal in NL.
    s = s.replace(/,(?=.*,)/g, '').replace(',', '.');
  } else if (laatstePunt > -1 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // "1.234" = duizendtal
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return opCenten(negatief ? -n : n);
}

/** Nederlands bedrag zonder valutateken: 1234.5 → "1.234,50". */
export function bedragNL(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const vast = opCenten(n);
  const [heel, dec] = Math.abs(vast).toFixed(2).split('.');
  return `${vast < 0 ? '-' : ''}${heel.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

/** Bedrag excl. btw (totaal min btw; zonder btw-bedrag = totaal). */
export function exclBtw(u: Pick<Uitgave, 'totaal' | 'btwBedrag'>): number {
  return opCenten((u.totaal ?? 0) - (u.btwBedrag ?? 0));
}

/** Btw uit een bedrag incl. btw bij een tarief (21 of 9); anders null. */
export function btwUitTotaal(totaal: number, tarief: BtwTarief | null): number | null {
  if (tarief === '21') return opCenten((totaal * 21) / 121);
  if (tarief === '9') return opCenten((totaal * 9) / 109);
  if (tarief === '0' || tarief === 'verlegd' || tarief === 'geen') return 0;
  return null;
}

// ---------- datums ----------

export function isDatum(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [j, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(j, m - 1, d));
  return dt.getUTCFullYear() === j && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Leest een datum: "2026-10-22", "22-10-2026", "22/10/26", "22.10.2026". */
export function leesDatum(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isDatum(s) ? s : null;
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (!m) return null;
  const j = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = `${j}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isDatum(d) ? d : null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const laatsteDag = (j: number, m: number) => new Date(Date.UTC(j, m, 0)).getUTCDate();

export type PeriodeSoort = 'maand' | 'kwartaal' | 'jaar' | 'eigen';
export interface Periode {
  soort: PeriodeSoort;
  van: string;
  tot: string; // t/m
}

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/** Periode van een soort rond een dag ("vandaag" in Amsterdamse tijd). */
export function periodeRond(soort: Exclude<PeriodeSoort, 'eigen'>, dag: string): Periode {
  const [j, m] = dag.split('-').map(Number);
  if (soort === 'jaar') return { soort, van: `${j}-01-01`, tot: `${j}-12-31` };
  if (soort === 'kwartaal') {
    const eerste = Math.floor((m - 1) / 3) * 3 + 1;
    return { soort, van: `${j}-${pad2(eerste)}-01`, tot: `${j}-${pad2(eerste + 2)}-${laatsteDag(j, eerste + 2)}` };
  }
  return { soort, van: `${j}-${pad2(m)}-01`, tot: `${j}-${pad2(m)}-${laatsteDag(j, m)}` };
}

/** Vorige (-1) of volgende (+1) periode van dezelfde soort. */
export function schuifPeriode(p: Periode, richting: 1 | -1): Periode {
  if (p.soort === 'eigen') return p;
  const [j, m] = p.van.split('-').map(Number);
  const stap = p.soort === 'maand' ? 1 : p.soort === 'kwartaal' ? 3 : 12;
  const totaal = j * 12 + (m - 1) + richting * stap;
  return periodeRond(p.soort, `${Math.floor(totaal / 12)}-${pad2((totaal % 12) + 1)}-01`);
}

export function periodeLabel(p: Periode): string {
  const [j, m] = p.van.split('-').map(Number);
  if (p.soort === 'jaar') return String(j);
  if (p.soort === 'kwartaal') return `Q${Math.floor((m - 1) / 3) + 1} ${j}`;
  if (p.soort === 'maand') return `${MAANDEN[m - 1]} ${j}`;
  return `${korteDatumNL(p.van)} – ${korteDatumNL(p.tot)}`;
}

export function korteDatumNL(d: string | null): string {
  if (!d || !isDatum(d)) return '';
  const [j, m, dag] = d.split('-').map(Number);
  return `${dag} ${MAANDEN[m - 1].slice(0, 3)} ${j}`;
}

export function maandSleutel(d: string | null): string {
  return d && isDatum(d) ? d.slice(0, 7) : 'zonder-datum';
}

export function maandLabel(sleutel: string): string {
  if (sleutel === 'zonder-datum') return 'Zonder datum';
  const [j, m] = sleutel.split('-').map(Number);
  return `${MAANDEN[m - 1]} ${j}`;
}

export function kwartaalVan(d: string): number {
  return Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
}

// ---------- tekst ----------

export function schoon(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Bestandsnaam-veilig: "Albert Heijn B.V." → "albert-heijn-b-v". */
export function slug(s: string, max = 40): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, max)
      .replace(/-$/, '') || 'onbekend'
  );
}

export function extensieVoor(type: string): string {
  switch (type) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}

/** Type uit de eerste bytes van een bestand (magic numbers); null als het geen toegestaan type is. */
export function snuffelType(b: Uint8Array): BestandsType | null {
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = (van: number, tot: number) => String.fromCharCode(...b.slice(van, tot));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
    const merk = ascii(8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis)$/.test(merk)) return 'image/heic';
    if (/^(mif1|msf1|heif)$/.test(merk)) return 'image/heif';
  }
  return null;
}

/** Type uit een bestandsnaam (voor bijlagen met een vaag Content-Type). */
export function typeUitNaam(naam: string): BestandsType | null {
  const ext = naam.toLowerCase().split('.').pop() || '';
  const map: Record<string, BestandsType> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    pdf: 'application/pdf'
  };
  return map[ext] ?? null;
}

/**
 * Naam van een bonnetje in de export: JJJJ-MM-DD_leverancier_bedrag.ext
 * ("2026-10-22_albert-heijn_12,50.jpg"); bij meerdere bestanden "-2", "-3" erachter.
 */
export function exportBestandsnaam(
  u: Pick<Uitgave, 'datum' | 'leverancier' | 'totaal'>,
  type: string,
  volgnummer = 1
): string {
  const datum = u.datum && isDatum(u.datum) ? u.datum : '0000-00-00';
  const bedrag = u.totaal === null ? 'onbekend' : bedragNL(u.totaal).replace(/\./g, '');
  return `${datum}_${slug(u.leverancier || 'onbekend')}_${bedrag}${volgnummer > 1 ? `-${volgnummer}` : ''}.${extensieVoor(type)}`;
}

// ---------- CSV voor de boekhouder ----------

function csvVeld(v: string): string {
  // Puntkomma-CSV (Excel NL). Formules onschadelijk maken (CSV-injectie).
  let s = v.replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_KOLOMMEN = [
  'Datum',
  'Leverancier',
  'Omschrijving',
  'Categorie',
  'Bedrag incl. btw',
  'Btw',
  'Bedrag excl. btw',
  'Btw-tarief',
  'Valuta',
  'Factuurnummer',
  'Betaald via',
  'Klant',
  'Project',
  'Notitie',
  'Status',
  'Bestanden'
];

/** CSV (puntkomma, NL-decimalen, met BOM zodat Excel UTF-8 herkent). */
export function maakCsv(uitgaven: Uitgave[], bestandsnamen?: Map<string, string[]>): string {
  const regels = [CSV_KOLOMMEN.join(';')];
  for (const u of uitgaven) {
    const [j, m, d] = (u.datum ?? '').split('-');
    regels.push(
      [
        u.datum ? `${d}-${m}-${j}` : '',
        u.leverancier,
        u.omschrijving,
        categorieLabel(u.categorie),
        bedragNL(u.totaal),
        bedragNL(u.btwBedrag),
        u.totaal === null ? '' : bedragNL(exclBtw(u)),
        tariefLabel(u.btwTarief),
        u.valuta,
        u.factuurnummer,
        betaalLabel(u.betaaldVia),
        u.klantNaam ?? '',
        u.projectNotitie,
        u.notitie,
        u.status === 'verwerkt' ? 'Verwerkt' : 'Concept',
        (bestandsnamen?.get(u.id) ?? []).join(', ')
      ]
        .map((v) => csvVeld(String(v ?? '')))
        .join(';')
    );
  }
  return '﻿' + regels.join('\r\n') + '\r\n';
}

// ---------- filteren ----------

export interface Filters {
  zoek?: string;
  categorie?: string; // id, of 'geen' voor zonder categorie
  leverancier?: string; // exacte naam (hoofdletterongevoelig)
  status?: string;
  betaaldVia?: string;
}

/** Filtert een lijst (gebruikt door de lijst in de browser én de export op de server). */
export function filterUitgaven<T extends Uitgave>(lijst: T[], f: Filters): T[] {
  const woorden = (f.zoek ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const lev = (f.leverancier ?? '').trim().toLowerCase();
  return lijst.filter((u) => {
    if (f.categorie && (f.categorie === 'geen' ? u.categorie !== null : u.categorie !== f.categorie)) return false;
    if (lev && u.leverancier.trim().toLowerCase() !== lev) return false;
    if (f.status && u.status !== f.status) return false;
    if (f.betaaldVia && u.betaaldVia !== f.betaaldVia) return false;
    if (woorden.length) {
      const hooi = [
        u.leverancier,
        u.omschrijving,
        u.factuurnummer,
        u.notitie,
        u.projectNotitie,
        u.klantNaam ?? '',
        categorieLabel(u.categorie),
        u.totaal === null ? '' : bedragNL(u.totaal),
        u.datum ?? ''
      ]
        .join(' ')
        .toLowerCase();
      if (!woorden.every((w) => hooi.includes(w))) return false;
    }
    return true;
  });
}

// ---------- totalen ----------

export interface Totalen {
  aantal: number;
  incl: number;
  btw: number;
  excl: number;
  /** Uitgaven in een andere valuta dan EUR: niet meegeteld in de bedragen. */
  andereValuta: number;
  /** Uitgaven zonder bedrag (nog in te vullen). */
  zonderBedrag: number;
}

export function totalen(lijst: Pick<Uitgave, 'totaal' | 'btwBedrag' | 'valuta'>[]): Totalen {
  const t: Totalen = { aantal: lijst.length, incl: 0, btw: 0, excl: 0, andereValuta: 0, zonderBedrag: 0 };
  for (const u of lijst) {
    if (u.valuta !== 'EUR') {
      t.andereValuta++;
      continue;
    }
    if (u.totaal === null) {
      t.zonderBedrag++;
      continue;
    }
    t.incl += u.totaal;
    t.btw += u.btwBedrag ?? 0;
  }
  t.incl = opCenten(t.incl);
  t.btw = opCenten(t.btw);
  t.excl = opCenten(t.incl - t.btw);
  return t;
}

/** Uitgaven per categorie (excl. btw, alleen EUR), van groot naar klein. */
export function perCategorie(
  lijst: Pick<Uitgave, 'categorie' | 'totaal' | 'btwBedrag' | 'valuta'>[]
): { categorie: Categorie | null; label: string; excl: number; aantal: number }[] {
  const map = new Map<Categorie | null, { excl: number; aantal: number }>();
  for (const u of lijst) {
    if (u.valuta !== 'EUR' || u.totaal === null) continue;
    const r = map.get(u.categorie) ?? { excl: 0, aantal: 0 };
    r.excl += exclBtw(u);
    r.aantal++;
    map.set(u.categorie, r);
  }
  return [...map.entries()]
    .map(([categorie, r]) => ({
      categorie,
      label: categorieLabel(categorie) || 'Zonder categorie',
      excl: opCenten(r.excl),
      aantal: r.aantal
    }))
    .sort((a, b) => b.excl - a.excl);
}

// ---------- uitlezen (Claude) normaliseren ----------

/** Ruwe uitvoer van het model, zoals afgesproken in het JSON-schema (alles mag ontbreken). */
export interface RuwUitgelezen {
  leverancier?: unknown;
  datum?: unknown;
  totaal?: unknown;
  btwBedrag?: unknown;
  btwTarief?: unknown;
  valuta?: unknown;
  factuurnummer?: unknown;
  omschrijving?: unknown;
  categorie?: unknown;
  betaalmethode?: unknown;
}

export interface Uitgelezen {
  leverancier: string | null;
  datum: string | null;
  totaal: number | null;
  btwBedrag: number | null;
  btwTarief: BtwTarief | null;
  valuta: string | null;
  factuurnummer: string | null;
  omschrijving: string | null;
  categorie: Categorie | null;
  betaaldVia: Betaalwijze | null;
}

function leesTarief(v: unknown): BtwTarief | null {
  if (v === null || v === undefined) return null;
  const s = String(v).toLowerCase().replace(/[%\s]/g, '').replace(',', '.');
  if (s === '21' || s === '21.0') return '21';
  if (s === '9' || s === '9.0') return '9';
  if (s === '0' || s === '0.0') return '0';
  if (/verlegd|reverse/.test(s)) return 'verlegd';
  if (/^(geen|vrijgesteld|nvt|n\.v\.t\.|none)$/.test(s)) return 'geen';
  return null;
}

function leesBetaalwijze(v: unknown): Betaalwijze | null {
  const s = String(v ?? '').toLowerCase();
  if (isBetaalwijze(s)) return s;
  if (/credit|visa|mastercard|amex|american express/.test(s)) return 'creditcard';
  if (/contant|cash/.test(s)) return 'contant';
  if (/pin|ideal|bank|overboeking|incasso|debit|maestro|v pay|sepa/.test(s)) return 'zakelijk';
  return null;
}

/**
 * Maakt van de modeluitvoer nette, veilige waarden. Onbekend/onleesbaar wordt null.
 * - bedragen op centen; btw nooit groter dan het totaal;
 * - ontbreekt het btw-bedrag maar is het tarief 21/9/0/verlegd/geen, dan wordt het berekend;
 * - datums alleen tussen 2000 en (vandaag + 7 dagen);
 * - categorie alleen uit de vaste lijst.
 */
export function normaliseerUitgelezen(r: RuwUitgelezen, vandaag: string): Uitgelezen {
  const tekst = (v: unknown, max: number) => {
    const s = schoon(v, max);
    return s && !/^(onbekend|unknown|n\/?a|null|-)$/i.test(s) ? s : null;
  };
  let datum = leesDatum(typeof r.datum === 'string' ? r.datum : '');
  if (datum) {
    const grens = new Date(`${vandaag}T00:00:00Z`);
    grens.setUTCDate(grens.getUTCDate() + 7);
    if (datum < '2000-01-01' || datum > grens.toISOString().slice(0, 10)) datum = null;
  }
  const totaal = leesBedrag(r.totaal);
  let btwBedrag = leesBedrag(r.btwBedrag);
  let btwTarief = leesTarief(r.btwTarief);
  if (btwBedrag !== null && totaal !== null && Math.abs(btwBedrag) > Math.abs(totaal)) btwBedrag = null;
  if (btwBedrag === null && totaal !== null) btwBedrag = btwUitTotaal(totaal, btwTarief);
  // Tarief afleiden uit bedragen als het ontbreekt (alleen bij een duidelijke match).
  if (!btwTarief && totaal && btwBedrag !== null) {
    if (btwBedrag === 0) btwTarief = null;
    else if (Math.abs(btwUitTotaal(totaal, '21')! - btwBedrag) <= 0.02) btwTarief = '21';
    else if (Math.abs(btwUitTotaal(totaal, '9')! - btwBedrag) <= 0.02) btwTarief = '9';
  }
  const valutaRuw = schoon(r.valuta, 10).toUpperCase().replace('€', 'EUR');
  const valuta = /^[A-Z]{3}$/.test(valutaRuw) ? valutaRuw : null;
  const categorie = isCategorie(r.categorie) ? r.categorie : null;
  return {
    leverancier: tekst(r.leverancier, 200),
    datum,
    totaal,
    btwBedrag,
    btwTarief,
    valuta,
    factuurnummer: tekst(r.factuurnummer, 100),
    omschrijving: tekst(r.omschrijving, 300),
    categorie,
    betaaldVia: leesBetaalwijze(r.betaalmethode)
  };
}

/** Haalt een JSON-object uit modeltekst (ook met ```json-blokken of tekst eromheen). */
export function jsonUitTekst(tekst: string): Record<string, unknown> | null {
  const zonderBlok = tekst.replace(/```(?:json)?/gi, '');
  const start = zonderBlok.indexOf('{');
  const eind = zonderBlok.lastIndexOf('}');
  if (start < 0 || eind <= start) return null;
  try {
    const v = JSON.parse(zonderBlok.slice(start, eind + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Zoekt een bekende leverancier bij een (uitgelezen) naam: exact, of de een begint met de ander. */
export function vindLeverancier(naam: string, bekend: Leverancier[]): Leverancier | null {
  const n = naam.trim().toLowerCase();
  if (!n) return null;
  const kaal = (s: string) => s.toLowerCase().replace(/\b(b\.?v\.?|n\.?v\.?|ltd|limited|inc|gmbh|llc|bv|nv)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const nk = kaal(n);
  return (
    bekend.find((l) => l.naam.toLowerCase() === n) ??
    bekend.find((l) => kaal(l.naam) === nk && nk.length > 0) ??
    bekend.find((l) => {
      const lk = kaal(l.naam);
      return lk.length >= 4 && nk.length >= 4 && (nk.startsWith(lk + ' ') || lk.startsWith(nk + ' '));
    }) ??
    null
  );
}

// ---------- soort en zoeken (Bonnetjes & inkoopfacturen) ----------

/** Soort als die niet is ingevuld: een PDF is meestal een inkoopfactuur, een foto een bonnetje. */
export function afgeleideSoort(bestanden: Pick<UitgaveBestand, 'type'>[]): Soort | null {
  if (!bestanden.length) return null;
  return bestanden.some((b) => b.type === 'application/pdf') ? 'inkoopfactuur' : 'bonnetje';
}

export function maandNaam(m: number): string {
  return MAANDEN[m - 1] ?? '';
}

export interface ZoekWoord {
  /** Tekst zonder tekens die in een PostgREST-filter iets betekenen (leeg = alleen bedrag). */
  tekst: string;
  /** Als het woord een bedrag is ("12,50", "€12", "12.5"): het bedrag. */
  bedrag: number | null;
}

/**
 * Zoekopdracht → losse woorden (alle woorden moeten ergens voorkomen). Een woord dat op
 * een bedrag lijkt, zoekt ook op het totaalbedrag. Maximaal 6 woorden van 60 tekens.
 */
export function zoekWoorden(q: unknown): ZoekWoord[] {
  if (typeof q !== 'string') return [];
  const uit: ZoekWoord[] = [];
  for (const ruw of q.trim().split(/\s+/).slice(0, 6)) {
    const woord = ruw.slice(0, 60);
    const bedrag = /^[€$]?-?\d[\d.,]*$|^-?\d[\d.,]*€$/.test(woord) ? leesBedrag(woord) : null;
    const tekst = woord.replace(/[,()"'\\*%_:;]/g, '').trim();
    if (!tekst && bedrag === null) continue;
    uit.push({ tekst: tekst.length >= 1 ? tekst : '', bedrag });
  }
  return uit;
}

/** Jaar (+ maand) → periode [van, tot]; null zonder jaar. */
export function periodeVan(jaar: number | null, maand: number | null): { van: string; tot: string } | null {
  if (!jaar || !Number.isInteger(jaar) || jaar < 2000 || jaar > 2100) return null;
  if (maand && Number.isInteger(maand) && maand >= 1 && maand <= 12) {
    const mm = String(maand).padStart(2, '0');
    const laatste = new Date(Date.UTC(jaar, maand, 0)).getUTCDate();
    return { van: `${jaar}-${mm}-01`, tot: `${jaar}-${mm}-${String(laatste).padStart(2, '0')}` };
  }
  return { van: `${jaar}-01-01`, tot: `${jaar}-12-31` };
}
