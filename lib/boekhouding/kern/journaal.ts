// Dubbel boekhouden onder de motorkap: elke bron wordt een journaalpost met debet- en
// creditregels die altijd sluit (som debet = som credit). Afgeleid bij het lezen, niet
// gekopieerd: zo kloppen bewerken en verwijderen vanzelf. Pure module.
//
// Bronnen: boekingsregels (bk_boekingen), beginsaldi van de rekeningen, memoriaalposten,
// facturen (invoices, alleen lezen) en bonnetjes (expenses, alleen lezen). Afschrijvingen en
// de btw-afsluiting komen er in stap 3 bij.
//
// Dubbeltelling voorkomen: een bankregel die gekoppeld is aan een factuur of bonnetje is
// alleen een BETALING (bank tegen debiteuren/crediteuren, zonder btw). Omzet, kosten en btw
// komen dan uit de factuur of het bonnetje zelf.

import { moetCenten, type Centen } from './geld';
import { GB } from './constanten';
import { btwUitExcl, isVerlegd, rubriekVoor, VERLEGD_TARIEF, type Rubriek } from './btw';
import type { Datum } from './periode';
import {
  factuurBtwCode,
  uitgaveBtw,
  uitgaveBtwCode,
  uitgaveGrootboek,
  uitgaveTeltNiet,
  type BronExtra,
  type FactuurBron,
  type Koppeling,
  type UitgaveBron
} from './bronnen';
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

export type JournaalBron = 'boeking' | 'beginsaldo' | 'memoriaal' | 'factuur' | 'uitgave';

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
  /** De vennoot die bij een gebruiker hoort (voor privé voorgeschoten bonnetjes). */
  vennootVanGebruiker: (userId: string | null) => string | null;
}

export function contextUit(stam: Stamdata): JournaalContext {
  const banken = new Map(stam.rekeningen.map((r) => [r.id, r.grootboek]));
  const vennoten = new Map(stam.vennoten.map((v) => [v.id, v.grootboekPrive]));
  const perGebruiker = new Map(stam.vennoten.filter((v) => v.userId).map((v) => [v.userId as string, v.id]));
  return {
    bankGrootboek: (id) => (id ? banken.get(id) ?? GB.vraagposten : GB.kas),
    privéGrootboek: (id) => (id ? vennoten.get(id) ?? GB.vraagposten : GB.vraagposten),
    vennootVanGebruiker: (u) => (u ? perGebruiker.get(u) ?? null : null)
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
export function boekingNaarPost(b: Boeking, ctx: JournaalContext, koppelingen: readonly Koppeling[] = []): JournaalPost {
  const r = berekenBoeking(b);
  const bank = ctx.bankGrootboek(b.rekeningId);
  const t = r.teken;
  const x = r.btw;
  let regels: JournaalRegel[];
  let btw: JournaalBtw | undefined;

  // Gekoppeld aan een factuur of bonnetje: alleen een betaling (geen omzet/kosten, geen btw).
  const gekoppeld = (b.soort === 'inkomst' || b.soort === 'uitgave') && koppelingen.length > 0;
  if (gekoppeld) {
    const tegen = koppelingen[0].bron === 'factuur' ? GB.debiteuren : GB.crediteuren;
    return assertSluit({
      id: `boeking:${b.id}`,
      bron: 'boeking',
      bronId: b.id,
      datum: b.datum,
      omschrijving: b.omschrijving,
      regels: zonderNul([regel(bank, r.bankMutatie, 'debet'), regel(tegen, r.bankMutatie, 'credit')])
    });
  }

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

// ---------------------------------------------------------------------------------
// Facturen en bonnetjes (afgeleid, alleen lezen)
// ---------------------------------------------------------------------------------
/**
 * Een factuur als journaalpost (factuurstelsel: op de factuurdatum):
 *   D 1300 debiteuren (totaal)
 *   C 8000 omzet (revenue_subtotal) — bij verlegd/0%: 8010 —, C 8090 doorberekende kosten
 *     (subtotaal − revenue_subtotal), C 1500/1505 btw zoals gefactureerd (vat_amount).
 * Een creditfactuur (negatieve bedragen) keert vanzelf om. Aanbetaling en restfactuur zijn
 * elk een eigen factuur met eigen bedragen, dus niets telt dubbel.
 */
export function factuurNaarPost(f: FactuurBron, extra?: BronExtra | null): JournaalPost {
  const code = factuurBtwCode(f, extra);
  const zonderNlBtw = code !== '21' && code !== '9';
  const omzetRekening = extra?.grootboek ?? (zonderNlBtw ? '8010' : GB.omzet);
  const btw = zonderNlBtw ? 0 : f.btw;
  const doorberekend = f.subtotaal - f.omzet;
  // Sluitpost: het totaal is altijd subtotaal + btw; een eventueel verschil (afronding in een
  // oude factuur) valt in de omzet, zodat de post sluit en debiteuren klopt met de factuur.
  const omzet = f.totaal - btw - doorberekend;
  return assertSluit({
    id: `factuur:${f.id}`,
    bron: 'factuur',
    bronId: f.id,
    datum: f.datum,
    omschrijving: `Factuur ${f.nummer} · ${f.klant}`,
    regels: zonderNul([
      regel(GB.debiteuren, f.totaal, 'debet'),
      regel(omzetRekening, omzet, 'credit'),
      regel('8090', doorberekend, 'credit'),
      regel(code === '9' ? GB.btwLaag : GB.btwHoog, btw, 'credit')
    ]),
    btw: { rubriek: rubriekVoor('inkomst', code), grondslag: f.totaal - btw, verschuldigd: btw, voorbelasting: 0 }
  });
}

/**
 * Een verwerkt bonnetje (in EUR) als journaalpost op de bondatum:
 *   D kosten (excl.) + D 1520 voorbelasting / C tegenrekening (totaal);
 *   verlegd (4b/2a/4a): D kosten (totaal) / C tegenrekening, plus D 1520 / C 1510 21% (per saldo 0).
 * Tegenrekening: zakelijk/creditcard → 1600 crediteuren (de bankregel betaalt die af),
 * privé voorgeschoten → privé van de vennoot, contant → 1000 kas.
 * null als het bonnetje (nog) niet meetelt (concept, andere valuta).
 */
export function uitgaveNaarPost(u: UitgaveBron, ctx: JournaalContext, extra?: BronExtra | null): JournaalPost | null {
  if (uitgaveTeltNiet(u) || !u.datum || u.totaal === null) return null;
  const code = uitgaveBtwCode(u, extra);
  const kosten = uitgaveGrootboek(u, extra);
  let tegen: string = GB.crediteuren;
  let vennootId: string | null = null;
  if (u.betaalwijze === 'prive') {
    vennootId = extra?.vennootId ?? ctx.vennootVanGebruiker(u.aangemaaktDoor);
    tegen = ctx.privéGrootboek(vennootId);
  } else if (u.betaalwijze === 'contant') tegen = GB.kas;

  let regels: JournaalRegel[];
  let btw: JournaalBtw;
  if (isVerlegd(code)) {
    const v = btwUitExcl(u.totaal, VERLEGD_TARIEF);
    regels = [
      regel(kosten, u.totaal, 'debet'),
      regel(tegen, u.totaal, 'credit', vennootId),
      regel(GB.voorbelasting, v, 'debet'),
      regel(GB.btwVerlegd, v, 'credit')
    ];
    btw = { rubriek: rubriekVoor('uitgave', code), grondslag: u.totaal, verschuldigd: v, voorbelasting: v };
  } else {
    const b = uitgaveBtw(u, code);
    regels = [regel(kosten, u.totaal - b, 'debet'), regel(GB.voorbelasting, b, 'debet'), regel(tegen, u.totaal, 'credit', vennootId)];
    btw = { rubriek: rubriekVoor('uitgave', code), grondslag: u.totaal - b, verschuldigd: 0, voorbelasting: b };
  }
  return assertSluit({
    id: `uitgave:${u.id}`,
    bron: 'uitgave',
    bronId: u.id,
    datum: u.datum,
    omschrijving: `Bonnetje ${u.leverancier || u.omschrijving || ''}`.trim(),
    regels: zonderNul(regels),
    btw
  });
}

export interface JournaalInvoer {
  boekingen: Boeking[];
  memoriaal?: Memoriaal[];
  facturen?: FactuurBron[];
  uitgaven?: UitgaveBron[];
  koppelingen?: Koppeling[];
  bronExtra?: BronExtra[];
}

/** Koppelingen per boeking (alleen van boekingen die bestaan). */
export function koppelingenPerBoeking(koppelingen: readonly Koppeling[]): Map<string, Koppeling[]> {
  const uit = new Map<string, Koppeling[]>();
  for (const k of koppelingen) {
    const l = uit.get(k.boekingId);
    if (l) l.push(k);
    else uit.set(k.boekingId, [k]);
  }
  return uit;
}

export function extraSleutel(bron: string, id: string): string {
  return `${bron}:${id}`;
}

/** Het journaal van alle bronnen, op datum. */
export function journaal(stam: Stamdata, invoer: JournaalInvoer): JournaalPost[] {
  const ctx = contextUit(stam);
  const perBoeking = koppelingenPerBoeking(invoer.koppelingen ?? []);
  const extra = new Map((invoer.bronExtra ?? []).map((e) => [extraSleutel(e.bron, e.bronId), e]));
  const posten: JournaalPost[] = [
    ...beginsaldoPosten(stam),
    ...invoer.boekingen.map((b) => boekingNaarPost(b, ctx, perBoeking.get(b.id))),
    ...(invoer.memoriaal ?? []).map(memoriaalNaarPost),
    ...(invoer.facturen ?? []).map((f) => factuurNaarPost(f, extra.get(extraSleutel('factuur', f.id)))),
    ...(invoer.uitgaven ?? []).flatMap((u) => uitgaveNaarPost(u, ctx, extra.get(extraSleutel('uitgave', u.id))) ?? [])
  ];
  return posten.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.id < b.id ? -1 : 1));
}

/** Btw per kwartaal uit het journaal ("JJJJ-Q" → verschuldigd en voorbelasting). */
export function btwPerKwartaal(posten: JournaalPost[]): Map<string, { verschuldigd: Centen; voorbelasting: Centen }> {
  const uit = new Map<string, { verschuldigd: Centen; voorbelasting: Centen }>();
  for (const p of posten) {
    if (!p.btw) continue;
    const k = `${p.datum.slice(0, 4)}-${Math.floor((Number(p.datum.slice(5, 7)) - 1) / 3) + 1}`;
    const t = uit.get(k) ?? { verschuldigd: 0, voorbelasting: 0 };
    t.verschuldigd += p.btw.verschuldigd;
    t.voorbelasting += p.btw.voorbelasting;
    uit.set(k, t);
  }
  return uit;
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
