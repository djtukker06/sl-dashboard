// Vormen die de Google Agenda-API (app/api/google-agenda) naar de browser stuurt. Nooit tokens.

export interface GoogleAgenda {
  /** Rij-id (google_agendas.id). */
  id: string;
  accountId: string;
  naam: string;
  kleur: string;
  /** Getoond in de agenda (de schakelaar in de weergave). */
  zichtbaar: boolean;
  /** Ook in je agenda-link (Apple Agenda e.d.). */
  inFeed: boolean;
  /** Je kunt er afspraken in maken en wijzigen. */
  schrijfbaar: boolean;
  primair: boolean;
}

export interface GoogleAccount {
  id: string;
  email: string;
  /** 'opnieuw_koppelen' als de toegang verlopen of ingetrokken is. */
  fout: string | null;
  agendas: GoogleAgenda[];
}

export interface GoogleStatus {
  /** GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en een sleutel staan op de server. */
  ingericht: boolean;
  /** Migratie 0035 is uitgevoerd. */
  tabellen: boolean;
  accounts: GoogleAccount[];
}

/** Antwoord van GET /api/google-agenda/afspraken. */
export interface GoogleBereik {
  status: GoogleStatus;
  events: import('../agenda/types').Afspraak[];
  /** Agenda's die niet geladen konden worden (met de reden), om te melden. */
  fouten: { accountId: string; melding: string }[];
}

/** De uitkomst in ?google=… na het koppelen (terug op /agenda). */
export const KOPPEL_MELDING: Record<string, { tekst: string; fout?: boolean }> = {
  gekoppeld: { tekst: 'Google Agenda gekoppeld' },
  geweigerd: { tekst: 'Koppelen afgebroken: geen toestemming gegeven.', fout: true },
  scope: { tekst: 'Geef bij het koppelen toegang tot je agenda’s (beide vinkjes aanzetten) en probeer het opnieuw.', fout: true },
  geen_refresh: { tekst: 'Google gaf geen blijvende toegang. Probeer het opnieuw.', fout: true },
  ongeldig: { tekst: 'De koppeling is verlopen of ongeldig. Probeer het opnieuw.', fout: true },
  niet_ingericht: { tekst: 'Google Agenda is nog niet ingericht op de server.', fout: true },
  tabel_ontbreekt: { tekst: 'Voer eerst supabase/UITVOEREN_0035.sql uit in Supabase.', fout: true },
  site_url: { tekst: 'NEXT_PUBLIC_SITE_URL ontbreekt of klopt niet.', fout: true },
  api_uit: { tekst: 'De Google Calendar API staat nog niet aan in Google Cloud (zie README).', fout: true },
  fout: { tekst: 'Koppelen met Google Agenda is mislukt. Probeer het opnieuw.', fout: true }
};
