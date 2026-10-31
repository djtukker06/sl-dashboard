// Herhalende afspraken (migratie 0034). Eén rij in calendar_events met een herhaalregel
// (herhaling + herhaal_tot + herhaal_uitzonderingen); bij het ophalen voor een bereik vouwen
// we die hier uit tot losse voorkomens. Puur rekenwerk in Nederlandse tijd: elk voorkomen
// houdt de wandkloktijd van het origineel (09:00 blijft 09:00, ook na de zomertijdwissel).
// Bewust zonder imports buiten ./datum (en types), zodat een los testscript dit kan laden.
//
// Een voorkomen heeft een eigen id "<reeks-id>~YYYY-MM-DD" (de oorspronkelijke datum), zodat
// de weergaven (React-keys, indeling) ze uit elkaar houden en de API weet welk voorkomen je
// bedoelt bij "alleen deze".

import { amsterdamNaarMoment, dagDelen, dagenTussen, inAmsterdam, isDag, maakDag, plusDagen, weekdagIndex, type Dag } from './datum';
import type { Afspraak } from './types';

export type Herhaling =
  | 'dagelijks'
  | 'werkdagen'
  | 'wekelijks'
  | 'tweewekelijks'
  | 'vierwekelijks'
  | 'maandelijks'
  | 'jaarlijks';

/** De keuzes in de dropdown "Herhalen", in volgorde. */
export const HERHALINGEN: { waarde: Herhaling; label: string }[] = [
  { waarde: 'dagelijks', label: 'Elke dag' },
  { waarde: 'werkdagen', label: 'Elke werkdag (ma–vr)' },
  { waarde: 'wekelijks', label: 'Elke week' },
  { waarde: 'tweewekelijks', label: 'Elke 2 weken' },
  { waarde: 'vierwekelijks', label: 'Elke 4 weken' },
  { waarde: 'maandelijks', label: 'Elke maand' },
  { waarde: 'jaarlijks', label: 'Elk jaar' }
];

const WAARDEN = new Set<string>(HERHALINGEN.map((h) => h.waarde));

export function isHerhaling(v: unknown): v is Herhaling {
  return typeof v === 'string' && WAARDEN.has(v);
}

/** Vaste stap in dagen (null bij maand/jaar/werkdagen). */
const STAP_DAGEN: Partial<Record<Herhaling, number>> = { dagelijks: 1, wekelijks: 7, tweewekelijks: 14, vierwekelijks: 28 };

/** Kleinste afstand tussen twee voorkomens, in dagen (om overlap te voorkomen). */
export function minsteAfstandDagen(h: Herhaling): number {
  if (h === 'werkdagen') return 1;
  if (h === 'maandelijks') return 28;
  if (h === 'jaarlijks') return 365;
  return STAP_DAGEN[h] ?? 1;
}

// ---------- id's ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function voorkomenId(reeksId: string, dag: Dag): string {
  return `${reeksId}~${dag}`;
}

/** "uuid" of "uuid~YYYY-MM-DD" → de rij-id en (eventueel) de datum van het voorkomen. */
export function splitsAfspraakId(s: unknown): { id: string; voorkomen: Dag | null } | null {
  if (typeof s !== 'string') return null;
  const [id, dag, ...rest] = s.split('~');
  if (rest.length || !UUID.test(id)) return null;
  if (dag === undefined) return { id, voorkomen: null };
  return isDag(dag) ? { id, voorkomen: dag } : null;
}

export function isAfspraakId(s: unknown): s is string {
  return splitsAfspraakId(s) !== null;
}

// ---------- datums ----------

function dagenInMaand(j: number, m: number): number {
  return new Date(Date.UTC(j, m, 0)).getUTCDate();
}

/** Zelfde dag in een andere maand; bestaat die niet (31 februari), dan de laatste dag. */
function maandDag(j: number, m0: number, d: number): Dag {
  const jaar = j + Math.floor(m0 / 12);
  const maand = (((m0 % 12) + 12) % 12) + 1;
  return maakDag(jaar, maand, Math.min(d, dagenInMaand(jaar, maand)));
}

/**
 * Alle startdatums van een reeks die beginnen in [van, tot] (en niet vóór de eerste dag).
 * Maandelijks op de 29e–31e: in kortere maanden de laatste dag; jaarlijks op 29 februari:
 * in gewone jaren 28 februari.
 */
export function startdatums(h: Herhaling, eerste: Dag, van: Dag, tot: Dag): Dag[] {
  const uit: Dag[] = [];
  const begin = dagenTussen(eerste, van) > 0 ? van : eerste;
  if (dagenTussen(begin, tot) < 0) return uit;
  const stap = STAP_DAGEN[h];
  if (stap) {
    let n = Math.ceil(dagenTussen(eerste, begin) / stap);
    for (let d = plusDagen(eerste, n * stap); dagenTussen(d, tot) >= 0; d = plusDagen(eerste, ++n * stap)) uit.push(d);
    return uit;
  }
  if (h === 'werkdagen') {
    for (let d = begin; dagenTussen(d, tot) >= 0; d = plusDagen(d, 1)) if (weekdagIndex(d) < 5) uit.push(d);
    return uit;
  }
  const e = dagDelen(eerste);
  if (h === 'maandelijks') {
    const b = dagDelen(begin);
    let n = Math.max(0, (b.j - e.j) * 12 + (b.m - e.m) - 1);
    for (;; n++) {
      const d = maandDag(e.j, e.m - 1 + n, e.d);
      if (dagenTussen(d, tot) < 0) break;
      if (dagenTussen(begin, d) >= 0) uit.push(d);
    }
    return uit;
  }
  // jaarlijks
  for (let n = Math.max(0, dagDelen(begin).j - e.j - 1); ; n++) {
    const d = maandDag(e.j + n, e.m - 1, e.d);
    if (dagenTussen(d, tot) < 0) break;
    if (dagenTussen(begin, d) >= 0) uit.push(d);
  }
  return uit;
}

/** Hoort deze datum bij de reeks (ongeacht uitzonderingen)? */
export function isStartdatum(h: Herhaling, eerste: Dag, dag: Dag, herhaalTot: Dag | null): boolean {
  if (herhaalTot && dagenTussen(dag, herhaalTot) < 0) return false;
  return startdatums(h, eerste, dag, dag).length === 1;
}

// ---------- uitvouwen ----------

/** Een afspraak verschoven naar een andere startdatum, met dezelfde wandkloktijden. */
export function verschuifNaar(a: Afspraak, dag: Dag): Afspraak {
  const s = inAmsterdam(a.start);
  const e = inAmsterdam(a.eind);
  const dagen = dagenTussen(s.dag, e.dag);
  const start = amsterdamNaarMoment(dag, a.heleDag ? '00:00' : s.tijd);
  let eind = amsterdamNaarMoment(plusDagen(dag, dagen), a.heleDag ? '00:00' : e.tijd);
  // Kan alleen rond een niet-bestaand uur (zomertijd): dan de oorspronkelijke duur.
  if (eind.getTime() <= start.getTime()) eind = new Date(start.getTime() + (Date.parse(a.eind) - Date.parse(a.start)));
  return { ...a, start: start.toISOString(), eind: eind.toISOString() };
}

/** Een rij met een herhaalregel als de voorkomens die [van, tot] raken (Amsterdamse dagen). */
export function vouwUit(a: Afspraak, van: Dag, tot: Dag, uitzonderingen: Dag[] = []): Afspraak[] {
  if (!a.herhaling) return [a];
  const s = inAmsterdam(a.start);
  const e = inAmsterdam(a.eind);
  // Een voorkomen dat eerder begint kan het bereik nog raken: zoveel dagen terugkijken.
  const terug = Math.max(0, dagenTussen(s.dag, e.dag));
  const laatste = a.herhaalTot && dagenTussen(a.herhaalTot, tot) > 0 ? a.herhaalTot : tot;
  const weg = new Set(uitzonderingen);
  const bereikStart = amsterdamNaarMoment(van).getTime();
  const bereikEind = amsterdamNaarMoment(plusDagen(tot, 1)).getTime();
  const uit: Afspraak[] = [];
  for (const d of startdatums(a.herhaling, s.dag, plusDagen(van, -terug), laatste)) {
    if (weg.has(d)) continue;
    const v = verschuifNaar(a, d);
    if (Date.parse(v.start) < bereikEind && Date.parse(v.eind) > bereikStart) {
      uit.push({ ...v, id: voorkomenId(a.reeksId ?? a.id, d), reeksId: a.reeksId ?? a.id, voorkomen: d });
    }
  }
  return uit;
}

// ---------- iCalendar ----------

const ICS_DAG = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * RRULE (RFC 5545) voor een reeks. `until` is al in het juiste formaat (DATE bij hele dag,
 * UTC-moment bij een afspraak met tijd). Maand-eind netjes: op de 31e wordt het
 * BYMONTHDAY=28,29,30,31;BYSETPOS=-1 (de laatste bestaande van die dagen), net als hier.
 */
export function rrule(h: Herhaling, eerste: Dag, until: string | null): string {
  const { m, d } = dagDelen(eerste);
  let regel: string;
  if (h === 'dagelijks') regel = 'FREQ=DAILY';
  else if (h === 'werkdagen') regel = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  else if (h === 'wekelijks') regel = `FREQ=WEEKLY;BYDAY=${ICS_DAG[weekdagIndex(eerste)]}`;
  else if (h === 'tweewekelijks') regel = `FREQ=WEEKLY;INTERVAL=2;BYDAY=${ICS_DAG[weekdagIndex(eerste)]}`;
  else if (h === 'vierwekelijks') regel = `FREQ=WEEKLY;INTERVAL=4;BYDAY=${ICS_DAG[weekdagIndex(eerste)]}`;
  else if (h === 'maandelijks') {
    const dagen = Array.from({ length: d - 27 }, (_, i) => 28 + i).join(',');
    regel = d > 28 ? `FREQ=MONTHLY;BYMONTHDAY=${dagen};BYSETPOS=-1` : `FREQ=MONTHLY;BYMONTHDAY=${d}`;
  } else {
    regel = m === 2 && d === 29 ? 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1' : `FREQ=YEARLY;BYMONTH=${m};BYMONTHDAY=${d}`;
  }
  return until ? `${regel};UNTIL=${until}` : regel;
}

// ---------- tekst ----------

export function herhalingLabel(h: Herhaling | null): string {
  return HERHALINGEN.find((x) => x.waarde === h)?.label ?? 'Niet';
}
