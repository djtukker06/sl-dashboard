// Verdeelt jouw taken over de dashboardkaarten. Pure functie zonder imports (alleen types),
// zodat scripts/test-taken.mjs dit bestand direct laadt. De repo haalt alles in ÉÉN query op
// (open taken + taken met een datum in deze 7 dagen) en verdeelt hier; dat waren er vier.

import type { Taak } from './types';

export interface DashboardTaken {
  /** Taken (open en afgerond) met een datum in [vandaag, tot]. */
  taken: Taak[];
  /** Open taken met een deadline vóór vandaag. */
  teLaat: Taak[];
  /** Open taken zonder deadline (hooguit max). */
  zonderDeadline: Taak[];
  /** Open taken met een deadline na `tot` (hooguit max, eerstvolgende eerst). */
  later: Taak[];
}

/**
 * @param taken  al gesorteerd (sorteerTaken); de volgorde blijft per groep behouden
 * @param vandaag 'YYYY-MM-DD'
 * @param tot    laatste dag van de dashboardweek (vandaag + 6)
 */
export function verdeelDashboardTaken(taken: Taak[], vandaag: string, tot: string, max: number): DashboardTaken {
  const uit: DashboardTaken = { taken: [], teLaat: [], zonderDeadline: [], later: [] };
  for (const t of taken) {
    const open = !t.afgerond;
    if (t.datum && t.datum >= vandaag && t.datum <= tot) uit.taken.push(t);
    else if (!open) continue;
    else if (!t.datum) uit.zonderDeadline.push(t);
    else if (t.datum < vandaag) uit.teLaat.push(t);
    else uit.later.push(t);
  }
  uit.zonderDeadline = uit.zonderDeadline.slice(0, max);
  uit.later = uit.later.slice(0, max);
  return uit;
}
