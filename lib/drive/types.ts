// Gedeelde vormen tussen de Drive-API (/api/drive/**) en de schermen (components/bestanden).

export interface DriveItem {
  id: string;
  naam: string;
  mime: string;
  map: boolean;
  /** Bytes; null voor mappen en Google-documenten. */
  grootte: number | null;
  gewijzigd: string | null;
  /** Link naar Google Drive (alleen bruikbaar voor wie in Google is ingelogd met het bedrijfsaccount). */
  link: string | null;
  /** User-id van wie het via het dashboard uploadde, anders null. */
  door: string | null;
}

export interface Kruimel {
  id: string;
  naam: string;
}

export interface DriveStatus {
  /** GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en een sleutel staan op de server. */
  ingericht: boolean;
  /** Welke env-vars ontbreken (alleen namen). */
  ontbreekt: string[];
  /** Migratie 0024 is uitgevoerd. */
  tabellen: boolean;
  gekoppeld: boolean;
  /** Het gekoppelde Google-account (alleen voor teamleden). */
  email: string | null;
  rootId: string | null;
  eigenaar: boolean;
}

export interface MapInhoud {
  map: Kruimel;
  kruimels: Kruimel[];
  items: DriveItem[];
  /** Vaste map (root, Boekhouding, …): niet te hernoemen of verwijderen. */
  beschermd: string[];
  link: string | null;
}

export type KoppelDoel = { map: string } | { klant: string } | { project: string };
