// De opslag van de boekhouding achter één interface, met twee implementaties:
//   - repo/supabase.ts  de echte tabellen (bk_*, migratie 0027), via de RLS-cliënt van het teamlid;
//   - repo/demo.ts      voorbeeldgegevens in het geheugen van de server (per teamlid), zolang
//                       0027 niet is uitgevoerd of BOEKHOUDING_DEMO=1. Schrijft NIETS naar Supabase.
// Schermen, API-routes en rapporten praten alleen met deze interface en de pure kern.

import type { Centen } from '../kern/geld';
import type { Datum } from '../kern/periode';
import type { Boeking, BoekingWaarde, ImportFormaat, Rekening, Stamdata } from '../model';
import type { BronExtra, FactuurBron, KoppelBron, Koppeling, UitgaveBron } from '../kern/bronnen';
import type { ImportBoeking, Kolommapping } from '../kern/bankimport';

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
  /** De kolomkeuze voor de CSV-import van deze rekening onthouden (null = wissen). */
  importMappingOpslaan(rekeningId: string, mapping: Kolommapping | null): Promise<void>;

  /** Facturen (invoices) en bonnetjes (expenses) als bron. ALLEEN LEZEN. */
  bronnen(): Promise<{ facturen: FactuurBron[]; uitgaven: UitgaveBron[] }>;
  /** Koppelingen van niet-verwijderde boekingen. */
  koppelingen(): Promise<Koppeling[]>;
  koppelingToevoegen(k: { boekingId: string; bron: KoppelBron; bronId: string; bedrag: Centen }): Promise<Koppeling>;
  koppelingVerwijderen(id: string): Promise<void>;
  bronExtra(): Promise<BronExtra[]>;
  bronExtraOpslaan(e: BronExtra): Promise<BronExtra>;
  /** Importsleutels die voor deze rekening al bestaan (ook van verwijderde regels). */
  importSleutels(rekeningId: string): Promise<Set<string>>;
  /** Nieuwe regels (status te_verwerken) in één keer; dubbele sleutels worden overgeslagen. */
  importeer(rekeningId: string, meta: { bestandsnaam: string; formaat: ImportFormaat }, regels: ImportBoeking[]): Promise<{ nieuw: number; dubbel: number }>;
}

export interface BoekhoudData {
  stam: Stamdata;
  boekingen: Boeking[];
  koppelingen: Koppeling[];
  facturen: FactuurBron[];
  uitgaven: UitgaveBron[];
  bronExtra: BronExtra[];
}

/** Alles wat de schermen en het journaal nodig hebben, in één keer. */
export async function laadAlles(repo: BoekhoudRepo): Promise<BoekhoudData> {
  const [stam, boekingen, koppelingen, bronnen, bronExtra] = await Promise.all([repo.stamdata(), repo.boekingen(), repo.koppelingen(), repo.bronnen(), repo.bronExtra()]);
  // Alleen koppelingen van bestaande (niet-verwijderde) boekingen.
  const ids = new Set(boekingen.map((b) => b.id));
  return { stam, boekingen, koppelingen: koppelingen.filter((k) => ids.has(k.boekingId)), facturen: bronnen.facturen, uitgaven: bronnen.uitgaven, bronExtra };
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
