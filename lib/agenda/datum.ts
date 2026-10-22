// Datum- en tijdrekenen voor de agenda, altijd in Nederlandse tijd (Europe/Amsterdam),
// ook rond de zomer-/wintertijdwissel. Werkt zowel op de server (UTC) als in de browser.
// Bewust zonder imports, zodat scripts/test-snelinvoer.mjs dit bestand direct kan laden.
//
// Conventies:
//   - een kalenderdag is een string 'YYYY-MM-DD' (zoals Postgres `date`);
//   - een tijd is 'HH:MM' (zoals Postgres `time`, zonder seconden);
//   - een moment is een ISO-string in UTC (zoals Postgres `timestamptz`).

export const TZ = 'Europe/Amsterdam';

const DAG_MS = 86_400_000;

export type Dag = string; // 'YYYY-MM-DD'

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function maakDag(j: number, m: number, d: number): Dag {
  return `${j}-${pad(m)}-${pad(d)}`;
}

export function dagDelen(dag: Dag): { j: number; m: number; d: number } {
  const [j, m, d] = dag.split('-').map(Number);
  return { j, m, d };
}

/** Geldige kalenderdag 'YYYY-MM-DD'? */
export function isDag(s: unknown): s is Dag {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { j, m, d } = dagDelen(s);
  const t = new Date(Date.UTC(j, m - 1, d));
  return t.getUTCFullYear() === j && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && j >= 1970 && j <= 2200;
}

/** Geldige tijd 'HH:MM' (of 'HH:MM:SS' uit Postgres)? Geeft 'HH:MM' of null. */
export function normTijd(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!m) return null;
  const u = Number(m[1]);
  const mi = Number(m[2]);
  if (u > 23 || mi > 59) return null;
  return `${pad(u)}:${pad(mi)}`;
}

export function tijdNaarMinuten(t: string): number {
  const [u, m] = t.split(':').map(Number);
  return u * 60 + m;
}

export function minutenNaarTijd(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function plusDagen(dag: Dag, n: number): Dag {
  const { j, m, d } = dagDelen(dag);
  const t = new Date(Date.UTC(j, m - 1, d + n));
  return maakDag(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Verschil in kalenderdagen b − a. */
export function dagenTussen(a: Dag, b: Dag): number {
  const x = dagDelen(a);
  const y = dagDelen(b);
  return Math.round((Date.UTC(y.j, y.m - 1, y.d) - Date.UTC(x.j, x.m - 1, x.d)) / DAG_MS);
}

/** 0 = maandag … 6 = zondag. */
export function weekdagIndex(dag: Dag): number {
  const { j, m, d } = dagDelen(dag);
  return (new Date(Date.UTC(j, m - 1, d)).getUTCDay() + 6) % 7;
}

export function maandagVan(dag: Dag): Dag {
  return plusDagen(dag, -weekdagIndex(dag));
}

export function eersteVanMaand(dag: Dag): Dag {
  const { j, m } = dagDelen(dag);
  return maakDag(j, m, 1);
}

export function plusMaanden(dag: Dag, n: number): Dag {
  const { j, m } = dagDelen(dag);
  const t = new Date(Date.UTC(j, m - 1 + n, 1));
  return maakDag(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
}

/** ISO-weeknummer van een kalenderdag. */
export function weeknummer(dag: Dag): number {
  const { j, m, d } = dagDelen(dag);
  const t = new Date(Date.UTC(j, m - 1, d));
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - start.getTime()) / DAG_MS + 1) / 7);
}

// ---------- tijdzone ----------

let fmt: Intl.DateTimeFormat | null = null;
function formatter(): Intl.DateTimeFormat {
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
  return fmt;
}

/** Amsterdamse wandkloktijd van een moment. */
export function inAmsterdam(moment: Date | string | number): { dag: Dag; minuten: number; tijd: string } {
  const t = moment instanceof Date ? moment : new Date(moment);
  const p: Record<string, string> = {};
  for (const x of formatter().formatToParts(t)) p[x.type] = x.value;
  const uur = Number(p.hour) % 24;
  const minuten = uur * 60 + Number(p.minute);
  return { dag: maakDag(Number(p.year), Number(p.month), Number(p.day)), minuten, tijd: minutenNaarTijd(minuten) };
}

/** Verschil Amsterdam − UTC in minuten op dat moment (60 in de winter, 120 in de zomer). */
function offsetMinuten(ms: number): number {
  const a = inAmsterdam(ms);
  const { j, m, d } = dagDelen(a.dag);
  const alsUtc = Date.UTC(j, m - 1, d) + a.minuten * 60_000;
  return Math.round((alsUtc - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/**
 * Moment (UTC) van een Amsterdamse wandkloktijd. Bij de wintertijdwissel bestaat 02:xx
 * twee keer: dan het eerste (zomertijd). Bij de zomertijdwissel bestaat 02:xx niet: dan
 * schuift het een uur op (03:xx), zoals een gewone klok.
 */
export function amsterdamNaarMoment(dag: Dag, tijd = '00:00'): Date {
  const { j, m, d } = dagDelen(dag);
  const wand = Date.UTC(j, m - 1, d) + tijdNaarMinuten(tijd) * 60_000;
  // De offset vlak vóór en vlak na deze dag; daartussen ligt hooguit één wissel.
  const offsets = [...new Set([offsetMinuten(wand - DAG_MS), offsetMinuten(wand + DAG_MS)])];
  const passend = offsets
    .map((o) => wand - o * 60_000)
    .filter((x) => {
      const a = inAmsterdam(x);
      return a.dag === dag && a.minuten === tijdNaarMinuten(tijd);
    })
    .sort((a, b) => a - b);
  if (passend.length) return new Date(passend[0]);
  // Tijd bestaat niet (zomertijd begint): reken met de offset van vóór de wissel → een uur later.
  return new Date(wand - offsetMinuten(wand - DAG_MS) * 60_000);
}

/** Vandaag in Amsterdam. */
export function vandaag(nu: Date = new Date()): Dag {
  return inAmsterdam(nu).dag;
}

/** Begin (inclusief) en eind (exclusief) van een reeks kalenderdagen, als UTC-momenten. */
export function bereikMomenten(van: Dag, tot: Dag): { start: string; eind: string } {
  return {
    start: amsterdamNaarMoment(van).toISOString(),
    eind: amsterdamNaarMoment(plusDagen(tot, 1)).toISOString()
  };
}

// ---------- weergave (Nederlands) ----------

export const DAGNAMEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
export const DAGNAMEN_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
export const MAANDNAMEN = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december'
];
export const MAANDNAMEN_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** "vandaag", "morgen", "gisteren", "vrijdag" (binnen een week), anders "12 nov" (+ jaar). */
export function dagTekst(dag: Dag, ref: Dag): string {
  const v = dagenTussen(ref, dag);
  if (v === 0) return 'vandaag';
  if (v === 1) return 'morgen';
  if (v === -1) return 'gisteren';
  if (v > 1 && v < 7) return DAGNAMEN[weekdagIndex(dag)];
  const { j, m, d } = dagDelen(dag);
  const jaar = dagDelen(ref).j !== j ? ` ${j}` : '';
  return `${d} ${MAANDNAMEN_KORT[m - 1]}${jaar}`;
}

/** "donderdag 22 oktober". */
export function langeDag(dag: Dag): string {
  const { m, d } = dagDelen(dag);
  return `${DAGNAMEN[weekdagIndex(dag)]} ${d} ${MAANDNAMEN[m - 1]}`;
}

/** "do 22 okt". */
export function korteDag(dag: Dag): string {
  const { m, d } = dagDelen(dag);
  return `${DAGNAMEN_KORT[weekdagIndex(dag)]} ${d} ${MAANDNAMEN_KORT[m - 1]}`;
}

/** "1 u 30 min", "45 min", "2 u". */
export function duurTekst(min: number): string {
  const u = Math.floor(min / 60);
  const m = min % 60;
  if (!u) return `${m} min`;
  return m ? `${u} u ${m} min` : `${u} u`;
}
