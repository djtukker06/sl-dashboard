// Dubbel boekhouden onder de motorkap: elke bron wordt een journaalpost met debet- en
// creditregels die altijd sluit (som debet = som credit). Afgeleid bij het lezen, niet
// gekopieerd: zo kloppen bewerken en verwijderen vanzelf. Pure module.
//
// Stap 1: boekingsregels (bk_boekingen), beginsaldi van de rekeningen en memoriaalposten.
// Facturen, bonnetjes, afschrijvingen en de btw-afsluiting komen er in latere stappen bij.

import { moetCenten, type Centen } from './geld';
import { GB } from './constanten';
import { isVerlegd, type Rubriek } from './btw';
import type { Datum } from './periode';
import { berekenBoeking, type Boeking, type Stamdata } from '../model';

export interface JournaalRegel {
  grootboek: string;
  debet: Centen;
  credit: Centen;
  vennootId?: string | null;
}

/** Btw-gegevens van een post (met teken: een terugbetaling telt negatief). */
export interface JournaalBtw {
  rubriek: Rubriek | null;
  grondslag: Centen;
  verschuldigd: Centen;
  voorbelasting: Centen;
}

export type JournaalBron = 'boeking' | 'beginsaldo' | 'memoriaal';

export interface JournaalPost {
  id: string;
  bron: JournaalBron;
  bronId: string;
  datum: Datum;
  omschrijving: string;
  regels: JournaalRegel[];
  btw?: JournaalBtw;
}

export class JournaalFout extends Error {}

/** Gooit als een post niet sluit of ongeldige regels heeft (programmeerfout). */
export function assertSluit(post: JournaalPost): JournaalPost {
  let d = 0;
  let c = 0;
  for (const r of post.regels) {
    moetCenten(r.debet, 'debet');
    moetCenten(r.credit, 'credit');
    if (r.debet < 0 || r.credit < 0) throw new JournaalFout(`${post.id}: negatief bedrag op ${r.grootboek}`);
    if (!/^\d{4}$/.test(r.grootboek)) throw new JournaalFout(`${post.id}: ongeldige rekening ${r.grootboek}`);
    d += r.debet;
    c += r.credit;
  }
  if (d !== c) throw new JournaalFout(`${post.id} sluit niet: debet ${d} ≠ credit ${c}`);
  return post;
}

/** Een regel met een bedrag dat ook negatief mag zijn: negatief wordt de andere kant. */
function regel(grootboek: string, bedrag: Centen, kant: 'debet' | 'credit', vennootId?: string | null): JournaalRegel {
  const debet = kant === 'debet' ? bedrag : -bedrag;
  return debet >= 0 ? { grootboek, debet, credit: 0, vennootId } : { grootboek, debet: 0, credit: -debet, vennootId };
}

/** Teken toepassen zonder −0. */
const keer = (t: 1 | -1, c: Centen): Centen => (c === 0 ? 0 : t * c);

function zonderNul(regels: JournaalRegel[]): JournaalRegel[] {
  return regels.filter((r) => r.debet !== 0 || r.credit !== 0);
}

export interface JournaalContext {
  /** Grootboekrekening van een bankrekening (id → code). */
  bankGrootboek: (rekeningId: string | null) => string;
  /** Privérekening van een vennoot (id → code). */
  privéGrootboek: (vennootId: string | null) => string;
}

export function contextUit(stam: Stamdata): JournaalContext {
  const banken = new Map(stam.rekeningen.map((r) => [r.id, r.grootboek]));
  const vennoten = new Map(stam.vennoten.map((v) => [v.id, v.grootboekPrive]));
  return {
    bankGrootboek: (id) => (id ? banken.get(id) ?? GB.vraagposten : GB.kas),
    privéGrootboek: (id) => (id ? vennoten.get(id) ?? GB.vraagposten : GB.vraagposten)
  };
}

/**
 * Eén boekingsregel als journaalpost.
 *   uitgave (af):  D kosten (excl) + D 1520 voorbelasting / C bank;
 *                  verlegd: daarnaast D 1520 / C 1510 (per saldo 0, wel in de aangifte)
 *   inkomst (bij): D bank / C opbrengst (excl) + C 1500 (21%) of 1505 (9%)
 *   privé:         D/C privé vennoot tegen bank
 *   overboeking:   D/C 2000 kruisposten tegen bank (twee kanten heffen elkaar op)
 *   btw:           D/C 1530 af te dragen btw tegen bank
 * Een terugbetaling (andere richting) keert alle bedragen om.
 */
export function boekingNaarPost(b: Boeking, ctx: JournaalContext): JournaalPost {
  const r = berekenBoeking(b);
  const bank = ctx.bankGrootboek(b.rekeningId);
  const t = r.teken;
  const x = r.btw;
  let regels: JournaalRegel[];
  let btw: JournaalBtw | undefined;

  switch (b.soort) {
    case 'uitgave': {
      const kosten = b.grootboek ?? GB.vraagposten;
      regels = [regel(kosten, t * x.excl, 'debet'), regel(bank, t * x.bank, 'credit')];
      if (isVerlegd(x.code)) {
        // verlegd (2a/4a/4b): verschuldigd én aftrekbaar, niet in het bankbedrag
        regels.push(regel(GB.voorbelasting, t * x.voorbelasting, 'debet'), regel(GB.btwVerlegd, t * x.verschuldigd, 'credit'));
      } else if (x.voorbelasting) {
        // gewone voorbelasting (21/9): zit in het bankbedrag
        regels.push(regel(GB.voorbelasting, t * x.voorbelasting, 'debet'));
      }
      btw = { rubriek: x.rubriek, grondslag: keer(t, x.excl), verschuldigd: keer(t, x.verschuldigd), voorbelasting: keer(t, x.voorbelasting) };
      break;
    }
    case 'inkomst': {
      const opbrengst = b.grootboek ?? GB.vraagposten;
      regels = [regel(bank, t * x.bank, 'debet'), regel(opbrengst, t * x.excl, 'credit')];
      if (x.verschuldigd) regels.push(regel(b.btwCode === '9' ? GB.btwLaag : GB.btwHoog, t * x.verschuldigd, 'credit'));
      btw = { rubriek: x.rubriek, grondslag: keer(t, x.excl), verschuldigd: keer(t, x.verschuldigd), voorbelasting: 0 };
      break;
    }
    case 'prive':
    case 'overboeking':
    case 'btw': {
      const tegen = b.soort === 'prive' ? ctx.privéGrootboek(b.vennootId) : b.soort === 'overboeking' ? GB.kruisposten : GB.btwAangifte;
      // bankMutatie: + bij (bank debet), − af (bank credit)
      regels = [regel(bank, r.bankMutatie, 'debet'), regel(tegen, r.bankMutatie, 'credit', b.soort === 'prive' ? b.vennootId : undefined)];
      break;
    }
  }

  return assertSluit({
    id: `boeking:${b.id}`,
    bron: 'boeking',
    bronId: b.id,
    datum: b.datum,
    omschrijving: b.omschrijving,
    regels: zonderNul(regels),
    btw
  });
}

/** Beginsaldo van een rekening: D bank / C 0900 op de begindatum. */
export function beginsaldoPosten(stam: Stamdata): JournaalPost[] {
  const uit: JournaalPost[] = [];
  for (const r of stam.rekeningen) {
    if (!r.beginsaldo || !r.begindatum) continue;
    uit.push(
      assertSluit({
        id: `beginsaldo:${r.id}`,
        bron: 'beginsaldo',
        bronId: r.id,
        datum: r.begindatum,
        omschrijving: `Beginsaldo ${r.naam}`,
        regels: [regel(r.grootboek, r.beginsaldo, 'debet'), regel(GB.beginbalans, r.beginsaldo, 'credit')]
      })
    );
  }
  return uit;
}

export interface Memoriaal {
  id: string;
  datum: Datum;
  omschrijving: string;
  soort: 'beginbalans' | 'correctie' | 'jaarafsluiting';
  regels: { grootboek: string; debet: Centen; credit: Centen; vennootId?: string | null }[];
}

export function memoriaalNaarPost(m: Memoriaal): JournaalPost {
  return assertSluit({
    id: `memoriaal:${m.id}`,
    bron: 'memoriaal',
    bronId: m.id,
    datum: m.datum,
    omschrijving: m.omschrijving,
    regels: zonderNul(m.regels.map((r) => ({ grootboek: r.grootboek, debet: r.debet, credit: r.credit, vennootId: r.vennootId ?? null })))
  });
}

/** Het journaal van alle bronnen (stap 1: boekingen, beginsaldi, memoriaal), op datum. */
export function journaal(stam: Stamdata, boekingen: Boeking[], memoriaal: Memoriaal[] = []): JournaalPost[] {
  const ctx = contextUit(stam);
  const posten = [...beginsaldoPosten(stam), ...boekingen.map((b) => boekingNaarPost(b, ctx)), ...memoriaal.map(memoriaalNaarPost)];
  return posten.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.id < b.id ? -1 : 1));
}

/** Saldo per grootboekrekening (debet − credit), eventueel tot en met een datum. */
export function proefbalans(posten: JournaalPost[], tot?: Datum): Map<string, Centen> {
  const uit = new Map<string, Centen>();
  for (const p of posten) {
    if (tot && p.datum > tot) continue;
    for (const r of p.regels) uit.set(r.grootboek, (uit.get(r.grootboek) ?? 0) + r.debet - r.credit);
  }
  return uit;
}
