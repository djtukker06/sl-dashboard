// Gekoppelde agenda's buiten het systeem (Apple/iCloud): de vormen die de API naar de browser
// stuurt. Nooit wachtwoorden of tokens.
import type { Afspraak } from './types';

export type ExternBron = 'apple' | 'google';

export interface ExternAgenda {
  /** Rij-id (apple_agendas.id). */
  id: string;
  bron: ExternBron;
  accountId: string;
  naam: string;
  kleur: string;
  /** Getoond in de agenda (de schakelaar in de weergave). */
  zichtbaar: boolean;
  /** Ook in je agenda-link (alleen bij bronnen die je iPhone niet zelf al toont). */
  inFeed: boolean;
  /** Je kunt er afspraken in maken en wijzigen. */
  schrijfbaar: boolean;
  primair: boolean;
}

export interface ExternAccount {
  id: string;
  bron: ExternBron;
  /** Apple ID (e-mail). */
  email: string;
  /** 'opnieuw_koppelen' als het wachtwoord is ingetrokken of verlopen. */
  fout: string | null;
  agendas: ExternAgenda[];
}

export interface BronStatus {
  /** De sleutel voor het versleutelen staat op de server. */
  ingericht: boolean;
  /** De migratie is uitgevoerd. */
  tabellen: boolean;
}

export interface ExternStatus {
  apple: BronStatus | null;
  google: BronStatus | null;
  accounts: ExternAccount[];
}

/** Antwoord van GET …/afspraken?van&tot. */
export interface ExternBereik {
  status: ExternStatus;
  events: Afspraak[];
  /** Accounts die niet geladen konden worden (met de reden), om te melden. */
  fouten: { accountId: string; melding: string }[];
}

export type AgendaWijziging = { zichtbaar?: boolean; inFeed?: boolean; kleur?: string };
