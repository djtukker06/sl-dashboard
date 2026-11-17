// Betaalstatus van facturen op het facturenoverzicht en de betaalcheck (pop-up "Is factuur …
// betaald?", migratie 0037). Pure module: geen database, geen server.
//
//   - Betaald/deels/open komt uit de koppelingen (bk_koppelingen), net als bij Openstaand;
//     de betaaldatum is de datum van de laatste gekoppelde bankregel.
//   - Omzet op het overzicht telt alleen helemaal betaalde facturen (revenue_subtotal); een
//     deels betaalde factuur telt pas mee als hij helemaal betaald is.
//   - Betaalcheck: een week na versturen (verzonden_op, anders de factuurdatum) vragen we of
//     de factuur betaald is. "Nee" zet invoices.betaalcheck_na op vandaag + 7.

import type { Centen } from './geld';
import { plusDagen, type Datum } from './periode';
import type { OpenPost } from './afletteren';

/** Na hoeveel dagen na versturen we (opnieuw) vragen of een factuur betaald is. */
export const BETAALCHECK_DAGEN = 7;
/** Oudere facturen (verstuurd vóór vandaag − 1 jaar) vragen we niet meer na. */
export const BETAALCHECK_MAX_DAGEN = 365;

export type BetaalStand = 'betaald' | 'deels' | 'open';

export interface BetaalInfo {
  stand: BetaalStand;
  totaal: Centen;
  betaald: Centen;
  /** Nog open (in de richting van de factuur; negatief bij een creditfactuur). */
  open: Centen;
  /** Datum van de laatste gekoppelde bankregel, of null zonder betaling. */
  betaaldOp: Datum | null;
}

/**
 * Betaalstatus per factuur uit de open posten (factuurPosten) en de datum per bankregel.
 * Te veel betaald telt als betaald; een factuur van € 0 is "betaald" zonder datum.
 */
export function betaalInfoVan(post: Pick<OpenPost<unknown>, 'status' | 'totaal' | 'betaald' | 'open' | 'koppelingen'>, boekingDatum: ReadonlyMap<string, Datum>): BetaalInfo {
  let betaaldOp: Datum | null = null;
  for (const k of post.koppelingen) {
    const d = boekingDatum.get(k.boekingId);
    if (d && (!betaaldOp || d > betaaldOp)) betaaldOp = d;
  }
  const stand: BetaalStand = post.status === 'betaald' || post.status === 'te_veel' ? 'betaald' : post.status === 'deels' ? 'deels' : 'open';
  return { stand, totaal: post.totaal, betaald: post.betaald, open: stand === 'betaald' ? 0 : post.open, betaaldOp };
}

export interface OmzetFactuur {
  id: string;
  /** revenue_subtotal in centen (omzet excl. btw). */
  omzet: Centen;
  /** total in centen (incl. btw). */
  totaal: Centen;
}

/**
 * Omzet (betaald) en nog te ontvangen voor een lijst facturen.
 *   betaaldeOmzet: som van revenue_subtotal van helemaal betaalde facturen (excl. btw);
 *   teOntvangen:   som van het openstaande bedrag van de rest (incl. btw, zoals de klant betaalt);
 *   gefactureerd:  alle omzet, betaald of niet (excl. btw).
 * Een factuur zonder betaalinfo telt als open met het hele totaal.
 */
export function omzetOverzicht(facturen: readonly OmzetFactuur[], info: ReadonlyMap<string, BetaalInfo>) {
  let betaaldeOmzet = 0;
  let teOntvangen = 0;
  let gefactureerd = 0;
  let open = 0;
  for (const f of facturen) {
    gefactureerd += f.omzet;
    const i = info.get(f.id);
    if (i?.stand === 'betaald') betaaldeOmzet += f.omzet;
    else {
      teOntvangen += i ? i.open : f.totaal;
      open++;
    }
  }
  return { betaaldeOmzet, teOntvangen, gefactureerd, aantalOpen: open };
}

export interface CheckFactuur {
  id: string;
  /** Factuurdatum (NL-dag van issued_at). */
  datum: Datum;
  /** NL-dag van invoices.verzonden_op, of null. */
  verzonden: Datum | null;
  /** invoices.betaalcheck_na (na "Nee"), of null. */
  checkNa: Datum | null;
  totaal: Centen;
}

/** Wanneer verstuurd: verzonden_op als die er is, anders de factuurdatum. */
export const verstuurdOp = (f: Pick<CheckFactuur, 'datum' | 'verzonden'>): Datum => f.verzonden ?? f.datum;

/** Vanaf welke dag we vragen of de factuur betaald is. */
export function checkVanaf(f: Pick<CheckFactuur, 'datum' | 'verzonden' | 'checkNa'>): Datum {
  return f.checkNa ?? plusDagen(verstuurdOp(f), BETAALCHECK_DAGEN);
}

/** De nieuwe betaalcheck_na na "Nee": over een week opnieuw vragen. */
export const volgendeCheck = (vandaag: Datum): Datum => plusDagen(vandaag, BETAALCHECK_DAGEN);

/**
 * Of we vandaag naar deze factuur vragen: niet (helemaal) betaald, totaal boven € 0, niet ouder
 * dan een jaar (vanaf versturen) en de check-datum is bereikt.
 */
export function moetChecken(f: CheckFactuur, info: BetaalInfo | undefined, vandaag: Datum): boolean {
  if (!info || info.stand === 'betaald' || f.totaal <= 0 || info.open <= 0) return false;
  if (verstuurdOp(f) < plusDagen(vandaag, -BETAALCHECK_MAX_DAGEN)) return false;
  return checkVanaf(f) <= vandaag;
}

/** De facturen voor de pop-up, oudste (verstuurd) eerst. */
export function teChecken<T extends CheckFactuur>(facturen: readonly T[], info: ReadonlyMap<string, BetaalInfo>, vandaag: Datum): T[] {
  return facturen
    .filter((f) => moetChecken(f, info.get(f.id), vandaag))
    .sort((a, b) => (verstuurdOp(a) < verstuurdOp(b) ? -1 : verstuurdOp(a) > verstuurdOp(b) ? 1 : a.id < b.id ? -1 : 1));
}
