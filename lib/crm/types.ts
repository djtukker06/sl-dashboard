// Klanten & projecten (migratie 0022): vormen die de pagina's en de API gebruiken.
// Bewust weinig velden: contact, status en korte notities. Geen pipeline, geen uren.

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
}

/** Eén regel in het klantenoverzicht. */
export interface KlantRegel {
  id: string;
  naam: string;
  contactpersoon: string;
  email: string;
  status: KlantStatus;
  /** Projecten die nog niet afgerond zijn. */
  lopendeProjecten: number;
}

export interface KlantNotitie {
  id: string;
  tekst: string;
  door: string | null;
  /** ISO-moment. */
  op: string;
}

export interface KlantInvoer {
  naam?: string;
  contactpersoon?: string;
  email?: string;
  telefoon?: string;
  adres?: string;
  postcode?: string;
  status?: KlantStatus;
}

export { PROJECT_STATUS_LABEL, PROJECT_STATUS_KORT } from './projectstatus';
