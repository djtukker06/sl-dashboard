// De opslag van de boekhouding achter één interface, met twee implementaties:
//   - repo/supabase.ts  de echte tabellen (bk_*, migratie 0027), via de RLS-cliënt van het teamlid;
//   - repo/demo.ts      voorbeeldgegevens in het geheugen van de server (per teamlid), zolang
//                       0027 niet is uitgevoerd of BOEKHOUDING_DEMO=1. Schrijft NIETS naar Supabase.
// Schermen, API-routes en rapporten praten alleen met deze interface en de pure kern.

import type { Centen } from '../kern/geld';
import type { Datum } from '../kern/periode';
import type { Boeking, BoekingWaarde, ImportFormaat, Rekening, Stamdata } from '../model';

export type BoekhoudModus = 'live' | 'demo';

export interface RekeningInvoer {
  naam: string;
  iban: string | null;
  importFormaat: ImportFormaat;
  beginsaldo: Centen;
  begindatum: Datum | null;
}

export interface RekeningWijziging {
  naam?: string;
  iban?: string | null;
  importFormaat?: ImportFormaat;
  beginsaldo?: Centen;
  begindatum?: Datum | null;
  actief?: boolean;
}

export interface BoekhoudRepo {
  readonly modus: BoekhoudModus;
  stamdata(): Promise<Stamdata>;
  /** Alle (niet verwijderde) boekingsregels. Het volume is klein (honderden per jaar). */
  boekingen(): Promise<Boeking[]>;
  boeking(id: string): Promise<Boeking | null>;
  boekingToevoegen(w: BoekingWaarde): Promise<Boeking>;
  boekingWijzigen(id: string, w: BoekingWaarde): Promise<Boeking>;
  /** Markeert als verwijderd (bewaarplicht: niets echt weg). */
  boekingVerwijderen(id: string, reden: string): Promise<void>;
  rekeningToevoegen(r: RekeningInvoer): Promise<Rekening>;
  rekeningWijzigen(id: string, w: RekeningWijziging): Promise<Rekening>;
  standaardRekening(id: string): Promise<void>;
}

/** Fout met een HTTP-status en een nette melding voor de gebruiker. */
export class BoekhoudFout extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
