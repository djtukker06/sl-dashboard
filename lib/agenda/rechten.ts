import type { Afspraak, Taak } from './types';

// Wie mag een taak of afspraak wijzigen? Dezelfde regel als de RLS-policies van 0021
// (taak_betrokken / afspraak_betrokken): de maker of iemand voor wie het is. De server
// controleert dit altijd zelf; dit is alleen voor de schermen (knoppen uit, uitleg tonen).
// Vóór migratie 0021 (overgang) gelden de oude regels: iedereen die is ingelogd.

export function magTaakWijzigen(t: Pick<Taak, 'aangemaaktDoor' | 'toegewezen'>, mijnId: string, overgang: boolean): boolean {
  return overgang || t.aangemaaktDoor === mijnId || t.toegewezen.includes(mijnId);
}

export function magAfspraakWijzigen(a: Pick<Afspraak, 'aangemaaktDoor' | 'deelnemers'>, mijnId: string, overgang: boolean): boolean {
  return overgang || a.aangemaaktDoor === mijnId || a.deelnemers.includes(mijnId);
}

/** "Daniel", "Daniel en Mark", "Daniel, Mark en Eva" (jezelf als "jou"). */
export function namenLijst(namen: string[]): string {
  if (namen.length <= 1) return namen[0] ?? '';
  return `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`;
}
