// Boekhouding: vormen, labels, invoercontrole en de berekening van één boekingsregel.
// Pure module (alleen relatieve imports uit ./kern), zodat server, browser en
// scripts/test-boekhouding.mjs hem direct kunnen gebruiken.

import { MAX_CENTEN, naarCenten, type Centen } from './kern/geld';
import { BTW_LABELS, berekenBtw, isBtwCode, type BtwCode, type BtwUitkomst } from './kern/btw';
import { ACTIVA_KIESBAAR, GB, NIET_KIESBAAR, type GrootboekSoort } from './kern/constanten';
import { isDatum, jaarVan, kwartaalVan, plusDagen, vergrendeldReden, type Datum, type Kwartaal, type Vergrendeling } from './kern/periode';

// ---------------------------------------------------------------------------------
// Vormen
// ---------------------------------------------------------------------------------
export const SOORTEN = ['uitgave', 'inkomst', 'prive', 'overboeking', 'btw'] as const;
export type BoekingSoort = (typeof SOORTEN)[number];
export const isSoort = (v: unknown): v is BoekingSoort => typeof v === 'string' && (SOORTEN as readonly string[]).includes(v);

export type Richting = 'af' | 'bij';
export const isRichting = (v: unknown): v is Richting => v === 'af' || v === 'bij';

export type BoekingStatus = 'te_verwerken' | 'geboekt';
export const isStatus = (v: unknown): v is BoekingStatus => v === 'te_verwerken' || v === 'geboekt';

export type ImportFormaat = 'regiobank' | 'revolut' | 'generiek';
export const isImportFormaat = (v: unknown): v is ImportFormaat => v === 'regiobank' || v === 'revolut' || v === 'generiek';

export interface Rekening {
  id: string;
  naam: string;
  iban: string | null;
  grootboek: string;
  standaard: boolean;
  importFormaat: ImportFormaat;
  /** Saldo op de begindatum (start van de administratie voor deze rekening). */
  beginsaldo: Centen;
  begindatum: Datum | null;
  actief: boolean;
  volgorde: number;
  /** Onthouden kolomkeuze voor de CSV-import (generiek formaat), of null. */
  importMapping?: Record<string, unknown> | null;
}

export interface Grootboekrekening {
  code: string;
  naam: string;
  soort: GrootboekSoort;
  rubriek: string;
  rgs: string | null;
  btw: BtwCode | null;
  systeem: boolean;
  actief: boolean;
  hint: string | null;
  volgorde: number;
}

export interface Vennoot {
  id: string;
  naam: string;
  userId: string | null;
  /** Winstaandeel in procenten (bv. 50). */
  aandeel: number;
  grootboekKapitaal: string;
  grootboekPrive: string;
  actief: boolean;
}

export interface Instellingen {
  bedrijfsnaam: string;
  rechtsvorm: string;
  kvk: string | null;
  btwNummer: string | null;
  startdatum: Datum | null;
  kor: boolean;
}

export interface Stamdata {
  instellingen: Instellingen;
  rekeningen: Rekening[];
  grootboek: Grootboekrekening[];
  vennoten: Vennoot[];
  vergrendeling: Vergrendeling;
}

export interface Boeking {
  id: string;
  rekeningId: string | null;
  datum: Datum;
  omschrijving: string;
  tegenpartij: string | null;
  tegenrekening: string | null;
  soort: BoekingSoort;
  richting: Richting;
  /** Het ingevoerde bedrag (positief); incl. of excl. btw volgens isExcl. */
  bedrag: Centen;
  isExcl: boolean;
  btwCode: BtwCode;
  /** De btw zoals opgeslagen (berekend of handmatig). */
  btw: Centen;
  btwHandmatig: boolean;
  grootboek: string | null;
  vennootId: string | null;
  status: BoekingStatus;
  kenmerk: string | null;
  notities: string | null;
  importId: string | null;
  aangemaakt: string;
  aangemaaktDoor: string | null;
  gewijzigd: string;
}

/** Wat er wordt opgeslagen (na controle). */
export interface BoekingWaarde {
  rekeningId: string | null;
  datum: Datum;
  omschrijving: string;
  tegenpartij: string | null;
  soort: BoekingSoort;
  richting: Richting;
  bedrag: Centen;
  isExcl: boolean;
  btwCode: BtwCode;
  btw: Centen;
  btwHandmatig: boolean;
  grootboek: string | null;
  vennootId: string | null;
  status: BoekingStatus;
  notities: string | null;
}

// ---------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------
export const SOORT_LABELS: Record<BoekingSoort, { label: string; kort: string; uitleg: string }> = {
  uitgave: { label: 'Uitgave', kort: 'Uitgave', uitleg: 'Kosten; de btw is voorbelasting' },
  inkomst: { label: 'Inkomst', kort: 'Inkomst', uitleg: 'Omzet; de btw is af te dragen' },
  prive: { label: 'Privé', kort: 'Privé', uitleg: 'Opname of storting van een vennoot (geen kosten, geen btw)' },
  overboeking: { label: 'Eigen rekening', kort: 'Overboeking', uitleg: 'Tussen eigen rekeningen (geen kosten, geen omzet)' },
  btw: { label: 'Btw-aangifte', kort: 'Btw', uitleg: 'Betaling of teruggaaf van de Belastingdienst' }
};

export const RICHTING_LABELS: Record<BoekingSoort, Record<Richting, string>> = {
  uitgave: { af: 'Betaald', bij: 'Terugbetaald' },
  inkomst: { af: 'Terugbetaald', bij: 'Ontvangen' },
  prive: { af: 'Opname', bij: 'Storting' },
  overboeking: { af: 'Naar andere rekening', bij: 'Van andere rekening' },
  btw: { af: 'Betaling', bij: 'Teruggaaf' }
};

export function standaardRichting(soort: BoekingSoort): Richting {
  return soort === 'inkomst' ? 'bij' : 'af';
}

/** Soorten zonder btw (de code is dan altijd 'geen'). */
export function zonderBtw(soort: BoekingSoort): boolean {
  return soort === 'prive' || soort === 'overboeking' || soort === 'btw';
}

export function btwLabel(code: BtwCode, soort: BoekingSoort): string {
  return soort === 'inkomst' ? BTW_LABELS[code].inkomst : BTW_LABELS[code].uitgave;
}

// ---------------------------------------------------------------------------------
// Berekening van één regel
// ---------------------------------------------------------------------------------
export interface BoekingBerekend {
  btw: BtwUitkomst;
  /** +1 bij de gewone richting (uitgave af, inkomst bij), −1 bij een terugbetaling. */
  teken: 1 | -1;
  /** Mutatie op de bank: + bij, − af. */
  bankMutatie: Centen;
  jaar: number;
  kwartaal: Kwartaal;
}

type RekenVelden = Pick<BoekingWaarde, 'soort' | 'richting' | 'bedrag' | 'isExcl' | 'btwCode' | 'datum'> & {
  btw?: Centen;
  btwHandmatig?: boolean;
};

export function berekenBoeking(b: RekenVelden): BoekingBerekend {
  const code: BtwCode = zonderBtw(b.soort) ? 'geen' : b.btwCode;
  const kant = b.soort === 'inkomst' ? 'inkomst' : 'uitgave';
  const btw = berekenBtw({ kant, bedrag: b.bedrag, isExcl: b.isExcl, code, handmatig: b.btwHandmatig ? (b.btw ?? null) : null });
  const gewoon = standaardRichting(b.soort);
  const teken: 1 | -1 = zonderBtw(b.soort) || b.richting === gewoon ? 1 : -1;
  return {
    btw,
    teken,
    bankMutatie: b.richting === 'bij' ? btw.bank : -btw.bank,
    jaar: jaarVan(b.datum),
    kwartaal: kwartaalVan(b.datum)
  };
}

// ---------------------------------------------------------------------------------
// Categorieën (grootboek) per soort
// ---------------------------------------------------------------------------------
export function kiesbareCategorieen(grootboek: Grootboekrekening[], soort: BoekingSoort): Grootboekrekening[] {
  if (soort === 'uitgave') {
    return grootboek.filter((g) => g.actief && ((g.soort === 'kosten' && !NIET_KIESBAAR.has(g.code)) || ACTIVA_KIESBAAR.has(g.code)));
  }
  if (soort === 'inkomst') return grootboek.filter((g) => g.actief && g.soort === 'opbrengst');
  return [];
}

export function standaardCategorie(soort: BoekingSoort): string | null {
  if (soort === 'uitgave') return GB.overigeKosten;
  if (soort === 'inkomst') return GB.omzet;
  return null;
}

// ---------------------------------------------------------------------------------
// Invoercontrole
// ---------------------------------------------------------------------------------
export type Uitkomst<T> = { ok: true; waarde: T } | { ok: false; fout: string; veld?: string };

const tekst = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

/** Zet een opgeslagen boeking om naar invoer (om een wijziging erop te leggen). */
export function boekingAlsInvoer(b: Boeking): Record<string, unknown> {
  return {
    rekeningId: b.rekeningId,
    datum: b.datum,
    omschrijving: b.omschrijving,
    tegenpartij: b.tegenpartij,
    soort: b.soort,
    richting: b.richting,
    bedrag: b.bedrag,
    isExcl: b.isExcl,
    btwCode: b.btwCode,
    btwHandmatig: b.btwHandmatig ? b.btw : null,
    grootboek: b.grootboek,
    vennootId: b.vennootId,
    status: b.status,
    notities: b.notities
  };
}

/**
 * Controleert de invoer van een boekingsregel en rekent de btw uit.
 *   bedrag: centen (getal) of tekst in euro's ("121,00"); `bedragCenten` (getal) heeft voorrang.
 *   btwHandmatig: null/afwezig = automatisch, anders de btw in centen (of tekst in euro's).
 */
export function parseBoekingInvoer(
  body: Record<string, unknown>,
  stam: Stamdata,
  opties: { vandaag: Datum }
): Uitkomst<BoekingWaarde> {
  const soort = body.soort;
  if (!isSoort(soort)) return { ok: false, fout: 'Kies of het een uitgave, inkomst of andere boeking is.', veld: 'soort' };

  // Bank
  let rekeningId: string | null = null;
  if (body.rekeningId !== null && body.rekeningId !== undefined && body.rekeningId !== '') {
    const r = stam.rekeningen.find((x) => x.id === body.rekeningId);
    if (!r) return { ok: false, fout: 'Kies een bestaande bankrekening.', veld: 'rekeningId' };
    rekeningId = r.id;
  } else {
    const standaard = stam.rekeningen.find((x) => x.standaard && x.actief);
    if (!standaard) return { ok: false, fout: 'Kies een bankrekening.', veld: 'rekeningId' };
    rekeningId = standaard.id;
  }

  // Datum
  const datum = body.datum;
  if (!isDatum(datum)) return { ok: false, fout: 'Vul een geldige datum in.', veld: 'datum' };
  if (datum < '2000-01-01') return { ok: false, fout: 'Die datum is te ver in het verleden.', veld: 'datum' };
  if (datum > plusDagen(opties.vandaag, 366)) return { ok: false, fout: 'Die datum ligt te ver in de toekomst.', veld: 'datum' };
  const beginRekening = stam.rekeningen.find((x) => x.id === rekeningId)?.begindatum;
  if (beginRekening && datum < beginRekening) return { ok: false, fout: 'Deze datum ligt vóór het beginsaldo van deze rekening.', veld: 'datum' };

  // Omschrijving
  const omschrijving = tekst(body.omschrijving, 200);
  if (!omschrijving) return { ok: false, fout: 'Vul een omschrijving in (bv. de naam van de leverancier of klant).', veld: 'omschrijving' };
  const tegenpartij = tekst(body.tegenpartij, 200);
  const notities = typeof body.notities === 'string' ? body.notities.trim().slice(0, 2000) || null : null;

  // Richting
  let richting: Richting = standaardRichting(soort);
  if (body.richting !== undefined && body.richting !== null) {
    if (!isRichting(body.richting)) return { ok: false, fout: 'Ongeldige richting.', veld: 'richting' };
    richting = body.richting;
  }

  // Bedrag
  const bedrag = typeof body.bedragCenten === 'number' ? body.bedragCenten : typeof body.bedrag === 'number' ? body.bedrag : naarCenten(body.bedrag);
  if (bedrag === null || !Number.isSafeInteger(bedrag) || bedrag <= 0) return { ok: false, fout: 'Vul een bedrag groter dan € 0 in.', veld: 'bedrag' };
  if (bedrag > MAX_CENTEN) return { ok: false, fout: 'Dat bedrag is te groot.', veld: 'bedrag' };

  // Btw
  let btwCode: BtwCode = 'geen';
  let isExcl = false;
  let handmatig: Centen | null = null;
  if (!zonderBtw(soort)) {
    if (!isBtwCode(body.btwCode)) return { ok: false, fout: 'Kies het btw-tarief.', veld: 'btwCode' };
    btwCode = body.btwCode;
    isExcl = body.isExcl === true && (btwCode === '21' || btwCode === '9');
    const h = body.btwHandmatig;
    if (h !== null && h !== undefined && h !== '') {
      if (btwCode === '0' || btwCode === 'geen' || (soort === 'inkomst' && btwCode !== '21' && btwCode !== '9')) {
        return { ok: false, fout: 'Bij dit tarief is er geen btw om aan te passen.', veld: 'btwHandmatig' };
      }
      const c = typeof h === 'number' ? h : naarCenten(h);
      if (c === null || !Number.isSafeInteger(c) || c < 0) return { ok: false, fout: 'Ongeldig btw-bedrag.', veld: 'btwHandmatig' };
      if (!isExcl && (btwCode === '21' || btwCode === '9') && c >= bedrag) {
        return { ok: false, fout: 'De btw kan niet hoger zijn dan het bedrag.', veld: 'btwHandmatig' };
      }
      if (c > MAX_CENTEN) return { ok: false, fout: 'Ongeldig btw-bedrag.', veld: 'btwHandmatig' };
      handmatig = c;
    }
  }

  // Categorie / vennoot
  let grootboek: string | null = null;
  let vennootId: string | null = null;
  if (soort === 'uitgave' || soort === 'inkomst') {
    const code = body.grootboek === undefined || body.grootboek === null || body.grootboek === '' ? standaardCategorie(soort) : body.grootboek;
    const keuze = kiesbareCategorieen(stam.grootboek, soort).find((g) => g.code === code);
    if (!keuze) return { ok: false, fout: 'Kies een geldige categorie.', veld: 'grootboek' };
    grootboek = keuze.code;
  } else if (soort === 'prive') {
    const v = stam.vennoten.find((x) => x.id === body.vennootId && x.actief);
    if (!v) return { ok: false, fout: 'Kies de vennoot van deze privé-boeking.', veld: 'vennootId' };
    vennootId = v.id;
  }

  const status: BoekingStatus = isStatus(body.status) ? body.status : 'geboekt';

  const berekend = berekenBoeking({ soort, richting, bedrag, isExcl, btwCode, datum, btw: handmatig ?? 0, btwHandmatig: handmatig !== null });
  return {
    ok: true,
    waarde: {
      rekeningId,
      datum,
      omschrijving,
      tegenpartij,
      soort,
      richting,
      bedrag,
      isExcl,
      btwCode,
      btw: berekend.btw.btw,
      btwHandmatig: handmatig !== null,
      grootboek,
      vennootId,
      status,
      notities
    }
  };
}

/** De velden die meetellen voor saldo, btw of resultaat (gelijk aan de trigger in 0027). */
const FINANCIEEL = ['datum', 'rekeningId', 'soort', 'richting', 'bedrag', 'isExcl', 'btwCode', 'btw', 'grootboek', 'vennootId'] as const;

export function financieelGewijzigd(oud: Boeking, nieuw: BoekingWaarde): boolean {
  return FINANCIEEL.some((k) => (oud[k] ?? null) !== (nieuw[k] ?? null));
}

/**
 * Mag dit in de huidige vergrendeling? null = ja, anders de melding.
 *   nieuw: de datum moet in een open periode vallen;
 *   wijzigen: alleen omschrijving, tegenpartij, notities en status mogen in een vergrendelde
 *             periode; al het andere (bedrag, btw, datum, …) niet — oud én nieuw moeten open zijn;
 *   verwijderen: alleen in een open periode (geef dan nieuw = null).
 */
export function vergrendelFout(oud: Boeking | null, nieuw: BoekingWaarde | null, v: Vergrendeling): string | null {
  if (!oud && nieuw) return vergrendeldReden(nieuw.datum, v);
  if (oud && !nieuw) return vergrendeldReden(oud.datum, v);
  if (oud && nieuw && financieelGewijzigd(oud, nieuw)) return vergrendeldReden(oud.datum, v) ?? vergrendeldReden(nieuw.datum, v);
  return null;
}

// ---------------------------------------------------------------------------------
// Lijsten: lopend saldo en totalen
// ---------------------------------------------------------------------------------
export function sorteerBoekingen(lijst: Boeking[]): Boeking[] {
  return [...lijst].sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.aangemaakt < b.aangemaakt ? -1 : a.aangemaakt > b.aangemaakt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Lopend saldo per rekening na elke regel (op datumvolgorde, vanaf het beginsaldo).
 * Regels vóór de begindatum van een rekening tellen niet mee in het saldo (het beginsaldo
 * geldt op de begindatum).
 */
export function lopendSaldo(boekingen: Boeking[], rekeningen: Rekening[]): Map<string, Centen> {
  const saldo = new Map<string, Centen>();
  for (const r of rekeningen) saldo.set(r.id, r.beginsaldo);
  const begin = new Map(rekeningen.map((r) => [r.id, r.begindatum]));
  const uit = new Map<string, Centen>();
  for (const b of sorteerBoekingen(boekingen)) {
    if (!b.rekeningId || !saldo.has(b.rekeningId)) continue;
    const bd = begin.get(b.rekeningId);
    if (bd && b.datum < bd) continue;
    const s = (saldo.get(b.rekeningId) ?? 0) + berekenBoeking(b).bankMutatie;
    saldo.set(b.rekeningId, s);
    uit.set(b.id, s);
  }
  return uit;
}

/** Eindsaldo per rekening (beginsaldo + alle regels vanaf de begindatum). */
export function saldoPerRekening(boekingen: Boeking[], rekeningen: Rekening[]): Map<string, Centen> {
  const saldo = new Map<string, Centen>(rekeningen.map((r) => [r.id, r.beginsaldo]));
  const begin = new Map(rekeningen.map((r) => [r.id, r.begindatum]));
  for (const b of boekingen) {
    if (!b.rekeningId || !saldo.has(b.rekeningId)) continue;
    const bd = begin.get(b.rekeningId);
    if (bd && b.datum < bd) continue;
    saldo.set(b.rekeningId, (saldo.get(b.rekeningId) ?? 0) + berekenBoeking(b).bankMutatie);
  }
  return saldo;
}

export interface Totalen {
  bij: Centen;
  af: Centen;
  voorbelasting: Centen;
  verschuldigd: Centen;
  aantal: number;
}

/**
 * Totalen van een (gefilterde) lijst: geld in/uit en de btw (met teken bij terugbetalingen).
 * Regels in `gekoppeld` (betalingen van een factuur of bonnetje) tellen niet mee voor de btw:
 * die komt uit het document zelf.
 */
export function totalen(lijst: Boeking[], gekoppeld?: ReadonlySet<string>): Totalen {
  const t: Totalen = { bij: 0, af: 0, voorbelasting: 0, verschuldigd: 0, aantal: lijst.length };
  for (const b of lijst) {
    const r = berekenBoeking(b);
    if (r.bankMutatie >= 0) t.bij += r.bankMutatie;
    else t.af -= r.bankMutatie;
    if (gekoppeld?.has(b.id) && (b.soort === 'inkomst' || b.soort === 'uitgave')) continue;
    t.voorbelasting += r.teken * r.btw.voorbelasting;
    t.verschuldigd += r.teken * r.btw.verschuldigd;
  }
  return t;
}

// ---------------------------------------------------------------------------------
// Bankrekeningen
// ---------------------------------------------------------------------------------
/** "NL91 ABNA 0417 1643 00" → "NL91ABNA0417164300"; null als het geen geldige IBAN is (mod-97). */
export function normaliseerIban(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\s.-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$/.test(s)) return null;
  const herschikt = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of herschikt) {
    const n = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const cijfer of n) rest = (rest * 10 + Number(cijfer)) % 97;
  }
  return rest === 1 ? s : null;
}

/** "NL91ABNA0417164300" → "NL91 ABNA 0417 1643 00" */
export function formatIban(iban: string | null): string {
  return iban ? iban.replace(/(.{4})/g, '$1 ').trim() : '';
}

export interface RekeningVelden {
  naam?: string;
  iban?: string | null;
  importFormaat?: ImportFormaat;
  beginsaldo?: Centen;
  begindatum?: Datum | null;
  actief?: boolean;
}

/** Controleert (een deel van) de velden van een bankrekening. `nieuw` = naam verplicht. */
export function parseRekeningInvoer(body: Record<string, unknown>, nieuw: boolean): Uitkomst<RekeningVelden> {
  const uit: RekeningVelden = {};
  if (nieuw || body.naam !== undefined) {
    const naam = tekst(body.naam, 80);
    if (!naam) return { ok: false, fout: 'Geef de rekening een naam (bv. de bank).', veld: 'naam' };
    uit.naam = naam;
  }
  if (body.iban !== undefined) {
    if (body.iban === null || body.iban === '') uit.iban = null;
    else {
      const iban = normaliseerIban(body.iban);
      if (!iban) return { ok: false, fout: 'Dit is geen geldig IBAN-nummer.', veld: 'iban' };
      uit.iban = iban;
    }
  }
  if (body.importFormaat !== undefined) {
    if (!isImportFormaat(body.importFormaat)) return { ok: false, fout: 'Onbekend importformaat.', veld: 'importFormaat' };
    uit.importFormaat = body.importFormaat;
  }
  if (body.beginsaldo !== undefined) {
    const c = typeof body.beginsaldo === 'number' ? body.beginsaldo : body.beginsaldo === '' ? 0 : naarCenten(body.beginsaldo);
    if (c === null || !Number.isSafeInteger(c) || Math.abs(c) > MAX_CENTEN) return { ok: false, fout: 'Ongeldig beginsaldo.', veld: 'beginsaldo' };
    uit.beginsaldo = c;
  }
  if (body.begindatum !== undefined) {
    if (body.begindatum === null || body.begindatum === '') uit.begindatum = null;
    else if (!isDatum(body.begindatum)) return { ok: false, fout: 'Ongeldige begindatum.', veld: 'begindatum' };
    else uit.begindatum = body.begindatum;
  }
  if (body.actief !== undefined) {
    if (typeof body.actief !== 'boolean') return { ok: false, fout: 'Ongeldige waarde voor actief.', veld: 'actief' };
    uit.actief = body.actief;
  }
  if ((uit.beginsaldo ?? 0) !== 0 && uit.begindatum === null) {
    return { ok: false, fout: 'Geef ook de datum van het beginsaldo op.', veld: 'begindatum' };
  }
  return { ok: true, waarde: uit };
}
