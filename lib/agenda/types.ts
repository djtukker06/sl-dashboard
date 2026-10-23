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
  /** Voor wie de taak is (user-id's). Leeg zolang migratie 0021 niet is uitgevoerd. */
  toegewezen: string[];
  /** Voortgang van de subtaken ("2/5"). */
  subtaken: { totaal: number; klaar: number };
  projectId: string | null;
  projectNaam: string | null;
  /** User-id van de maker (null bij oude taken of een verwijderd account). */
  aangemaaktDoor: string | null;
  /** User-id van wie de taak afrondde. */
  afgerondDoor: string | null;
}

export interface Subtaak {
  id: string;
  titel: string;
  klaar: boolean;
  klaarDoor: string | null;
  volgorde: number;
}

/** Eén taak met de subtaken zelf (voor de taak-popup). */
export interface TaakDetail extends Taak {
  subtakenLijst: Subtaak[];
}

export type ProjectStatus = 'actief' | 'gearchiveerd';

export interface Project {
  id: string;
  naam: string;
  klantId: string | null;
  klantNaam: string | null;
  status: ProjectStatus;
  notitie: string;
  /** Aantal open taken in dit project. */
  openTaken: number;
  aangemaaktDoor: string | null;
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
  /** Wie erbij hoort (user-id's). Leeg zolang migratie 0021 niet is uitgevoerd. */
  deelnemers: string[];
  aangemaaktDoor: string | null;
}

/**
 * Tabs van de takenlijst. De eerste vijf: taken op JOUW naam. 'uitgezet': taken die jij
 * voor een ander maakte en waar je zelf niet op staat (om op te volgen).
 */
export type TakenFilter = 'vandaag' | 'telaat' | 'gepland' | 'ooit' | 'afgerond' | 'uitgezet';
export const TAKEN_FILTERS: TakenFilter[] = ['vandaag', 'telaat', 'gepland', 'ooit', 'afgerond', 'uitgezet'];

/** Aantal open taken per tab ('uitgezet': open taken die je voor een ander maakte). */
export type Tellingen = Record<'vandaag' | 'telaat' | 'gepland' | 'ooit' | 'uitgezet', number>;

/** Wat de API stuurt bij een fout. code 'tabel_ontbreekt' = migratie 0018 nog niet uitgevoerd. */
export interface ApiFout {
  error: string;
  code?: 'tabel_ontbreekt' | 'niet_ingelogd' | 'geen_toegang' | 'geen_recht';
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
  projectId?: string | null;
  afgerond?: boolean;
  /** Voor wie (user-id's, minstens één). Bij PATCH: vervangt de hele set. */
  voorWie?: string[];
  /** Alleen bij POST: titels van de subtaken, in volgorde. */
  subtaken?: string[];
}

export interface SubtaakInvoer {
  titel?: string;
  klaar?: boolean;
  volgorde?: number;
}

export interface ProjectInvoer {
  naam?: string;
  klantId?: string | null;
  status?: ProjectStatus;
  notitie?: string;
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
  /** Wie erbij hoort (user-id's). Bij PATCH: vervangt de hele set. */
  deelnemers?: string[];
}
