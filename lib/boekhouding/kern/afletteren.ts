// Afletteren en openstaande posten. Pure module.
//
//   - Een bankregel (inkomst) betaalt een of meer facturen; een bankregel (uitgave) betaalt een
//     of meer bonnetjes. De koppeling staat in bk_koppelingen, nooit in invoices/expenses.
//   - Openstaand = totaal van het document − de gekoppelde betalingen. Deelbetalingen en één
//     betaling voor meerdere facturen kunnen allebei.
//   - Suggesties: factuurnummer in de omschrijving, exact bedrag, klant- of leveranciersnaam
//     en datum. Eén klik koppelt.
//   - Controles voor de boekhouder: bonnetjes zonder bankregel, uitgaven met btw zonder bon,
//     inkomsten zonder factuur, overboekingen zonder tegenhanger, verweesde koppelingen.

import type { Centen } from './geld';
import { formatCenten } from './geld';
import { plusDagen, vergrendeldReden, type Datum, type Vergrendeling } from './periode';
import {
  BETAALTERMIJN_DAGEN,
  uitgaveTeltNiet,
  uitgaveViaBank,
  type FactuurBron,
  type KoppelBron,
  type Koppeling,
  type UitgaveBron
} from './bronnen';
import { berekenBoeking, type Boeking } from '../model';

const dagenTussen = (van: Datum, tot: Datum): number => Math.round((Date.parse(`${tot}T12:00:00Z`) - Date.parse(`${van}T12:00:00Z`)) / 86_400_000);

/** Wat een bankregel betaalt, in de richting van het document: inkomst bij = +, uitgave af = +. */
export function betaaldBedrag(b: Boeking): Centen {
  const m = berekenBoeking(b).bankMutatie;
  return b.soort === 'uitgave' ? -m : m;
}

/** Welk soort document een boeking kan betalen. */
export function koppelBronVoor(b: Boeking): KoppelBron | null {
  if (b.soort === 'inkomst') return 'factuur';
  if (b.soort === 'uitgave') return 'uitgave';
  return null;
}

export type Ouderdom = '0-30' | '31-60' | '60+';
export const OUDERDOM: Ouderdom[] = ['0-30', '31-60', '60+'];

export function ouderdomVan(dagen: number): Ouderdom {
  return dagen <= 30 ? '0-30' : dagen <= 60 ? '31-60' : '60+';
}

export type OpenStatus = 'open' | 'deels' | 'betaald' | 'te_veel';

export interface OpenPost<T> {
  doc: T;
  totaal: Centen;
  betaald: Centen;
  open: Centen;
  status: OpenStatus;
  /** Dagen sinds de document-datum. */
  dagen: number;
  ouderdom: Ouderdom;
  /** Na de betalingstermijn (facturen: 14 dagen). */
  vervallen: boolean;
  koppelingen: Koppeling[];
}

function status(totaal: Centen, betaald: Centen): OpenStatus {
  if (betaald === 0) return totaal === 0 ? 'betaald' : 'open';
  const t = Math.abs(totaal);
  const b = totaal < 0 ? -betaald : betaald;
  if (b === t) return 'betaald';
  if (b > t) return 'te_veel';
  return 'deels';
}

function perBron(koppelingen: readonly Koppeling[], bron: KoppelBron, boekingIds?: ReadonlySet<string>): Map<string, Koppeling[]> {
  const uit = new Map<string, Koppeling[]>();
  for (const k of koppelingen) {
    if (k.bron !== bron || (boekingIds && !boekingIds.has(k.boekingId))) continue;
    const l = uit.get(k.bronId);
    if (l) l.push(k);
    else uit.set(k.bronId, [k]);
  }
  return uit;
}

/** Alle facturen met hun betaalstatus (gekoppelde betalingen). */
export function factuurPosten(facturen: readonly FactuurBron[], koppelingen: readonly Koppeling[], vandaag: Datum): OpenPost<FactuurBron>[] {
  const per = perBron(koppelingen, 'factuur');
  return facturen.map((f) => {
    const ks = per.get(f.id) ?? [];
    const betaald = ks.reduce((s, k) => s + k.bedrag, 0);
    const dagen = Math.max(0, dagenTussen(f.datum, vandaag));
    const open = f.totaal - betaald;
    return {
      doc: f,
      totaal: f.totaal,
      betaald,
      open,
      status: status(f.totaal, betaald),
      dagen,
      ouderdom: ouderdomVan(dagen),
      vervallen: open !== 0 && plusDagen(f.datum, BETAALTERMIJN_DAGEN) < vandaag,
      koppelingen: ks
    };
  });
}

/** Bonnetjes die via de zakelijke rekening betaald worden, met hun betaalstatus. */
export function uitgavePosten(uitgaven: readonly UitgaveBron[], koppelingen: readonly Koppeling[], vandaag: Datum): OpenPost<UitgaveBron>[] {
  const per = perBron(koppelingen, 'uitgave');
  return uitgaven
    .filter((u) => !uitgaveTeltNiet(u) && uitgaveViaBank(u))
    .map((u) => {
      const ks = per.get(u.id) ?? [];
      const betaald = ks.reduce((s, k) => s + k.bedrag, 0);
      const totaal = u.totaal ?? 0;
      const dagen = Math.max(0, dagenTussen(u.datum as Datum, vandaag));
      return {
        doc: u,
        totaal,
        betaald,
        open: totaal - betaald,
        status: status(totaal, betaald),
        dagen,
        ouderdom: ouderdomVan(dagen),
        vervallen: false,
        koppelingen: ks
      };
    });
}

export interface OuderdomTotaal {
  aantal: number;
  open: Centen;
  per: Record<Ouderdom, Centen>;
}

export function ouderdomTotalen<T>(posten: readonly OpenPost<T>[]): OuderdomTotaal {
  const uit: OuderdomTotaal = { aantal: 0, open: 0, per: { '0-30': 0, '31-60': 0, '60+': 0 } };
  for (const p of posten) {
    if (p.open === 0) continue;
    uit.aantal++;
    uit.open += p.open;
    uit.per[p.ouderdom] += p.open;
  }
  return uit;
}

// ---------------------------------------------------------------------------------
// Suggesties
// ---------------------------------------------------------------------------------
const STOP = new Set(['bv', 'b', 'v', 'nv', 'vof', 'gmbh', 'ltd', 'inc', 'llc', 'the', 'de', 'het', 'van', 'en', 'ireland', 'limited', 'holding', 'groep', 'emea', 'international', 'nederland', 'europe', 'betaling', 'factuur', 'ontvangen']);

function woorden(t: string): string[] {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Deel (0–1) van de betekenisvolle woorden van `naam` dat in `tekst` voorkomt. */
export function naamOvereenkomst(naam: string, tekst: string): number {
  const n = [...new Set(woorden(naam))];
  if (!n.length) return 0;
  const t = new Set(woorden(tekst));
  return n.filter((w) => t.has(w)).length / n.length;
}

const kaal = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Staat het factuurnummer in de tekst (ook zonder streepjes of spaties)? */
export function nummerIn(nummer: string, tekst: string): boolean {
  const n = kaal(nummer);
  if (n.length < 3) return false;
  const t = kaal(tekst);
  const i = t.indexOf(n);
  if (i < 0) return false;
  // Niet midden in een langer getal ("2026-01" in "2026-018").
  const na = t.charAt(i + n.length);
  const voor = t.charAt(i - 1);
  return !(/\d/.test(na) && /\d$/.test(n)) && !(/\d/.test(voor) && /^\d/.test(n));
}

export interface Suggestie {
  bron: KoppelBron;
  bronId: string;
  titel: string;
  sub: string;
  datum: Datum;
  /** Voorgesteld te koppelen bedrag (richting document). */
  bedrag: Centen;
  open: Centen;
  score: number;
  redenen: string[];
}

const tekstVan = (b: Boeking) => `${b.omschrijving} ${b.tegenpartij ?? ''} ${b.kenmerk ?? ''} ${b.notities ?? ''}`;

/** Score van een bankregel tegenover een open factuur (0 = geen kandidaat). */
export function factuurScore(b: Boeking, p: OpenPost<FactuurBron>, rest: Centen): { score: number; redenen: string[] } {
  const f = p.doc;
  const redenen: string[] = [];
  let score = 0;
  if (p.open === 0 || Math.sign(p.open) !== Math.sign(rest) || rest === 0) return { score: 0, redenen };
  const tekst = tekstVan(b);
  if (nummerIn(f.nummer, tekst)) {
    score += 55;
    redenen.push('factuurnummer in de omschrijving');
  }
  if (rest === p.open) {
    score += 45;
    redenen.push('bedrag gelijk aan het openstaande bedrag');
  } else if (rest === f.totaal) {
    score += 25;
    redenen.push('bedrag gelijk aan het factuurbedrag');
  }
  const naam = naamOvereenkomst(f.klant, tekst);
  if (naam >= 0.5) {
    score += Math.round(25 * naam);
    redenen.push('klantnaam');
  }
  const d = dagenTussen(f.datum, b.datum);
  if (d < -7) score -= 50;
  else if (d > 180) score -= 20;
  return { score: Math.max(0, score), redenen };
}

/** Score van een bankregel tegenover een open bonnetje. */
export function uitgaveScore(b: Boeking, p: OpenPost<UitgaveBron>, rest: Centen): { score: number; redenen: string[] } {
  const u = p.doc;
  const redenen: string[] = [];
  let score = 0;
  if (p.open === 0 || Math.sign(p.open) !== Math.sign(rest) || rest === 0) return { score: 0, redenen };
  if (rest === p.open) {
    score += 50;
    redenen.push('zelfde bedrag');
  }
  const d = Math.abs(dagenTussen(u.datum as Datum, b.datum));
  if (d <= 10) {
    score += 20 - d;
    redenen.push(d === 0 ? 'zelfde dag' : `${d} dag${d === 1 ? '' : 'en'} verschil`);
  } else if (d > 45) score -= 30;
  const tekst = tekstVan(b);
  const naam = Math.max(naamOvereenkomst(u.leverancier, tekst), u.factuurnummer ? (nummerIn(u.factuurnummer, tekst) ? 1 : 0) : 0);
  if (naam >= 0.5) {
    score += Math.round(30 * naam);
    redenen.push('leverancier');
  }
  return { score: Math.max(0, score), redenen };
}

export const MIN_SCORE: Record<KoppelBron, number> = { factuur: 40, uitgave: 50 };

/** Het nog niet gekoppelde deel van een bankregel. */
export function restVanBoeking(b: Boeking, koppelingen: readonly Koppeling[]): Centen {
  return betaaldBedrag(b) - koppelingen.filter((k) => k.boekingId === b.id).reduce((s, k) => s + k.bedrag, 0);
}

/** Koppelsuggesties voor een bankregel (beste eerst, maximaal `max`). */
export function koppelSuggesties(
  b: Boeking,
  facturen: readonly OpenPost<FactuurBron>[],
  uitgaven: readonly OpenPost<UitgaveBron>[],
  koppelingen: readonly Koppeling[],
  max = 3
): Suggestie[] {
  const bron = koppelBronVoor(b);
  if (!bron) return [];
  const rest = restVanBoeking(b, koppelingen);
  if (rest === 0) return [];
  const al = new Set(koppelingen.filter((k) => k.boekingId === b.id).map((k) => k.bronId));
  const uit: Suggestie[] = [];
  if (bron === 'factuur') {
    for (const p of facturen) {
      if (al.has(p.doc.id)) continue;
      const { score, redenen } = factuurScore(b, p, rest);
      if (score < MIN_SCORE.factuur) continue;
      uit.push({
        bron,
        bronId: p.doc.id,
        titel: `Factuur ${p.doc.nummer}`,
        sub: p.doc.klant,
        datum: p.doc.datum,
        bedrag: standaardBedrag(rest, p.open),
        open: p.open,
        score,
        redenen
      });
    }
  } else {
    for (const p of uitgaven) {
      if (al.has(p.doc.id)) continue;
      const { score, redenen } = uitgaveScore(b, p, rest);
      if (score < MIN_SCORE.uitgave) continue;
      uit.push({
        bron,
        bronId: p.doc.id,
        titel: p.doc.leverancier || 'Bonnetje',
        sub: p.doc.omschrijving || p.doc.factuurnummer || '',
        datum: p.doc.datum as Datum,
        bedrag: standaardBedrag(rest, p.open),
        open: p.open,
        score,
        redenen
      });
    }
  }
  return uit.sort((a, b2) => b2.score - a.score || (a.datum < b2.datum ? 1 : -1)).slice(0, max);
}

/** Het voorgestelde bedrag: het kleinste van wat de bankregel nog over heeft en wat er open staat. */
export function standaardBedrag(rest: Centen, open: Centen): Centen {
  if (Math.sign(rest) !== Math.sign(open)) return 0;
  return Math.sign(rest) * Math.min(Math.abs(rest), Math.abs(open));
}

export interface BetaalSuggestie {
  boeking: Boeking;
  bedrag: Centen;
  score: number;
  redenen: string[];
}

/** Omgekeerd: welke bankregels kunnen dit openstaande document betalen? */
export function betalingSuggesties(
  bron: KoppelBron,
  p: OpenPost<FactuurBron> | OpenPost<UitgaveBron>,
  boekingen: readonly Boeking[],
  koppelingen: readonly Koppeling[],
  max = 2
): BetaalSuggestie[] {
  const uit: BetaalSuggestie[] = [];
  for (const b of boekingen) {
    if (koppelBronVoor(b) !== bron) continue;
    const ks = koppelingen.filter((k) => k.boekingId === b.id);
    if (ks.some((k) => k.bron !== bron || k.bronId === p.doc.id)) continue;
    const rest = betaaldBedrag(b) - ks.reduce((s, k) => s + k.bedrag, 0);
    const { score, redenen } =
      bron === 'factuur' ? factuurScore(b, p as OpenPost<FactuurBron>, rest) : uitgaveScore(b, p as OpenPost<UitgaveBron>, rest);
    if (score < MIN_SCORE[bron]) continue;
    uit.push({ boeking: b, bedrag: standaardBedrag(rest, p.open), score, redenen });
  }
  return uit.sort((a, b) => b.score - a.score).slice(0, max);
}

// ---------------------------------------------------------------------------------
// Controle van een nieuwe koppeling (zelfde regels in de demo, de API en de trigger)
// ---------------------------------------------------------------------------------
/**
 * Mag (ont)koppelen in deze periode? Koppelen verandert de btw van de bankregel zelf (die telt
 * daarna niet meer mee: de btw komt uit de factuur of het bonnetje). In een vergrendeld
 * kwartaal mag dat dus alleen als de regel zelf geen btw-effect heeft (btw-code 'geen');
 * in een afgesloten boekjaar nooit.
 */
export function koppelVergrendelFout(b: Boeking, v: Vergrendeling): string | null {
  const reden = vergrendeldReden(b.datum, v);
  if (!reden) return null;
  if (v.boekjaren.includes(Number(b.datum.slice(0, 4)))) return reden;
  if ((b.soort === 'inkomst' || b.soort === 'uitgave') && b.btwCode !== 'geen') {
    return `${reden} Koppelen zou de btw van die aangifte wijzigen; boek een correctie in een open kwartaal.`;
  }
  return null;
}

export interface KoppelDoc {
  bron: KoppelBron;
  id: string;
  totaal: Centen;
  open: Centen;
}

export function koppelFout(b: Boeking, doc: KoppelDoc, bedrag: Centen, koppelingen: readonly Koppeling[], v: Vergrendeling): string | null {
  const bron = koppelBronVoor(b);
  if (!bron) return 'Alleen een uitgave of inkomst kan aan een factuur of bonnetje worden gekoppeld.';
  if (bron !== doc.bron) {
    return doc.bron === 'factuur' ? 'Een factuur koppel je aan een inkomst. Zet de soort eerst op Inkomst.' : 'Een bonnetje koppel je aan een uitgave. Zet de soort eerst op Uitgave.';
  }
  if (!Number.isSafeInteger(bedrag) || bedrag === 0) return 'Vul een bedrag in.';
  const eigen = koppelingen.filter((k) => k.boekingId === b.id);
  if (eigen.some((k) => k.bronId === doc.id && k.bron === doc.bron)) return 'Deze regel is al aan dit document gekoppeld.';
  if (eigen.some((k) => k.bron !== doc.bron)) return 'Deze regel is al aan een ander soort document gekoppeld.';
  const rest = betaaldBedrag(b) - eigen.reduce((s, k) => s + k.bedrag, 0);
  if (Math.sign(bedrag) !== Math.sign(rest) || Math.abs(bedrag) > Math.abs(rest)) {
    return `Er is nog ${formatCenten(Math.abs(rest))} van deze bankregel over om te koppelen.`;
  }
  if (Math.sign(bedrag) !== Math.sign(doc.open) || Math.abs(bedrag) > Math.abs(doc.open)) {
    return doc.open === 0 ? 'Dit document is al helemaal betaald.' : `Er staat nog ${formatCenten(Math.abs(doc.open))} open.`;
  }
  return koppelVergrendelFout(b, v);
}

// ---------------------------------------------------------------------------------
// Controlelijsten
// ---------------------------------------------------------------------------------
/**
 * Uitgaven waarover voorbelasting wordt teruggevraagd (21% of 9%) zonder gekoppeld bonnetje:
 * voor die aftrek is een factuur nodig, dus de boekhouder vraagt om de bon.
 */
export function bonOntbreekt(boekingen: readonly Boeking[], gekoppeld: ReadonlySet<string>): Boeking[] {
  return boekingen.filter((b) => b.soort === 'uitgave' && !gekoppeld.has(b.id) && (b.btwCode === '21' || b.btwCode === '9') && b.richting === 'af');
}

/** Ontvangsten die niet aan een factuur hangen (tellen als losse omzet). */
export function inkomstenZonderFactuur(boekingen: readonly Boeking[], gekoppeld: ReadonlySet<string>): Boeking[] {
  return boekingen.filter((b) => b.soort === 'inkomst' && !gekoppeld.has(b.id));
}

export interface OverboekingPaar {
  af: Boeking;
  bij: Boeking;
}

/**
 * Overboekingen tussen eigen rekeningen paren: "af" op de ene rekening met "bij" op een
 * andere, zelfde bedrag, binnen 5 dagen. Wat overblijft staat nog op kruisposten (2000).
 */
export function overboekingen(boekingen: readonly Boeking[]): { paren: OverboekingPaar[]; los: Boeking[] } {
  const af = boekingen.filter((b) => b.soort === 'overboeking' && b.richting === 'af').sort((a, b) => (a.datum < b.datum ? -1 : 1));
  const bij = boekingen.filter((b) => b.soort === 'overboeking' && b.richting === 'bij').sort((a, b) => (a.datum < b.datum ? -1 : 1));
  const gebruikt = new Set<string>();
  const paren: OverboekingPaar[] = [];
  const los: Boeking[] = [];
  for (const a of af) {
    const m = bij.find((b) => !gebruikt.has(b.id) && b.rekeningId !== a.rekeningId && b.bedrag === a.bedrag && Math.abs(dagenTussen(a.datum, b.datum)) <= 5);
    if (m) {
      gebruikt.add(m.id);
      paren.push({ af: a, bij: m });
    } else los.push(a);
  }
  for (const b of bij) if (!gebruikt.has(b.id)) los.push(b);
  return { paren, los: los.sort((a, b) => (a.datum < b.datum ? 1 : -1)) };
}

/** Koppelingen naar een factuur of bonnetje dat niet (meer) bestaat (bv. verwijderde factuur). */
export function verweesdeKoppelingen(koppelingen: readonly Koppeling[], facturen: readonly FactuurBron[], uitgaven: readonly UitgaveBron[]): Koppeling[] {
  const f = new Set(facturen.map((x) => x.id));
  const u = new Set(uitgaven.map((x) => x.id));
  return koppelingen.filter((k) => (k.bron === 'factuur' ? !f.has(k.bronId) : !u.has(k.bronId)));
}
