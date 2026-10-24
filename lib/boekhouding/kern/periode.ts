// Datums, kwartalen en vergrendelde periodes. Pure module (geen klok behalve waar 'nu'
// expliciet wordt meegegeven, geen netwerk, geen '@/'-imports).
//
// Factuurstelsel: de btw valt in het kwartaal van de factuur-/bondatum; een losse bankregel
// zonder document gebruikt zijn transactiedatum. Datums zijn kalenderdagen 'YYYY-MM-DD';
// tijdstippen (zoals issued_at van facturen) zetten we eerst om naar de Nederlandse dag.

export type Datum = string; // 'YYYY-MM-DD'
export type Kwartaal = 1 | 2 | 3 | 4;

const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad2 = (n: number) => String(n).padStart(2, '0');

export function isDatum(v: unknown): v is Datum {
  if (typeof v !== 'string') return false;
  const m = DATUM.exec(v);
  if (!m) return false;
  const j = Number(m[1]);
  const mnd = Number(m[2]);
  const d = Number(m[3]);
  if (j < 1900 || j > 2999 || mnd < 1 || mnd > 12 || d < 1) return false;
  return d <= dagenInMaand(j, mnd);
}

export function dagenInMaand(jaar: number, maand: number): number {
  return new Date(Date.UTC(jaar, maand, 0)).getUTCDate();
}

export function maakDatum(jaar: number, maand: number, dag: number): Datum {
  return `${jaar}-${pad2(maand)}-${pad2(dag)}`;
}

export function jaarVan(d: Datum): number {
  return Number(d.slice(0, 4));
}

export function maandVan(d: Datum): number {
  return Number(d.slice(5, 7));
}

export function kwartaalVan(d: Datum): Kwartaal {
  return (Math.floor((maandVan(d) - 1) / 3) + 1) as Kwartaal;
}

export function isKwartaal(v: unknown): v is Kwartaal {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

/** "Q3 2026" */
export function kwartaalLabel(jaar: number, q: Kwartaal): string {
  return `Q${q} ${jaar}`;
}

export function kwartaalGrenzen(jaar: number, q: Kwartaal): { van: Datum; tot: Datum } {
  const eerste = (q - 1) * 3 + 1;
  return { van: maakDatum(jaar, eerste, 1), tot: maakDatum(jaar, eerste + 2, dagenInMaand(jaar, eerste + 2)) };
}

/** Uiterste datum btw-aangifte en -betaling: de laatste dag van de maand na het kwartaal. */
export function aangifteDeadline(jaar: number, q: Kwartaal): Datum {
  const maand = q * 3 + 1;
  if (maand > 12) return maakDatum(jaar + 1, 1, 31);
  return maakDatum(jaar, maand, dagenInMaand(jaar, maand));
}

/** De Nederlandse kalenderdag van een tijdstip (ISO-string of Date). */
export function datumNL(moment: string | Date): Datum {
  const d = typeof moment === 'string' ? new Date(moment) : moment;
  if (Number.isNaN(d.getTime())) throw new Error('ongeldig tijdstip');
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Vandaag in Nederland. */
export function vandaagNL(nu: Date = new Date()): Datum {
  return datumNL(nu);
}

/** Dag plus n dagen. */
export function plusDagen(d: Datum, n: number): Datum {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Dag plus n maanden, met de dag begrensd op het einde van de maand. */
export function plusMaanden(d: Datum, n: number): Datum {
  const j = jaarVan(d);
  const m = maandVan(d) - 1 + n;
  const nj = j + Math.floor(m / 12);
  const nm = (((m % 12) + 12) % 12) + 1;
  const dag = Math.min(Number(d.slice(8, 10)), dagenInMaand(nj, nm));
  return maakDatum(nj, nm, dag);
}

const MAANDEN_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/** "24 okt 2026" (of zonder jaar). */
export function korteDatum(d: Datum, metJaar = true): string {
  const t = `${Number(d.slice(8, 10))} ${MAANDEN_KORT[maandVan(d) - 1]}`;
  return metJaar ? `${t} ${jaarVan(d)}` : t;
}

/** "24 oktober 2026" */
export function langeDatum(d: Datum): string {
  return `${Number(d.slice(8, 10))} ${MAANDEN[maandVan(d) - 1]} ${jaarVan(d)}`;
}

// ---------------------------------------------------------------------------------
// Vergrendeling: een ingediende btw-aangifte vergrendelt zijn kwartaal, een afgesloten
// boekjaar het hele jaar. Dezelfde regel staat als trigger in de database (0027).
// ---------------------------------------------------------------------------------
export interface Vergrendeling {
  /** Ingediende aangiften. */
  aangiften: { jaar: number; kwartaal: Kwartaal }[];
  /** Afgesloten boekjaren. */
  boekjaren: number[];
}

export const GEEN_VERGRENDELING: Vergrendeling = { aangiften: [], boekjaren: [] };

/** null als de datum in een open periode valt, anders de reden (voor de melding). */
export function vergrendeldReden(d: Datum, v: Vergrendeling): string | null {
  const j = jaarVan(d);
  if (v.boekjaren.includes(j)) return `Boekjaar ${j} is afgesloten.`;
  const q = kwartaalVan(d);
  if (v.aangiften.some((a) => a.jaar === j && a.kwartaal === q)) {
    return `De btw-aangifte over ${kwartaalLabel(j, q)} is ingediend; deze periode is vergrendeld.`;
  }
  return null;
}

export function isVergrendeld(d: Datum, v: Vergrendeling): boolean {
  return vergrendeldReden(d, v) !== null;
}
