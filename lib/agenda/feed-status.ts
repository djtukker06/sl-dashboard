// Status van de agenda-koppeling (migratie 0029) zonder imports, zodat lib/auth/team.ts hem
// in dezelfde databaseronde als de toegangscontrole kan ophalen (geen extra wachttijd per
// pagina) en lib/agenda/feed.ts hem voor de API gebruikt.

export type AgendaClient = 'apple' | 'google' | 'outlook' | 'overig';

export interface FeedStatus {
  /** Migratie 0029 uitgevoerd. */
  ingericht: boolean;
  heeftLink: boolean;
  gekoppeld: boolean;
  client: AgendaClient | null;
  laatstOpgehaald: string | null;
  uitgesteldTot: string | null;
}

export interface FeedRij {
  user_id: string;
  eerst_opgehaald_op: string | null;
  laatst_opgehaald_op: string | null;
  client: AgendaClient | null;
  uitgesteld_tot: string | null;
}

export const FEED_KOLOMMEN = 'user_id, eerst_opgehaald_op, laatst_opgehaald_op, client, uitgesteld_tot';

export const NIET_INGERICHT: FeedStatus = { ingericht: false, heeftLink: false, gekoppeld: false, client: null, laatstOpgehaald: null, uitgesteldTot: null };

export function naarFeedStatus(r: FeedRij | null): FeedStatus {
  return {
    ingericht: true,
    heeftLink: Boolean(r),
    gekoppeld: Boolean(r?.eerst_opgehaald_op),
    client: r?.client ?? null,
    laatstOpgehaald: r?.laatst_opgehaald_op ?? null,
    uitgesteldTot: r?.uitgesteld_tot ?? null
  };
}

/** Moet dit teamlid nu eerst zijn agenda koppelen? (Zonder migratie 0029: nee.) */
export function moetKoppelen(s: FeedStatus, nu = new Date()): boolean {
  if (!s.ingericht || s.gekoppeld) return false;
  return !(s.uitgesteldTot && new Date(s.uitgesteldTot) > nu);
}
