// De opslag van de boekhouding achter één interface, met twee implementaties:
//   - repo/supabase.ts  de echte tabellen (bk_*, migratie 0027), via de RLS-cliënt van het teamlid;
//   - repo/demo.ts      voorbeeldgegevens in het geheugen van de server (per teamlid), alleen met
//                       BOEKHOUDING_DEMO=1 (ontbrekende tabellen geven "nog niet ingericht", nooit
//                       de demo). Schrijft NIETS naar Supabase.
// Schermen, API-routes en rapporten praten alleen met deze interface en de pure kern.

import type { Centen } from '../kern/geld';
import { journaal, type JournaalPost, type Memoriaal, type MemoriaalRegel } from '../kern/journaal';
import type { Datum } from '../kern/periode';
import type { Boeking, BoekingWaarde, Grootboekrekening, ImportFormaat, Instellingen, Rekening, Stamdata } from '../model';
import type { BtwCode } from '../kern/btw';
import type { BronExtra, FactuurBron, KoppelBron, Koppeling, UitgaveBron } from '../kern/bronnen';
import type { ImportBoeking, Kolommapping } from '../kern/bankimport';
import type { Aangifte, AangifteBetaling, AangifteSnapshot } from '../kern/aangifte';
import type { Activum, ActivumWaarde } from '../kern/afschrijving';
import type { Kwartaal } from '../kern/periode';

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

/** Een afgesloten boekjaar (een rij = het jaar is vergrendeld). */
export interface Boekjaar {
  jaar: number;
  afgeslotenOp: string;
  afgeslotenDoor: string | null;
  memoriaalId: string | null;
  samenvatting: Record<string, unknown>;
}

export interface MemoriaalInvoer {
  datum: Datum;
  omschrijving: string;
  soort: 'beginbalans' | 'correctie';
  regels: MemoriaalRegel[];
}

export interface InstellingenWijziging {
  bedrijfsnaam?: string;
  kvk?: string | null;
  btwNummer?: string | null;
  startdatum?: Datum | null;
}

export interface GrootboekInvoer {
  code: string;
  naam: string;
  soort: 'kosten' | 'opbrengst';
  btw: BtwCode | null;
}

export interface GrootboekWijziging {
  naam?: string;
  actief?: boolean;
  btw?: BtwCode | null;
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

  /** Ingediende btw-aangiften (een rij = het kwartaal is vergrendeld). */
  aangiften(): Promise<Aangifte[]>;
  /** Markeert een kwartaal als ingediend met de berekening op dat moment (vergrendelt het kwartaal). */
  aangifteIndienen(a: { jaar: number; kwartaal: Kwartaal; snapshot: AangifteSnapshot; teBetalen: Centen; kenmerk: string | null; opmerking: string | null }): Promise<Aangifte>;
  /** Intrekken (= ontgrendelen); alleen de eigenaar (de route controleert dat, RLS ook). */
  aangifteIntrekken(id: string): Promise<void>;
  /** Btw-betalingen/-teruggaven gekoppeld aan een aangifte (bk_koppelingen, bron 'aangifte'). */
  aangifteBetalingen(): Promise<AangifteBetaling[]>;
  aangifteBetalingKoppelen(k: { boekingId: string; aangifteId: string; bedrag: Centen }): Promise<AangifteBetaling>;
  aangifteBetalingOntkoppelen(id: string): Promise<void>;

  /** Vaste activa (afschrijvingen worden daaruit afgeleid). */
  activa(): Promise<Activum[]>;
  activumToevoegen(w: ActivumWaarde): Promise<Activum>;
  activumWijzigen(id: string, w: ActivumWaarde): Promise<Activum>;
  activumVerwijderen(id: string): Promise<void>;

  /** Memoriaalposten (beginbalans, correcties en jaarafsluitingen). */
  memoriaal(): Promise<Memoriaal[]>;
  /** Een sluitende memoriaalpost in een open periode (beginbalans of correctie). */
  memoriaalToevoegen(m: MemoriaalInvoer): Promise<Memoriaal>;
  /** Verwijderen kan alleen in een open periode; een jaarafsluiting gaat via jaarHeropenen. */
  memoriaalVerwijderen(id: string): Promise<void>;
  boekjaren(): Promise<Boekjaar[]>;
  /** Afsluitpost + vergrendeling van het jaar in één keer (alleen de eigenaar). */
  jaarAfsluiten(a: { jaar: number; omschrijving: string; regels: MemoriaalRegel[]; samenvatting: Record<string, unknown> }): Promise<Boekjaar>;
  /** Afsluitpost weg en het jaar weer open (alleen de eigenaar; niet als een later jaar dicht is). */
  jaarHeropenen(jaar: number): Promise<void>;

  instellingenWijzigen(w: InstellingenWijziging): Promise<Instellingen>;
  /** Winstaandelen van de vennoten (samen 100%; alleen de eigenaar). */
  aandelenWijzigen(a: { id: string; aandeel: number }[]): Promise<void>;
  /** Een eigen categorie (kosten of opbrengst) toevoegen of wijzigen (naam, standaard-btw, actief). */
  grootboekToevoegen(g: GrootboekInvoer): Promise<Grootboekrekening>;
  grootboekWijzigen(code: string, w: GrootboekWijziging): Promise<Grootboekrekening>;
}

export interface BoekhoudData {
  stam: Stamdata;
  boekingen: Boeking[];
  koppelingen: Koppeling[];
  facturen: FactuurBron[];
  uitgaven: UitgaveBron[];
  bronExtra: BronExtra[];
  activa: Activum[];
  aangiften: Aangifte[];
  aangifteBetalingen: AangifteBetaling[];
  memoriaal: Memoriaal[];
  boekjaren: Boekjaar[];
}

/** Alles wat de schermen en het journaal nodig hebben, in één keer. */
export async function laadAlles(repo: BoekhoudRepo): Promise<BoekhoudData> {
  const [stam, boekingen, koppelingen, bronnen, bronExtra, activa, aangiften, betalingen, memoriaal, boekjaren] = await Promise.all([
    repo.stamdata(),
    repo.boekingen(),
    repo.koppelingen(),
    repo.bronnen(),
    repo.bronExtra(),
    repo.activa(),
    repo.aangiften(),
    repo.aangifteBetalingen(),
    repo.memoriaal(),
    repo.boekjaren()
  ]);
  // Alleen koppelingen van bestaande (niet-verwijderde) boekingen en bestaande aangiften.
  const ids = new Set(boekingen.map((b) => b.id));
  const aIds = new Set(aangiften.map((a) => a.id));
  return {
    stam,
    boekingen,
    koppelingen: koppelingen.filter((k) => ids.has(k.boekingId)),
    facturen: bronnen.facturen,
    uitgaven: bronnen.uitgaven,
    bronExtra,
    activa,
    aangiften,
    aangifteBetalingen: betalingen.filter((b) => ids.has(b.boekingId) && aIds.has(b.aangifteId)),
    memoriaal,
    boekjaren
  };
}

/** Het volledige journaal van alle bronnen (zelfde kern voor live en demo). */
export function journaalVan(d: BoekhoudData): JournaalPost[] {
  return journaal(d.stam, {
    boekingen: d.boekingen,
    memoriaal: d.memoriaal,
    facturen: d.facturen,
    uitgaven: d.uitgaven,
    koppelingen: d.koppelingen,
    bronExtra: d.bronExtra,
    activa: d.activa,
    aangiften: d.aangiften.map((a) => ({ id: a.id, jaar: a.jaar, kwartaal: a.kwartaal, snapshot: a.snapshot }))
  });
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
