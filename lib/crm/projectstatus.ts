// Projectstatus voor het bord, de lijst en de projectpagina (migratie 0023): labels,
// deadlinekleur, dagen in een status en "afgerond in de laatste 30 dagen". Pure functies
// zonder imports (alleen types), zodat scripts/test-crm.mjs dit bestand direct laadt en
// het zowel op de server als in de browser werkt.

import type { ProjectStatus } from '@/lib/agenda/types';

/** Volgorde van het bord en de stappenbalk. */
export const BORD_STATUSSEN: ProjectStatus[] = ['voorbereiding', 'bezig', 'wachten', 'afgerond'];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  voorbereiding: 'Voorbereiding',
  bezig: 'Bezig',
  wachten: 'Wachten op goedkeuring',
  afgerond: 'Afgerond'
};

/** Kort label voor pillen en tellers (smalle ruimte). */
export const PROJECT_STATUS_KORT: Record<ProjectStatus, string> = {
  voorbereiding: 'Voorbereiding',
  bezig: 'Bezig',
  wachten: 'Wachten',
  afgerond: 'Afgerond'
};

/** Hoeveel dagen vooruit een deadline "binnenkort" is. */
export const BINNENKORT_DAGEN = 7;
/** Afgerond-kolom: standaard alleen wat in deze periode afgerond is. */
export const RECENT_AFGEROND_DAGEN = 30;

const DAG_MS = 86_400_000;

function dagNummer(dag: string): number {
  const [j, m, d] = dag.split('-').map(Number);
  return Math.round(Date.UTC(j, m - 1, d) / DAG_MS);
}

/**
 * Kleur van een deadline: 'telaat' (verstreken), 'binnenkort' (vandaag t/m 7 dagen),
 * 'later' of null (geen deadline). Een afgerond project is nooit te laat.
 */
export function deadlineStand(deadline: string | null, vandaag: string, status: ProjectStatus): 'telaat' | 'binnenkort' | 'later' | null {
  if (!deadline) return null;
  if (status === 'afgerond') return 'later';
  const v = dagNummer(deadline) - dagNummer(vandaag);
  if (v < 0) return 'telaat';
  if (v <= BINNENKORT_DAGEN) return 'binnenkort';
  return 'later';
}

/** Hele dagen sinds een ISO-moment (0 = vandaag of in de toekomst); null zonder moment. */
export function dagenSinds(iso: string | null, nu: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nu.getTime() - t) / DAG_MS));
}

/** "vandaag", "1 dag", "12 dagen". */
export function dagenTekst(n: number): string {
  if (n === 0) return 'vandaag';
  return n === 1 ? '1 dag' : `${n} dagen`;
}

/**
 * Hoort een afgerond project in de standaardweergave (laatste 30 dagen)? Zonder
 * status_sinds (vóór 0023) weten we het niet: dan tonen we het wel.
 */
export function isRecentAfgerond(statusSinds: string | null, nu: Date = new Date()): boolean {
  const d = dagenSinds(statusSinds, nu);
  return d === null || d <= RECENT_AFGEROND_DAGEN;
}

/** Eerstvolgende deadline eerst; zonder deadline achteraan; daarna op naam. */
export function opDeadline<T extends { deadline: string | null; naam: string }>(a: T, b: T): number {
  const da = a.deadline ?? '9999-12-31';
  const db = b.deadline ?? '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  return a.naam.localeCompare(b.naam, 'nl');
}

/** Vorige/volgende status op het bord (voor sneltoetsen); null aan de rand. */
export function buurStatus(s: ProjectStatus, richting: -1 | 1): ProjectStatus | null {
  const i = BORD_STATUSSEN.indexOf(s) + richting;
  return i >= 0 && i < BORD_STATUSSEN.length ? BORD_STATUSSEN[i] : null;
}
