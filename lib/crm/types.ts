// Klanten & projecten (migratie 0022, opvolgen 0025): vormen die de pagina's en de API
// gebruiken. Bewust weinig velden: contact, status, opvolgen en korte notities. Geen
// pipeline, geen uren.

import type { ProjectStatus } from '@/lib/agenda/types';

export type KlantStatus = 'lead' | 'actief' | 'afgerond';
export const KLANT_STATUSSEN: KlantStatus[] = ['lead', 'actief', 'afgerond'];
export const KLANT_STATUS_LABEL: Record<KlantStatus, string> = { lead: 'Lead', actief: 'Actief', afgerond: 'Afgerond' };

export interface Klant {
  id: string;
  naam: string;
  contactpersoon: string;
  email: string;
  telefoon: string;
  adres: string;
  postcode: string;
  status: KlantStatus;
  /** Korte "volgende stap" (0025; '' vóór 0025 of als niets gepland). */
  volgendeStap: string;
  /** 'YYYY-MM-DD' of null (0025). */
  opvolgenOp: string | null;
}

/** Eén regel in het klantenoverzicht. */
export interface KlantRegel {
  id: string;
  naam: string;
  contactpersoon: string;
  email: string;
  telefoon: string;
  status: KlantStatus;
  volgendeStap: string;
  opvolgenOp: string | null;
  /** Projecten die nog niet afgerond zijn. */
  lopendeProjecten: number;
  /** De "belangrijkste" status van de lopende projecten (wachten > bezig > voorbereiding). */
  projectStatus: ProjectStatus | null;
  /** Omzet excl. btw over alle facturen (revenue_subtotal, zoals het facturenoverzicht). */
  omzet: number;
  /** Aanbetalingen zonder restfactuur (zoals het dashboard "open" telt). */
  openAanbetalingen: number;
  /** ISO-moment van de laatste notitie (contact), of null. */
  laatsteContact: string | null;
  /** ISO-moment van de laatste activiteit: notitie, factuur of aanmaken. */
  laatstActief: string;
}

export type NotitieSoort = 'notitie' | 'status';

export interface KlantNotitie {
  id: string;
  tekst: string;
  door: string | null;
  /** ISO-moment. */
  op: string;
  /** 'status' = automatisch bij een statuswijziging (0025). */
  soort: NotitieSoort;
}

export interface KlantInvoer {
  naam?: string;
  contactpersoon?: string;
  email?: string;
  telefoon?: string;
  adres?: string;
  postcode?: string;
  status?: KlantStatus;
  volgendeStap?: string;
  opvolgenOp?: string | null;
}

export { PROJECT_STATUS_LABEL, PROJECT_STATUS_KORT } from './projectstatus';
