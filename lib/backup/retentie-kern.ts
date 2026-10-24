// Bewaarbeleid voor de database-back-ups in Drive. Zonder env of '@/'-imports (zodat
// scripts/test-backup.mjs het los kan testen op een gesimuleerd jaar).
//
//   - alleen de nieuwste 3 blijven staan (één back-up per 3 dagen = ruim een week terug);
//   - komt er een nieuwe bij, dan gaat de oudste weg (naar de prullenbak van Drive; daar
//     blijft hij nog 30 dagen en daarna verdwijnt hij vanzelf).

export interface BackupInDrive {
  id: string;
  naam: string;
}

const NAAM = /^(\d{4})-(\d{2})-(\d{2})(?:-handmatig-(\d{2})(\d{2}))?\.slbak$/;
const DAG = 86_400_000;

/** Tijdstip uit de bestandsnaam (UTC-middag van die datum, plus uur/minuut bij handmatig), of null. */
export function datumUitNaam(naam: string): number | null {
  const m = NAAM.exec(naam);
  if (!m) return null;
  const [j, mnd, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mnd < 1 || mnd > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(j, mnd - 1, d, m[4] ? Number(m[4]) : 3, m[5] ? Number(m[5]) : 0);
  return Number.isNaN(t) ? null : t;
}

/** ISO-week als "2026-W07". */
export function isoWeekSleutel(t: number): string {
  const b = new Date(t);
  const d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
  const dagNr = d.getUTCDay() || 7; // ma = 1 … zo = 7
  d.setUTCDate(d.getUTCDate() + 4 - dagNr); // de donderdag van deze week
  const jaarStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jaarStart) / DAG + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}


/** Hoeveel database-back-ups er in Drive blijven staan (de nieuwste). */
export const BEWAAR_AANTAL = 3;

/**
 * Welke back-ups blijven staan: de nieuwste BEWAAR_AANTAL. Bestanden met een onbekende naam
 * blijven altijd staan (daar beslissen we niet over).
 */
export function teBewaren(bestanden: BackupInDrive[]): Set<string> {
  const bewaar = new Set<string>();
  const met = bestanden
    .map((b) => ({ ...b, t: datumUitNaam(b.naam) }))
    .filter((b) => {
      if (b.t === null) bewaar.add(b.id);
      return b.t !== null;
    }) as (BackupInDrive & { t: number })[];
  met.sort((a, b) => b.t - a.t || b.naam.localeCompare(a.naam));
  for (const b of met.slice(0, BEWAAR_AANTAL)) bewaar.add(b.id);
  return bewaar;
}

/** De back-ups die weg mogen: alles behalve de nieuwste BEWAAR_AANTAL (nooit bij ≤ BEWAAR_AANTAL). */
// `nu` blijft in de signatuur voor bestaande aanroepen; de regel hangt niet meer van de tijd af.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function teVerwijderen(bestanden: BackupInDrive[], nu: number = Date.now()): BackupInDrive[] {
  if (bestanden.length <= BEWAAR_AANTAL) return [];
  const bewaar = teBewaren(bestanden);
  return bestanden.filter((b) => !bewaar.has(b.id));
}
