// Facturen en bonnetjes als bron van de boekhouding. ALLEEN LEZEN: de factuurtool en de
// bonnetjes blijven ongewijzigd; de boekhouding leidt er bij het lezen journaalposten uit af.
// Betaalkoppelingen (afletteren) en boekhoudkundige verfijningen staan in eigen tabellen
// (bk_koppelingen, bk_bron_extra). Pure module: geen netwerk, geen klok, geen '@/'-imports.
//
// Bedragen in invoices/expenses zijn numeric(12,2) in euro's. We lezen ze als tekst of getal
// en zetten ze exact om naar hele centen (naarCenten), nooit met float-rekenwerk.

import { naarCenten, type Centen } from './geld';
import { btwUitIncl, isBtwCode, type BtwCode } from './btw';
import { GB } from './constanten';
import { datumNL, isDatum, type Datum } from './periode';

/** Betalingstermijn op de factuur-PDF ("binnen 14 dagen"). */
export const BETAALTERMIJN_DAGEN = 14;

export interface FactuurBron {
  id: string;
  nummer: string;
  klant: string;
  /** Factuurdatum (Nederlandse dag van issued_at): bepaalt het btw-kwartaal. */
  datum: Datum;
  /** Subtotaal excl. btw (alle regels). */
  subtotaal: Centen;
  /** Deel van het subtotaal dat als omzet telt (revenue_subtotal); de rest is doorberekend. */
  omzet: Centen;
  btw: Centen;
  totaal: Centen;
  btwPct: number;
  verlegd: boolean;
  verlegdReden: string | null;
  /** Aanbetalingsfactuur (deposit_percentage gevuld). */
  aanbetaling: boolean;
  /** Restfactuur van deze aanbetalingsfactuur (remainder_of_invoice_id). */
  restVan: string | null;
}

export type UitgaveTarief = '21' | '9' | '0' | 'verlegd' | 'geen';
export type Betaalwijze = 'zakelijk' | 'prive' | 'creditcard' | 'contant';

export interface UitgaveBron {
  id: string;
  datum: Datum | null;
  leverancier: string;
  omschrijving: string;
  categorie: string | null;
  /** Totaal incl. btw (bij verlegd: het betaalde bedrag zonder btw). */
  totaal: Centen | null;
  btw: Centen | null;
  tarief: UitgaveTarief | null;
  valuta: string;
  betaalwijze: Betaalwijze | null;
  status: 'concept' | 'verwerkt';
  factuurnummer: string;
  aangemaaktDoor: string | null;
}

export type KoppelBron = 'factuur' | 'uitgave';
export const isKoppelBron = (v: unknown): v is KoppelBron => v === 'factuur' || v === 'uitgave';

/** Een bankregel die (een deel van) een factuur of bonnetje betaalt. */
export interface Koppeling {
  id: string;
  boekingId: string;
  bron: KoppelBron;
  bronId: string;
  /** Betaald bedrag in de richting van het document (positief bij een gewone factuur/bon). */
  bedrag: Centen;
  aangemaakt: string;
}

/** Boekhoudkundige verfijning van een factuur of bonnetje (zonder het origineel te wijzigen). */
export interface BronExtra {
  bron: KoppelBron;
  bronId: string;
  btwCode: BtwCode | null;
  grootboek: string | null;
  vennootId: string | null;
  notitie: string | null;
}

// ---------------------------------------------------------------------------------
// Rijen uit de database (of de demo) omzetten
// ---------------------------------------------------------------------------------
type Rij = Record<string, unknown>;
const tekst = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const centen = (v: unknown): Centen | null => naarCenten(typeof v === 'number' ? v.toFixed(2) : v);

/** Een factuurrij (invoices) als bron; null als er iets wezenlijks ontbreekt. */
export function factuurUitRij(r: Rij): FactuurBron | null {
  const id = tekst(r.id);
  if (!id || typeof r.issued_at !== 'string') return null;
  let datum: Datum;
  try {
    datum = datumNL(r.issued_at);
  } catch {
    return null;
  }
  const subtotaal = centen(r.subtotal);
  const btw = centen(r.vat_amount) ?? 0;
  const totaal = centen(r.total);
  if (subtotaal === null || totaal === null) return null;
  const omzet = centen(r.revenue_subtotal) ?? subtotaal;
  const pct = Number(tekst(r.vat_percentage) || '21');
  return {
    id,
    nummer: tekst(r.invoice_number) || '—',
    klant: tekst(r.client_company_name) || '—',
    datum,
    subtotaal,
    omzet,
    btw,
    totaal,
    btwPct: Number.isFinite(pct) ? pct : 21,
    verlegd: r.vat_reverse_charged === true,
    verlegdReden: tekst(r.vat_reverse_charge_reason) || null,
    aanbetaling: r.deposit_percentage !== null && r.deposit_percentage !== undefined,
    restVan: tekst(r.remainder_of_invoice_id) || null
  };
}

const TARIEVEN: UitgaveTarief[] = ['21', '9', '0', 'verlegd', 'geen'];
const BETAALWIJZEN: Betaalwijze[] = ['zakelijk', 'prive', 'creditcard', 'contant'];

/** Een bonnetjesrij (expenses) als bron. */
export function uitgaveUitRij(r: Rij): UitgaveBron | null {
  const id = tekst(r.id);
  if (!id) return null;
  const datum = isDatum(r.expense_date) ? r.expense_date : null;
  return {
    id,
    datum,
    leverancier: tekst(r.supplier),
    omschrijving: tekst(r.description),
    categorie: tekst(r.category) || null,
    totaal: centen(r.total_amount),
    btw: centen(r.vat_amount),
    tarief: TARIEVEN.includes(r.vat_rate as UitgaveTarief) ? (r.vat_rate as UitgaveTarief) : null,
    valuta: tekst(r.currency) || 'EUR',
    betaalwijze: BETAALWIJZEN.includes(r.payment_method as Betaalwijze) ? (r.payment_method as Betaalwijze) : null,
    status: r.status === 'verwerkt' ? 'verwerkt' : 'concept',
    factuurnummer: tekst(r.invoice_number),
    aangemaaktDoor: tekst(r.created_by) || null
  };
}

export function bronExtraUitRij(r: Rij): BronExtra | null {
  if (!isKoppelBron(r.bron) || !r.bron_id) return null;
  return {
    bron: r.bron,
    bronId: tekst(r.bron_id),
    btwCode: isBtwCode(r.btw_code) ? r.btw_code : null,
    grootboek: tekst(r.grootboek_code) || null,
    vennootId: tekst(r.vennoot_id) || null,
    notitie: tekst(r.notitie) || null
  };
}

// ---------------------------------------------------------------------------------
// Btw-code, categorie en tegenrekening van een bron
// ---------------------------------------------------------------------------------
/** Woorden in de reden van verlegging die op een EU-afnemer wijzen (rubriek 3b + ICP). */
const EU_REDEN = /\b(eu|e\.u\.|intra-?communautair|icp|art(ikel)?\.?\s*(44|138|196)|reverse charge|lidstaat|vat\s?id|ust-?id)/i;

/**
 * Btw-code van een factuur:
 *   verlegd → eu_dienst (3b) als de reden naar een EU-afnemer wijst, anders verlegd_nl (1e);
 *   anders volgens het percentage: 21 → 1a, 9 → 1b, 0 → 1e.
 * Een verfijning (bk_bron_extra.btw_code) gaat voor.
 */
export function factuurBtwCode(f: FactuurBron, extra?: BronExtra | null): BtwCode {
  if (extra?.btwCode) return extra.btwCode;
  if (f.verlegd) return f.verlegdReden && EU_REDEN.test(f.verlegdReden) ? 'eu_dienst' : 'verlegd_nl';
  if (f.btwPct === 9) return '9';
  if (f.btwPct === 0 || f.btw === 0) return '0';
  return '21';
}

/**
 * Btw-code van een bonnetje. "verlegd" is meestal software uit de EU (Adobe/Google Ierland,
 * rubriek 4b); via een verfijning is het te wijzigen naar verlegd binnenland (2a) of buiten de
 * EU (4a).
 */
export function uitgaveBtwCode(u: UitgaveBron, extra?: BronExtra | null): BtwCode {
  if (extra?.btwCode) return extra.btwCode;
  switch (u.tarief) {
    case '21':
    case '9':
    case '0':
    case 'geen':
      return u.tarief;
    case 'verlegd':
      return 'eu_dienst';
    default:
      return u.btw && u.btw !== 0 ? '21' : 'geen';
  }
}

/** Bonnetjescategorie → kostenrekening (zelfde indeling als de bonnetjes). */
export const CATEGORIE_GROOTBOEK: Record<string, string> = {
  software: '4000',
  hardware: '4010',
  kantoor: '4100',
  reiskosten: '4200',
  marketing: '4300',
  representatie: '4400',
  opleiding: '4500',
  uitbesteed: '4600',
  telefoon: '4700',
  bankkosten: '4900',
  overig: GB.overigeKosten
};

export function uitgaveGrootboek(u: UitgaveBron, extra?: BronExtra | null): string {
  if (extra?.grootboek) return extra.grootboek;
  return (u.categorie && CATEGORIE_GROOTBOEK[u.categorie]) || GB.overigeKosten;
}

/** Telt een bonnetje mee in de boekhouding? Zo niet: de reden (voor de controles). */
export function uitgaveTeltNiet(u: UitgaveBron): string | null {
  if (u.status !== 'verwerkt') return 'nog in concept';
  if (u.valuta !== 'EUR') return `in ${u.valuta}`;
  if (!u.datum || u.totaal === null) return 'datum of bedrag ontbreekt';
  return null;
}

/** Wordt een bonnetje via de zakelijke rekening betaald (en hoort er dus een bankregel bij)? */
export function uitgaveViaBank(u: UitgaveBron): boolean {
  return u.betaalwijze === null || u.betaalwijze === 'zakelijk' || u.betaalwijze === 'creditcard';
}

/** De btw van een bonnetje in centen (bij 21/9 zonder ingevuld bedrag: berekend uit het totaal). */
export function uitgaveBtw(u: UitgaveBron, code: BtwCode): Centen {
  const totaal = u.totaal ?? 0;
  if (code === '21' || code === '9') return u.btw ?? btwUitIncl(totaal, code === '21' ? 21 : 9);
  return 0;
}

/** Korte naam van een factuur in lijsten. */
export function factuurLabel(f: FactuurBron): string {
  return `Factuur ${f.nummer}`;
}

export function uitgaveLabel(u: UitgaveBron): string {
  return u.leverancier || u.omschrijving || 'Bonnetje';
}
