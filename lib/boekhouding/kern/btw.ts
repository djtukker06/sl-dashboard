// Btw-codes en de btw-berekening per regel, in hele centen. Pure module.
//
// De codes horen bij de wet, niet bij de gebruiker: een constante hier + een CHECK in de
// database (migratie 0027), geen aparte tabel.
//
//   code         verkoop (inkomst)               inkoop (uitgave)
//   21           1a, 21% af te dragen            5b, 21% voorbelasting
//   9            1b, 9% af te dragen             5b, 9% voorbelasting
//   0            1e (0% / niet bij u belast)     —
//   geen         geen rubriek (vrijgesteld)      — (bv. bankkosten, verzekeringen)
//   verlegd_nl   1e (btw verlegd binnenland)     2a + 5b: 21% verschuldigd én aftrekbaar
//   eu_dienst    3b (dienst aan EU-ondernemer)   4b + 5b: idem (bv. Adobe/Google Ierland)
//   buiten_eu    geen rubriek (dienst aan een    4a + 5b: idem (bv. SaaS uit de VS)
//                ondernemer buiten de EU)
//
// Bij verlegging (2a/4a/4b) staat er op de bank het bedrag ZONDER btw: er is geen btw betaald.
// We rekenen 21% over het bankbedrag uit en boeken die als verschuldigd én als voorbelasting
// (per saldo € 0, maar wel zichtbaar in de aangifte). Een dienst aan een ondernemer buiten de EU
// is buiten Nederland belast en komt volgens de Belastingdienst NIET in de btw-aangifte (ook niet
// in 1e); hij telt wel als omzet. Rubriek 3a is voor goederen (uitvoer) en komt bij een
// dienstverlener niet voor.

import { MAX_CENTEN, moetCenten, rondAf, type Centen } from './geld';

export const BTW_CODES = ['21', '9', '0', 'geen', 'verlegd_nl', 'eu_dienst', 'buiten_eu'] as const;
export type BtwCode = (typeof BTW_CODES)[number];

export const isBtwCode = (v: unknown): v is BtwCode => typeof v === 'string' && (BTW_CODES as readonly string[]).includes(v);

/** Het tarief waarmee bij verlegging (2a, 4a, 4b) de btw wordt berekend. */
export const VERLEGD_TARIEF = 21;

/** Verschil (in centen) tussen handmatige en berekende btw waarboven we waarschuwen. */
export const HANDMATIG_TOLERANTIE = 2;

export type Rubriek = '1a' | '1b' | '1c' | '1d' | '1e' | '2a' | '3a' | '3b' | '3c' | '4a' | '4b' | '5b';

export const BTW_LABELS: Record<BtwCode, { kort: string; uitgave: string; inkomst: string }> = {
  '21': { kort: '21%', uitgave: '21% btw', inkomst: '21% btw' },
  '9': { kort: '9%', uitgave: '9% btw', inkomst: '9% btw' },
  '0': { kort: '0%', uitgave: '0% btw', inkomst: '0% / niet belast' },
  geen: { kort: 'geen', uitgave: 'Geen btw (vrijgesteld)', inkomst: 'Geen btw (vrijgesteld)' },
  verlegd_nl: { kort: 'verlegd', uitgave: 'Btw verlegd naar mij (NL)', inkomst: 'Btw verlegd (NL-klant)' },
  eu_dienst: { kort: 'EU', uitgave: 'Dienst uit EU, verlegd (bv. Adobe)', inkomst: 'Dienst aan EU-klant, verlegd' },
  buiten_eu: { kort: 'buiten EU', uitgave: 'Dienst van buiten de EU', inkomst: 'Dienst aan klant buiten EU' }
};

/** Het tarief van een code (verlegde codes: het verlegde tarief; 0/geen: 0). */
export function tariefVan(code: BtwCode): number {
  if (code === '21') return 21;
  if (code === '9') return 9;
  if (code === 'verlegd_nl' || code === 'eu_dienst' || code === 'buiten_eu') return VERLEGD_TARIEF;
  return 0;
}

export function isVerlegd(code: BtwCode): boolean {
  return code === 'verlegd_nl' || code === 'eu_dienst' || code === 'buiten_eu';
}

/** Btw uit een bedrag inclusief btw: round(incl × p / (100 + p)). */
export function btwUitIncl(incl: Centen, pct: number): Centen {
  moetCenten(incl);
  if (!Number.isInteger(pct) || pct < 0) throw new Error('ongeldig tarief');
  return pct === 0 ? 0 : rondAf(incl * pct, 100 + pct);
}

/** Btw over een bedrag exclusief btw: round(excl × p / 100). */
export function btwUitExcl(excl: Centen, pct: number): Centen {
  moetCenten(excl);
  if (!Number.isInteger(pct) || pct < 0) throw new Error('ongeldig tarief');
  return pct === 0 ? 0 : rondAf(excl * pct, 100);
}

export type BtwKant = 'uitgave' | 'inkomst';

export interface BtwInvoer {
  kant: BtwKant;
  /** Het ingevoerde bedrag (positief). */
  bedrag: Centen;
  /** true = het ingevoerde bedrag is exclusief btw (alleen relevant bij 21/9). */
  isExcl: boolean;
  code: BtwCode;
  /** Handmatig overschreven btw (bv. bon met afwijkende afronding); null = automatisch. */
  handmatig?: Centen | null;
}

export interface BtwUitkomst {
  code: BtwCode;
  /** Wat er op de rekening af- of bijgaat (positief). */
  bank: Centen;
  /** De grondslag (omzet of kosten exclusief btw). */
  excl: Centen;
  /** Btw die in het bankbedrag zit (21/9) of de verlegde btw (2a/4a/4b). */
  btw: Centen;
  /** Af te dragen btw (rubriek 1a/1b, of de verlegde btw in 2a/4a/4b). */
  verschuldigd: Centen;
  /** Voorbelasting (rubriek 5b). */
  voorbelasting: Centen;
  /** Rubriek van de grondslag in de aangifte (null = telt niet mee, bv. vrijgesteld). */
  rubriek: Rubriek | null;
  /** Wat de berekening zonder handmatige invoer zou zijn. */
  berekend: Centen;
  /** Handmatige btw wijkt meer dan de tolerantie af van de berekende. */
  afwijking: boolean;
}

function rubriekVan(kant: BtwKant, code: BtwCode): Rubriek | null {
  if (kant === 'inkomst') {
    switch (code) {
      case '21':
        return '1a';
      case '9':
        return '1b';
      case '0':
      case 'verlegd_nl':
        return '1e';
      // Dienst aan een ondernemer buiten de EU: niet in de aangifte (wel omzet).
      case 'buiten_eu':
        return null;
      case 'eu_dienst':
        return '3b';
      default:
        return null;
    }
  }
  switch (code) {
    case '21':
    case '9':
      return '5b';
    case 'verlegd_nl':
      return '2a';
    case 'eu_dienst':
      return '4b';
    case 'buiten_eu':
      return '4a';
    default:
      return null;
  }
}

/** De rubriek waarin de grondslag van een regel valt (voor labels en de aangifte). */
export function rubriekVoor(kant: BtwKant, code: BtwCode): Rubriek | null {
  return rubriekVan(kant, code);
}

/**
 * Rekent één regel uit. Gooit bij ongeldige invoer (de invoer is dan al gecontroleerd).
 *   uitgave € 121,00 incl. 21%  → excl 100,00, btw 21,00, voorbelasting 21,00
 *   inkomst € 100,00 excl. 21%  → bank 121,00, btw 21,00, verschuldigd 21,00
 *   uitgave € 59,99 EU-dienst   → bank 59,99, btw 12,60 (21%), verschuldigd én voorbelasting 12,60
 */
export function berekenBtw(inv: BtwInvoer): BtwUitkomst {
  const { kant, code } = inv;
  const bedrag = moetCenten(inv.bedrag);
  if (bedrag < 0 || bedrag > MAX_CENTEN) throw new Error('bedrag buiten bereik');
  const handmatig = inv.handmatig ?? null;
  if (handmatig !== null && (!Number.isSafeInteger(handmatig) || handmatig < 0)) throw new Error('ongeldige handmatige btw');
  const rubriek = rubriekVan(kant, code);

  if (code === '21' || code === '9') {
    const pct = tariefVan(code);
    const berekend = inv.isExcl ? btwUitExcl(bedrag, pct) : btwUitIncl(bedrag, pct);
    const btw = handmatig ?? berekend;
    if (!inv.isExcl && btw > bedrag) throw new Error('btw hoger dan het bedrag');
    const excl = inv.isExcl ? bedrag : bedrag - btw;
    const bank = inv.isExcl ? bedrag + btw : bedrag;
    return {
      code,
      bank,
      excl,
      btw,
      verschuldigd: kant === 'inkomst' ? btw : 0,
      voorbelasting: kant === 'uitgave' ? btw : 0,
      rubriek,
      berekend,
      afwijking: handmatig !== null && Math.abs(handmatig - berekend) > HANDMATIG_TOLERANTIE
    };
  }

  if (isVerlegd(code) && kant === 'uitgave') {
    const berekend = btwUitExcl(bedrag, VERLEGD_TARIEF);
    const btw = handmatig ?? berekend;
    return {
      code,
      bank: bedrag,
      excl: bedrag,
      btw,
      verschuldigd: btw,
      voorbelasting: btw,
      rubriek,
      berekend,
      afwijking: handmatig !== null && Math.abs(handmatig - berekend) > HANDMATIG_TOLERANTIE
    };
  }

  // 0%, vrijgesteld, of een verlegde verkoop: geen btw.
  return { code, bank: bedrag, excl: bedrag, btw: 0, verschuldigd: 0, voorbelasting: 0, rubriek, berekend: 0, afwijking: false };
}
