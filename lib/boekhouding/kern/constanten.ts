// Vaste waarden van de boekhouding: het standaardgrootboek (gelijk aan de seed in migratie
// 0027; scripts/test-boekhouding.mjs controleert dat), vaste rekeningen en drempels.
// Pure module.
//
// Het grootboek blijft voor de gebruiker grotendeels onzichtbaar: bij een boeking kies je een
// categorie (een kosten- of opbrengstrekening); de rest (bank, btw, privé, kruisposten)
// boekt het systeem zelf. RGS-codes zijn indicatief (niveau 2) voor de boekhouder.

import type { BtwCode } from './btw';

export type GrootboekSoort = 'activa' | 'passiva' | 'eigen_vermogen' | 'opbrengst' | 'kosten';

export interface GrootboekSeed {
  code: string;
  naam: string;
  soort: GrootboekSoort;
  /** Groep in de rapporten. */
  rubriek: string;
  rgs: string;
  btw: BtwCode | null;
  /** Hint bij het kiezen (bv. fiscaal beperkt aftrekbaar). */
  hint?: string;
}

export const STANDAARD_GROOTBOEK: GrootboekSeed[] = [
  { code: '0200', naam: 'Inventaris', soort: 'activa', rubriek: 'vaste_activa', rgs: 'BMva', btw: '21' },
  { code: '0209', naam: 'Cum. afschrijving inventaris', soort: 'activa', rubriek: 'vaste_activa', rgs: 'BMva', btw: null },
  { code: '0210', naam: 'Computers & apparatuur', soort: 'activa', rubriek: 'vaste_activa', rgs: 'BMva', btw: '21' },
  { code: '0219', naam: 'Cum. afschrijving computers', soort: 'activa', rubriek: 'vaste_activa', rgs: 'BMva', btw: null },
  { code: '0500', naam: 'Kapitaal Daniel', soort: 'eigen_vermogen', rubriek: 'eigen_vermogen', rgs: 'BEiv', btw: null },
  { code: '0510', naam: 'Kapitaal Bram', soort: 'eigen_vermogen', rubriek: 'eigen_vermogen', rgs: 'BEiv', btw: null },
  { code: '0600', naam: 'Privé Daniel', soort: 'eigen_vermogen', rubriek: 'eigen_vermogen', rgs: 'BEiv', btw: null },
  { code: '0610', naam: 'Privé Bram', soort: 'eigen_vermogen', rubriek: 'eigen_vermogen', rgs: 'BEiv', btw: null },
  { code: '0900', naam: 'Beginbalans / onverdeeld resultaat', soort: 'eigen_vermogen', rubriek: 'eigen_vermogen', rgs: 'BEiv', btw: null },
  { code: '1000', naam: 'Kas', soort: 'activa', rubriek: 'liquide_middelen', rgs: 'BLim', btw: null },
  { code: '1100', naam: 'Bank RegioBank', soort: 'activa', rubriek: 'liquide_middelen', rgs: 'BLim', btw: null },
  { code: '1110', naam: 'Bank Revolut', soort: 'activa', rubriek: 'liquide_middelen', rgs: 'BLim', btw: null },
  { code: '1300', naam: 'Debiteuren', soort: 'activa', rubriek: 'vorderingen', rgs: 'BVor', btw: null },
  { code: '1500', naam: 'Btw te betalen hoog', soort: 'passiva', rubriek: 'btw', rgs: 'BSch', btw: null },
  { code: '1505', naam: 'Btw te betalen laag', soort: 'passiva', rubriek: 'btw', rgs: 'BSch', btw: null },
  { code: '1510', naam: 'Btw verlegd/import te betalen', soort: 'passiva', rubriek: 'btw', rgs: 'BSch', btw: null },
  { code: '1520', naam: 'Voorbelasting', soort: 'activa', rubriek: 'btw', rgs: 'BVor', btw: null },
  { code: '1530', naam: 'Af te dragen btw (aangifte)', soort: 'passiva', rubriek: 'btw', rgs: 'BSch', btw: null },
  { code: '1600', naam: 'Crediteuren', soort: 'passiva', rubriek: 'schulden', rgs: 'BSch', btw: null },
  { code: '1900', naam: 'Vraagposten', soort: 'activa', rubriek: 'vorderingen', rgs: 'BVor', btw: null },
  { code: '2000', naam: 'Kruisposten', soort: 'activa', rubriek: 'liquide_middelen', rgs: 'BLim', btw: null },
  { code: '4000', naam: 'Software & abonnementen', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: '21' },
  { code: '4010', naam: 'Kleine hardware (< € 450)', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: '21' },
  { code: '4100', naam: 'Kantoor & werkplek', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: '21' },
  { code: '4200', naam: 'Reiskosten', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: '21' },
  { code: '4300', naam: 'Marketing & reclame', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: '21' },
  { code: '4400', naam: 'Representatie', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: '21', hint: 'Fiscaal beperkt aftrekbaar' },
  { code: '4500', naam: 'Opleiding', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: '21' },
  { code: '4600', naam: 'Uitbesteed werk', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: '21' },
  { code: '4700', naam: 'Telefoon & internet', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: '21' },
  { code: '4750', naam: 'Verzekeringen', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: 'geen' },
  { code: '4800', naam: 'Afschrijvingen', soort: 'kosten', rubriek: 'afschrijvingen', rgs: 'WAfs', btw: null },
  { code: '4900', naam: 'Bankkosten', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: 'geen' },
  { code: '4990', naam: 'Overige kosten', soort: 'kosten', rubriek: 'kosten', rgs: 'WBed', btw: '21' },
  { code: '8000', naam: 'Omzet', soort: 'opbrengst', rubriek: 'omzet', rgs: 'WOmz', btw: '21' },
  { code: '8010', naam: 'Omzet verlegd / buitenland', soort: 'opbrengst', rubriek: 'omzet', rgs: 'WOmz', btw: 'eu_dienst' },
  { code: '8090', naam: 'Doorberekende kosten', soort: 'opbrengst', rubriek: 'omzet', rgs: 'WOmz', btw: '21' },
  { code: '8900', naam: 'Overige opbrengsten', soort: 'opbrengst', rubriek: 'overige_opbrengsten', rgs: 'WOvb', btw: '21' }
];

/** Vaste rekeningen die het systeem zelf gebruikt. */
export const GB = {
  kas: '1000',
  debiteuren: '1300',
  btwHoog: '1500',
  btwLaag: '1505',
  btwVerlegd: '1510',
  voorbelasting: '1520',
  btwAangifte: '1530',
  crediteuren: '1600',
  vraagposten: '1900',
  kruisposten: '2000',
  beginbalans: '0900',
  afschrijvingen: '4800',
  overigeKosten: '4990',
  omzet: '8000'
} as const;

/** Kosten- en opbrengstrekeningen die het systeem zelf boekt (niet als categorie te kiezen). */
export const NIET_KIESBAAR = new Set<string>([GB.afschrijvingen]);

/** Investeringen (activeren) die je bij een uitgave mag kiezen. */
export const ACTIVA_KIESBAAR = new Set<string>(['0200', '0210']);

/** Vanaf dit bedrag (excl. btw) stellen we voor een aanschaf te activeren (€ 450). */
export const DREMPEL_ACTIVEREN: number = 45_000;

/** Bewaartermijn administratie (art. 52 AWR). */
export const BEWAARTERMIJN_JAREN = 7;
