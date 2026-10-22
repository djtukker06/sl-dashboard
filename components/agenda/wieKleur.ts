import type { CSSProperties } from 'react';
import type { TeamProfiel } from '@/lib/team/types';
import type { Afspraak, Taak } from '@/lib/agenda/types';

/** Personen van een item: toegewezenen (taak) of deelnemers (afspraak). */
export function personenVan(item: Taak | Afspraak): string[] {
  return 'toegewezen' in item ? item.toegewezen : item.deelnemers;
}

/**
 * Teamweergave van de agenda: een rand in de kleur van de (eerste) persoon van het item.
 * Buiten de teamweergave: geen extra stijl.
 */
export function wieStijl(item: Taak | Afspraak, perId: Map<string, TeamProfiel>, aan: boolean): CSSProperties | undefined {
  if (!aan) return undefined;
  const eerste = personenVan(item).map((id) => perId.get(id)).find(Boolean);
  return eerste ? ({ '--ag-wie': eerste.kleur } as CSSProperties) : undefined;
}
