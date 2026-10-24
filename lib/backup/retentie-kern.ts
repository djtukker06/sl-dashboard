// Bewaarbeleid voor de database-back-ups in Drive. Zonder env of '@/'-imports (zodat
// scripts/test-backup.mjs het los kan testen op een gesimuleerd jaar).
//
//   - de laatste 14 dagen: alles;
//   - daarnaast per ISO-week de nieuwste, voor de laatste 8 weken;
//   - daarnaast per maand de nieuwste, voor de laatste 12 maanden;
//   - en altijd de nieuwste 3, wat er ook gebeurt (ook als de klok raar staat).
// De rest mag weg (naar de prullenbak van Drive; daar blijft hij nog 30 dagen).

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

function maandSleutel(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Welke back-ups blijven staan. Bestanden met een onbekende naam blijven altijd staan
 * (daar beslissen we niet over).
 */
export function teBewaren(bestanden: BackupInDrive[], nu: number = Date.now()): Set<string> {
  const bewaar = new Set<string>();
  const met = bestanden
    .map((b) => ({ ...b, t: datumUitNaam(b.naam) }))
    .filter((b) => {
      if (b.t === null) bewaar.add(b.id);
      return b.t !== null;
    }) as (BackupInDrive & { t: number })[];
  met.sort((a, b) => b.t - a.t || b.naam.localeCompare(a.naam));

  for (const b of met.slice(0, 3)) bewaar.add(b.id);

  const weken = new Set<string>();
  const maanden = new Set<string>();
  for (const b of met) {
    const leeftijd = nu - b.t;
    if (leeftijd < 14 * DAG) {
      bewaar.add(b.id);
    }
    if (leeftijd < 8 * 7 * DAG) {
      const w = isoWeekSleutel(b.t);
      if (!weken.has(w)) {
        weken.add(w);
        bewaar.add(b.id);
      }
    }
    if (leeftijd < 366 * DAG) {
      const m = maandSleutel(b.t);
      if (!maanden.has(m)) {
        maanden.add(m);
        // Alleen de laatste 12 maanden (de huidige telt mee).
        if (maanden.size <= 12) bewaar.add(b.id);
      }
    }
  }
  return bewaar;
}

/** De back-ups die weg mogen (nooit als er minder dan 4 zijn). */
export function teVerwijderen(bestanden: BackupInDrive[], nu: number = Date.now()): BackupInDrive[] {
  if (bestanden.length <= 3) return [];
  const bewaar = teBewaren(bestanden, nu);
  return bestanden.filter((b) => !bewaar.has(b.id));
}
