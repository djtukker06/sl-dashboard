// Klanten & projecten (migratie 0022, opvolgen 0025): vormen die de pagina's en de API
// gebruiken. Bewust weinig velden: contact, status, opvolgen en korte notities. Geen
// pipeline, geen uren.

import type { ProjectStatus } from '@/lib/agenda/types';

// 'koud' (migratie 0033) = "Op de radar": een bedrijf dat we niet willen vergeten maar nu
// (nog) niet benaderen. Geen opvolgdatum op het dashboard; wel met één klik naar Leads of
// meteen naar klant. Een 'lead' is iemand die we gesproken hebben of binnenkort benaderen.
export type KlantStatus = 'koud' | 'lead' | 'actief' | 'afgerond';
/** In de volgorde van de klantreis: op de radar → lead → actief → afgerond. */
export const KLANT_STATUSSEN: KlantStatus[] = ['koud', 'lead', 'actief', 'afgerond'];
export const KLANT_STATUS_LABEL: Record<KlantStatus, string> = { koud: 'Op de radar', lead: 'Lead', actief: 'Actief', afgerond: 'Afgerond' };

/** Nog geen klant: een lead of iets op de radar (kan met één klik "klant" worden). */
export function isProspect(s: string): boolean {
  return s === 'lead' || s === 'koud';
}

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
