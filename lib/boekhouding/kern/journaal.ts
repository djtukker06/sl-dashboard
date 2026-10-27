// Dubbel boekhouden onder de motorkap: elke bron wordt een journaalpost met debet- en
// creditregels die altijd sluit (som debet = som credit). Afgeleid bij het lezen, niet
// gekopieerd: zo kloppen bewerken en verwijderen vanzelf. Pure module.
//
// Bronnen: boekingsregels (bk_boekingen), beginsaldi van de rekeningen, memoriaalposten,
// facturen (invoices, alleen lezen), bonnetjes (expenses, alleen lezen), activa (aanschaf bij
// inbreng, afschrijving per maand, desinvestering) en per ingediende btw-aangifte de
// afsluitpost (btw-rekeningen van dat kwartaal naar 1530 "af te dragen btw (aangifte)").
//
// Dubbeltelling voorkomen: een bankregel die gekoppeld is aan een factuur of bonnetje is
// alleen een BETALING (bank tegen debiteuren/crediteuren, zonder btw). Omzet, kosten en btw
// komen dan uit de factuur of het bonnetje zelf.

import { moetCenten, type Centen } from './geld';
import { ACTIVA_KIESBAAR, GB } from './constanten';
import { ACTIVA_CATEGORIEEN, boekwaardeBijDesinvestering, schema, type Activum } from './afschrijving';
import { afrondingsverschil, type AangifteSnapshot } from './aangifte';
import { btwUitExcl, isVerlegd, rubriekVoor, VERLEGD_TARIEF, type Rubriek } from './btw';
import { kwartaalGrenzen, type Datum, type Kwartaal } from './periode';
import {
  factuurBtwCode,
  uitgaveBtw,
  uitgaveBtwCode,
  uitgaveGrootboek,
  uitgaveTeltNiet,
  uitgaveViaBank,
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

export type JournaalBron = 'boeking' | 'beginsaldo' | 'memoriaal' | 'factuur' | 'uitgave' | 'activum' | 'afschrijving' | 'btw_afsluiting';

export interface JournaalPost {
  id: string;
  bron: JournaalBron;
  bronId: string;
  datum: Datum;
  omschrijving: string;
  regels: JournaalRegel[];
  btw?: JournaalBtw;
  /** Alleen bij memoriaal: beginbalans, correctie of jaarafsluiting. */
  memoriaalSoort?: Memoriaal['soort'];
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

/** Het deel van een aankoop dat als activum is geactiveerd (zie bk_activa.uitgave_id/boeking_id). */
export interface Activering {
  categorie: string;
  aanschaf: Centen;
}

/**
 * De kostenkant van een aankoop. Is (een deel van) de aankoop geactiveerd, dan gaat de
 * aanschafprijs naar de activarekening (0200/0210) en alleen een eventueel restant naar de
 * kosten (bij een activarekening als categorie: kleine hardware). Zo wordt een investering
 * nooit én als kosten én via de afschrijving geboekt.
 */
function kostenRegels(kosten: string, bedrag: Centen, activering?: Activering | null): JournaalRegel[] {
  if (!activering || bedrag <= 0) return [regel(kosten, bedrag, 'debet')];
  const rest = bedrag - activering.aanschaf;
  return [regel(activering.categorie, activering.aanschaf, 'debet'), regel(ACTIVA_KIESBAAR.has(kosten) ? '4010' : kosten, rest, 'debet')];
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
export function boekingNaarPost(b: Boeking, ctx: JournaalContext, koppelingen: readonly Koppeling[] = [], activering?: Activering | null): JournaalPost {
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
      regels = [...(t === 1 ? kostenRegels(kosten, x.excl, activering) : [regel(kosten, t * x.excl, 'debet')]), regel(bank, t * x.bank, 'credit')];
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
  regels: MemoriaalRegel[];
  aangemaakt?: string;
}

export interface MemoriaalRegel {
  grootboek: string;
  debet: Centen;
  credit: Centen;
  vennootId?: string | null;
  omschrijving?: string | null;
}

export function memoriaalNaarPost(m: Memoriaal): JournaalPost {
  return assertSluit({
    id: `memoriaal:${m.id}`,
    bron: 'memoriaal',
    bronId: m.id,
    datum: m.datum,
    omschrijving: m.omschrijving,
    regels: zonderNul(m.regels.map((r) => ({ grootboek: r.grootboek, debet: r.debet, credit: r.credit, vennootId: r.vennootId ?? null }))),
    memoriaalSoort: m.soort
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
export function uitgaveNaarPost(u: UitgaveBron, ctx: JournaalContext, extra?: BronExtra | null, activering?: Activering | null): JournaalPost | null {
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
      ...kostenRegels(kosten, u.totaal, activering),
      regel(tegen, u.totaal, 'credit', vennootId),
      regel(GB.voorbelasting, v, 'debet'),
      regel(GB.btwVerlegd, v, 'credit')
    ];
    btw = { rubriek: rubriekVoor('uitgave', code), grondslag: u.totaal, verschuldigd: v, voorbelasting: v };
  } else {
    const b = uitgaveBtw(u, code);
    regels = [...kostenRegels(kosten, u.totaal - b, activering), regel(GB.voorbelasting, b, 'debet'), regel(tegen, u.totaal, 'credit', vennootId)];
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

// ---------------------------------------------------------------------------------
// Activa en afschrijvingen (afgeleid uit bk_activa)
// ---------------------------------------------------------------------------------
/**
 * De posten van een activum:
 *   - ingebracht/bestaand (geen bonnetje of bankregel als bron): D 0200/0210 / C 0900 op de
 *     aanschafdatum (komt dan uit de beginbalans);
 *   - per maand: D 4800 afschrijvingen / C cum. afschrijving (0209/0219), op de laatste dag;
 *   - desinvestering: de aanschaf en de cumulatieve afschrijving gaan af; de resterende
 *     boekwaarde gaat ten laste van 8900 (overige opbrengsten). De verkoopopbrengst boek je als
 *     inkomst (categorie Overige opbrengsten, 21% btw); per saldo staat dan het boekresultaat
 *     (opbrengst − boekwaarde) op 8900.
 */
export function activumPosten(a: Activum): JournaalPost[] {
  const cum = ACTIVA_CATEGORIEEN[a.categorie].cum;
  const uit: JournaalPost[] = [];
  if (!a.uitgaveId && !a.boekingId) {
    uit.push(
      assertSluit({
        id: `activum:${a.id}`,
        bron: 'activum',
        bronId: a.id,
        datum: a.aanschafdatum,
        omschrijving: `Activum ingebracht: ${a.omschrijving}`,
        regels: [regel(a.categorie, a.aanschaf, 'debet'), regel(GB.beginbalans, a.aanschaf, 'credit')]
      })
    );
  }
  const s = schema(a);
  for (const r of s) {
    if (!r.afschrijving) continue;
    uit.push(
      assertSluit({
        id: `afschrijving:${a.id}:${r.maand}`,
        bron: 'afschrijving',
        bronId: a.id,
        datum: r.datum,
        omschrijving: `Afschrijving ${a.omschrijving}`,
        regels: [regel(GB.afschrijvingen, r.afschrijving, 'debet'), regel(cum, r.afschrijving, 'credit')]
      })
    );
  }
  if (a.desinvesteringDatum) {
    const cumulatief = s.length ? s[s.length - 1].cumulatief : 0;
    const boekwaarde = boekwaardeBijDesinvestering(a) ?? 0;
    uit.push(
      assertSluit({
        id: `desinvestering:${a.id}`,
        bron: 'activum',
        bronId: a.id,
        datum: a.desinvesteringDatum,
        omschrijving: `Desinvestering ${a.omschrijving} (boekwaarde)`,
        regels: zonderNul([regel(cum, cumulatief, 'debet'), regel('8900', boekwaarde, 'debet'), regel(a.categorie, a.aanschaf, 'credit')])
      })
    );
  }
  return uit;
}

// ---------------------------------------------------------------------------------
// Afsluiting van een ingediende btw-aangifte
// ---------------------------------------------------------------------------------
export interface AangifteInJournaal {
  id: string;
  jaar: number;
  kwartaal: Kwartaal;
  snapshot: AangifteSnapshot | null;
}

const BTW_REKENINGEN = [GB.btwHoog, GB.btwLaag, GB.btwVerlegd, GB.voorbelasting] as const;

/**
 * Bij een ingediende aangifte, op de laatste dag van het kwartaal: de btw-rekeningen van dat
 * kwartaal (1500/1505/1510 en 1520) gaan naar 1530 "af te dragen btw (aangifte)"; het
 * afrondingsverschil van het formulier (hele euro's, in je voordeel) gaat naar 8900. Daarna
 * staat op 1530 precies het aangegeven bedrag; de btw-betaling (soort btw) boekt dat weer af.
 * Wijzigt er na indiening nog iets in het kwartaal (bv. een factuur), dan blijft dat verschil
 * op 1530 staan (zie vergelijkMetIngediend).
 */
export function btwAfsluitPost(posten: readonly JournaalPost[], a: AangifteInJournaal): JournaalPost | null {
  const { van, tot } = kwartaalGrenzen(a.jaar, a.kwartaal);
  const saldo = new Map<string, Centen>();
  for (const p of posten) {
    if (p.bron === 'btw_afsluiting' || p.datum < van || p.datum > tot) continue;
    for (const r of p.regels) {
      if ((BTW_REKENINGEN as readonly string[]).includes(r.grootboek)) saldo.set(r.grootboek, (saldo.get(r.grootboek) ?? 0) + r.debet - r.credit);
    }
  }
  const regels: JournaalRegel[] = [];
  let totaal = 0;
  for (const g of BTW_REKENINGEN) {
    const s = saldo.get(g) ?? 0;
    regels.push(regel(g, s, 'credit'));
    totaal += s;
  }
  regels.push(regel(GB.btwAangifte, totaal, 'debet'));
  const afronding = a.snapshot ? afrondingsverschil(a.snapshot) : 0;
  regels.push(regel(GB.btwAangifte, afronding, 'debet'), regel('8900', afronding, 'credit'));
  const schoon = zonderNul(regels);
  if (!schoon.length) return null;
  return assertSluit({
    id: `btw:${a.jaar}-${a.kwartaal}`,
    bron: 'btw_afsluiting',
    bronId: a.id,
    datum: tot,
    omschrijving: `Btw-aangifte Q${a.kwartaal} ${a.jaar} (naar af te dragen)`,
    regels: schoon
  });
}

export interface JournaalInvoer {
  boekingen: Boeking[];
  memoriaal?: Memoriaal[];
  facturen?: FactuurBron[];
  uitgaven?: UitgaveBron[];
  koppelingen?: Koppeling[];
  bronExtra?: BronExtra[];
  activa?: Activum[];
  aangiften?: AangifteInJournaal[];
  /**
   * Begin van de administratie. Weggelaten: afgeleid uit de stamdata (administratieBegin).
   * null: geen startfilter.
   */
  start?: Datum | null;
}

/**
 * Het begin van de administratie zoals de gebruiker het heeft ingesteld: de startdatum of het
 * vroegste beginsaldo van een rekening. null als niets is ingesteld (dan telt alles mee).
 */
export function administratieBegin(stam: Stamdata): Datum | null {
  const k = [stam.instellingen.startdatum, ...stam.rekeningen.map((r) => r.begindatum)].filter((x): x is string => !!x);
  return k.length ? k.sort()[0] : null;
}

/**
 * Bankregels die meetellen: niet vóór de begindatum van hun rekening (het beginsaldo bevat
 * die mutaties al; zelfde regel als saldoPerRekening/lopendSaldo).
 */
export function boekingenVanafBegin<T extends Pick<Boeking, 'rekeningId' | 'datum'>>(boekingen: readonly T[], stam: Stamdata): T[] {
  const begin = new Map(stam.rekeningen.map((r) => [r.id, r.begindatum]));
  return boekingen.filter((b) => {
    const bd = b.rekeningId ? begin.get(b.rekeningId) : null;
    return !bd || b.datum >= bd;
  });
}

/** Documenten (facturen/bonnetjes) vanaf het begin van de administratie. */
export function vanafStart<T extends { datum: Datum | null }>(docs: readonly T[], start: Datum | null): T[] {
  return start ? docs.filter((d) => !d.datum || d.datum >= start) : [...docs];
}

/**
 * Een factuur of bonnetje van vóór de start telt niet als omzet/kosten (dat hoort bij de
 * periode vóór de administratie). Wordt het na de start betaald (koppeling met een bankregel),
 * dan komt het betaalde deel als openingspost op de startdatum:
 *   factuur  D 1300 debiteuren / C 0900 beginbalans
 *   bonnetje D 0900 beginbalans / C 1600 crediteuren
 * zonder btw. De betaling (bank tegen 1300/1600) maakt de post dan weer nul.
 */
function openingPost(soort: 'factuur' | 'uitgave', id: string, naam: string, bedrag: Centen, start: Datum): JournaalPost | null {
  if (!bedrag) return null;
  const regels =
    soort === 'factuur'
      ? [regel(GB.debiteuren, bedrag, 'debet'), regel(GB.beginbalans, bedrag, 'credit')]
      : [regel(GB.beginbalans, bedrag, 'debet'), regel(GB.crediteuren, bedrag, 'credit')];
  return assertSluit({
    id: `opening-${soort}:${id}`,
    bron: 'beginsaldo',
    bronId: id,
    datum: start,
    omschrijving: `Openstaand bij start · ${naam}`,
    regels: zonderNul(regels)
  });
}

/** Betaalde deel (koppelingen) begrensd tot het documenttotaal, met het teken van het totaal. */
function betaaldDeel(totaal: Centen, ks: readonly Koppeling[] | undefined): Centen {
  const som = (ks ?? []).reduce((t, k) => t + k.bedrag, 0);
  if (totaal >= 0) return Math.max(0, Math.min(totaal, som));
  return Math.min(0, Math.max(totaal, som));
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
  const start = invoer.start === undefined ? administratieBegin(stam) : invoer.start;
  const boekingen = boekingenVanafBegin(invoer.boekingen, stam);
  const ids = new Set(boekingen.map((b) => b.id));
  const koppelingen = (invoer.koppelingen ?? []).filter((k) => ids.has(k.boekingId));
  const perBoeking = koppelingenPerBoeking(koppelingen);
  const perDoc = new Map<string, Koppeling[]>();
  for (const k of koppelingen) {
    const key = extraSleutel(k.bron, k.bronId);
    perDoc.set(key, [...(perDoc.get(key) ?? []), k]);
  }
  const extra = new Map((invoer.bronExtra ?? []).map((e) => [extraSleutel(e.bron, e.bronId), e]));
  const { perBoeking: actBoeking, perUitgave: actUitgave } = activeringen(invoer.activa ?? []);
  const voorStart = (d: Datum | null) => !!start && !!d && d < start;
  const factuurPost = (f: FactuurBron): JournaalPost[] => {
    if (!voorStart(f.datum)) return [factuurNaarPost(f, extra.get(extraSleutel('factuur', f.id)))];
    const p = openingPost('factuur', f.id, `Factuur ${f.nummer} · ${f.klant}`, betaaldDeel(f.totaal, perDoc.get(extraSleutel('factuur', f.id))), start as Datum);
    return p ? [p] : [];
  };
  const uitgavePost = (u: UitgaveBron): JournaalPost[] => {
    if (!voorStart(u.datum)) return [uitgaveNaarPost(u, ctx, extra.get(extraSleutel('uitgave', u.id)), actUitgave.get(u.id)) ?? []].flat();
    if (uitgaveTeltNiet(u) || !uitgaveViaBank(u) || u.totaal === null) return [];
    const p = openingPost('uitgave', u.id, `Bonnetje ${u.leverancier || u.omschrijving || ''}`.trim(), betaaldDeel(u.totaal, perDoc.get(extraSleutel('uitgave', u.id))), start as Datum);
    return p ? [p] : [];
  };
  const posten: JournaalPost[] = [
    ...beginsaldoPosten(stam),
    ...boekingen.map((b) => boekingNaarPost(b, ctx, perBoeking.get(b.id), actBoeking.get(b.id))),
    ...(invoer.memoriaal ?? []).map(memoriaalNaarPost),
    ...(invoer.facturen ?? []).flatMap(factuurPost),
    ...(invoer.uitgaven ?? []).flatMap(uitgavePost),
    ...(invoer.activa ?? []).flatMap(activumPosten)
  ];
  for (const a of invoer.aangiften ?? []) {
    const p = btwAfsluitPost(posten, a);
    if (p) posten.push(p);
  }
  return posten.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.id < b.id ? -1 : 1));
}

/** Per bankregel en per bonnetje: het geactiveerde deel (som als er meerdere activa uit één aankoop komen). */
export function activeringen(activa: readonly Activum[]): { perBoeking: Map<string, Activering>; perUitgave: Map<string, Activering> } {
  const perBoeking = new Map<string, Activering>();
  const perUitgave = new Map<string, Activering>();
  for (const a of activa) {
    const m = a.boekingId ? perBoeking : a.uitgaveId ? perUitgave : null;
    const k = a.boekingId ?? a.uitgaveId;
    if (!m || !k) continue;
    const oud = m.get(k);
    // Meerdere activa uit één aankoop: alleen als ze dezelfde soort hebben samen te tellen.
    m.set(k, oud && oud.categorie === a.categorie ? { categorie: a.categorie, aanschaf: oud.aanschaf + a.aanschaf } : oud ?? { categorie: a.categorie, aanschaf: a.aanschaf });
  }
  return { perBoeking, perUitgave };
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
