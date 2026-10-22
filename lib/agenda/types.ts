// Vormen die de agenda-API teruggeeft en die de client (agenda, dashboard) gebruikt.
// De database gebruikt Engelse kolomnamen (tasks, calendar_events); de app Nederlands.

export type Prioriteit = 1 | 2 | 3; // 1 hoog, 2 normaal, 3 laag

export interface Taak {
  id: string;
  titel: string;
  notitie: string;
  /** 'YYYY-MM-DD' of null ("Ooit"). */
  datum: string | null;
  /** 'HH:MM' of null. */
  tijd: string | null;
  /** Minuten of null. */
  duur: number | null;
  prioriteit: Prioriteit;
  klantId: string | null;
  klantNaam: string | null;
  afgerond: boolean;
  /** ISO-moment of null. */
  afgerondOp: string | null;
  aangemaakt: string;
}

export interface Afspraak {
  id: string;
  titel: string;
  notitie: string;
  locatie: string;
  /** ISO-momenten (UTC). Bij een hele dag: 00:00 Amsterdamse tijd t/m 00:00 van de dag ná de laatste dag. */
  start: string;
  eind: string;
  heleDag: boolean;
  klantId: string | null;
  klantNaam: string | null;
}

export type TakenFilter = 'vandaag' | 'telaat' | 'gepland' | 'ooit' | 'afgerond';
export const TAKEN_FILTERS: TakenFilter[] = ['vandaag', 'telaat', 'gepland', 'ooit', 'afgerond'];

export type Tellingen = Record<'vandaag' | 'telaat' | 'gepland' | 'ooit', number>;

/** Wat de API stuurt bij een fout. code 'tabel_ontbreekt' = migratie 0018 nog niet uitgevoerd. */
export interface ApiFout {
  error: string;
  code?: 'tabel_ontbreekt' | 'niet_ingelogd';
}

/** Body voor POST/PATCH /api/taken. Bij PATCH zijn alle velden optioneel. */
export interface TaakInvoer {
  titel?: string;
  notitie?: string;
  datum?: string | null;
  tijd?: string | null;
  duur?: number | null;
  prioriteit?: number;
  klantId?: string | null;
  afgerond?: boolean;
}

/** Body voor POST/PATCH /api/afspraken. Tijden in Amsterdamse tijd. */
export interface AfspraakInvoer {
  titel?: string;
  notitie?: string;
  locatie?: string;
  /** Eerste dag, 'YYYY-MM-DD'. */
  datum?: string;
  /** Laatste dag bij een meerdaagse hele-dag-afspraak (optioneel). */
  eindDatum?: string | null;
  /** 'HH:MM' (niet bij hele dag). */
  start?: string | null;
  /** 'HH:MM'; vóór of gelijk aan start = volgende dag. Zonder eind: start + duur (standaard 60 min). */
  eind?: string | null;
  duur?: number | null;
  heleDag?: boolean;
  klantId?: string | null;
}
