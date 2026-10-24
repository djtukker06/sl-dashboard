// De jaarstukken uit het journaal: winst-en-verliesrekening, balans, proefbalans,
// grootboekkaart, kapitaal per vennoot (winstverdeling) en de jaarafsluiting met checklist.
// Pure module (geen netwerk, geen klok behalve wat wordt meegegeven, geen '@/'-imports).
//
// Alles komt uit hetzelfde journaal als de btw-aangifte (facturen, bonnetjes, bankregels,
// memoriaal, activa), dus de cijfers sluiten op elkaar aan. Bedragen in centen.
//
// Jaarafsluiting: op 31-12 gaan de resultaatrekeningen (opbrengsten en kosten) naar 0 en het
// resultaat naar de kapitaalrekeningen van de vennoten (naar hun winstaandeel); de privé-
// rekeningen gaan ook naar kapitaal. Die afsluitpost telt NIET mee in de winst-en-
// verliesrekening van dat jaar (anders zou het resultaat 0 lijken), wel in de balans.

import { som, verdeel, type Centen } from './geld';
import { GB } from './constanten';
import type { JournaalPost, MemoriaalRegel } from './journaal';
import { jaarVan, kwartaalGrenzen, kwartaalVan, maakDatum, type Datum, type Kwartaal } from './periode';
import type { Boeking, Grootboekrekening, Stamdata, Vennoot } from '../model';

// ---------------------------------------------------------------------------------
// Rekeningen
// ---------------------------------------------------------------------------------
export type RekeningSoort = Grootboekrekening['soort'];

export interface RekeningInfo {
  code: string;
  naam: string;
  soort: RekeningSoort;
  rubriek: string;
  rgs: string | null;
}

/** Opzoeken van een rekening; een onbekende code krijgt een soort op basis van het eerste cijfer. */
export function rekeningInfo(grootboek: readonly Grootboekrekening[]): (code: string) => RekeningInfo {
  const m = new Map(grootboek.map((g) => [g.code, g]));
  return (code) => {
    const g = m.get(code);
    if (g) return { code, naam: g.naam, soort: g.soort, rubriek: g.rubriek, rgs: g.rgs };
    const c = code[0];
    const soort: RekeningSoort = c === '8' || c === '9' ? 'opbrengst' : c === '4' || c === '6' || c === '7' ? 'kosten' : c === '0' ? 'eigen_vermogen' : 'activa';
    return { code, naam: `Rekening ${code}`, soort, rubriek: soort === 'opbrengst' ? 'omzet' : soort === 'kosten' ? 'kosten' : 'overig', rgs: null };
  };
}

export const isResultaatSoort = (s: RekeningSoort): boolean => s === 'opbrengst' || s === 'kosten';

/** De afsluitpost van een boekjaar (memoriaal, soort jaarafsluiting). */
export const isAfsluiting = (p: JournaalPost): boolean => p.bron === 'memoriaal' && p.memoriaalSoort === 'jaarafsluiting';

export const jaarBegin = (jaar: number): Datum => maakDatum(jaar, 1, 1);
export const jaarEinde = (jaar: number): Datum => maakDatum(jaar, 12, 31);

/** Mutaties (debet − credit) per rekening in een periode (van/tot inclusief; null = open). */
export function mutaties(posten: readonly JournaalPost[], van: Datum | null, tot: Datum | null, opties: { zonderAfsluiting?: boolean } = {}): Map<string, Centen> {
  const uit = new Map<string, Centen>();
  for (const p of posten) {
    if ((van && p.datum < van) || (tot && p.datum > tot)) continue;
    if (opties.zonderAfsluiting && isAfsluiting(p)) continue;
    for (const r of p.regels) uit.set(r.grootboek, (uit.get(r.grootboek) ?? 0) + r.debet - r.credit);
  }
  return uit;
}

const vol = (m: Map<string, Centen>, code: string) => m.get(code) ?? 0;

// ---------------------------------------------------------------------------------
// Winst-en-verliesrekening
// ---------------------------------------------------------------------------------
export type WVGroepId = 'omzet' | 'overige_opbrengsten' | 'kosten' | 'afschrijvingen';

export const WV_GROEPEN: { id: WVGroepId; titel: string; opbrengst: boolean }[] = [
  { id: 'omzet', titel: 'Omzet', opbrengst: true },
  { id: 'overige_opbrengsten', titel: 'Overige opbrengsten', opbrengst: true },
  { id: 'kosten', titel: 'Bedrijfskosten', opbrengst: false },
  { id: 'afschrijvingen', titel: 'Afschrijvingen', opbrengst: false }
];

/** Bedragen per kwartaal, het jaar en het vorige jaar. */
export interface WVBedragen {
  kwartalen: [Centen, Centen, Centen, Centen];
  jaar: Centen;
  vorigJaar: Centen;
}

export interface WVRegel extends WVBedragen {
  code: string;
  naam: string;
  rgs: string | null;
}

export interface WVGroep extends WVBedragen {
  id: WVGroepId;
  titel: string;
  opbrengst: boolean;
  regels: WVRegel[];
}

export interface WinstEnVerlies {
  jaar: number;
  groepen: WVGroep[];
  opbrengsten: WVBedragen;
  kosten: WVBedragen;
  /** Opbrengsten − kosten (positief = winst). */
  resultaat: WVBedragen;
}

function wvGroepVan(info: RekeningInfo): WVGroepId | null {
  if (info.soort === 'opbrengst') return info.rubriek === 'overige_opbrengsten' ? 'overige_opbrengsten' : 'omzet';
  if (info.soort === 'kosten') return info.rubriek === 'afschrijvingen' ? 'afschrijvingen' : 'kosten';
  return null;
}

const leeg = (): WVBedragen => ({ kwartalen: [0, 0, 0, 0], jaar: 0, vorigJaar: 0 });
function telOp(doel: WVBedragen, b: WVBedragen, teken: 1 | -1 = 1) {
  for (let i = 0; i < 4; i++) doel.kwartalen[i] += teken * b.kwartalen[i];
  doel.jaar += teken * b.jaar;
  doel.vorigJaar += teken * b.vorigJaar;
}

/**
 * De winst-en-verliesrekening van een jaar, per kwartaal en vergeleken met het vorige jaar.
 * `tot` (optioneel): niet verder dan deze datum (het lopende jaar: tot vandaag, zodat
 * afschrijvingen van de komende maanden nog niet meetellen).
 */
export function winstEnVerlies(posten: readonly JournaalPost[], grootboek: readonly Grootboekrekening[], jaar: number, tot?: Datum): WinstEnVerlies {
  const info = rekeningInfo(grootboek);
  const perKw = ([1, 2, 3, 4] as Kwartaal[]).map((q) => {
    const g = kwartaalGrenzen(jaar, q);
    return mutaties(posten, g.van, tot && tot < g.tot ? tot : g.tot, { zonderAfsluiting: true });
  });
  const vorig = mutaties(posten, jaarBegin(jaar - 1), jaarEinde(jaar - 1), { zonderAfsluiting: true });
  const codes = new Set<string>();
  for (const m of [...perKw, vorig]) for (const [c, v] of m) if (v !== 0) codes.add(c);

  const groepen: WVGroep[] = WV_GROEPEN.map((g) => ({ ...g, regels: [], ...leeg() }));
  for (const code of [...codes].sort()) {
    const i = info(code);
    const gid = wvGroepVan(i);
    if (!gid) continue;
    const groep = groepen.find((g) => g.id === gid)!;
    // Opbrengsten staan credit (positief tonen), kosten debet.
    const t = groep.opbrengst ? -1 : 1;
    const kw = perKw.map((m) => t * vol(m, code)) as [Centen, Centen, Centen, Centen];
    const regel: WVRegel = { code, naam: i.naam, rgs: i.rgs, kwartalen: kw.map((x) => x || 0) as [Centen, Centen, Centen, Centen], jaar: som(kw) || 0, vorigJaar: t * vol(vorig, code) || 0 };
    groep.regels.push(regel);
    telOp(groep, regel);
  }
  const opbrengsten = leeg();
  const kosten = leeg();
  for (const g of groepen) telOp(g.opbrengst ? opbrengsten : kosten, g);
  const resultaat = leeg();
  telOp(resultaat, opbrengsten);
  telOp(resultaat, kosten, -1);
  return { jaar, groepen: groepen.filter((g) => g.regels.length), opbrengsten, kosten, resultaat };
}

/** Het resultaat van een jaar (opbrengsten − kosten, zonder de afsluitpost). */
export function resultaatVan(posten: readonly JournaalPost[], grootboek: readonly Grootboekrekening[], jaar: number, tot?: Datum): Centen {
  const info = rekeningInfo(grootboek);
  let r = 0;
  const eind = tot && tot < jaarEinde(jaar) ? tot : jaarEinde(jaar);
  for (const [code, v] of mutaties(posten, jaarBegin(jaar), eind, { zonderAfsluiting: true })) {
    if (isResultaatSoort(info(code).soort)) r -= v;
  }
  return r;
}

// ---------------------------------------------------------------------------------
// Balans
// ---------------------------------------------------------------------------------
export interface BalansRegel {
  code: string | null;
  naam: string;
  bedrag: Centen;
}

export interface BalansGroep {
  id: string;
  titel: string;
  regels: BalansRegel[];
  totaal: Centen;
}

export interface Balans {
  datum: Datum;
  activa: BalansGroep[];
  passiva: BalansGroep[];
  totaalActiva: Centen;
  totaalPassiva: Centen;
  /** Moet 0 zijn (de balans sluit altijd als het journaal sluit). */
  verschil: Centen;
}

const ACTIVA_GROEPEN = [
  { id: 'vaste_activa', titel: 'Vaste activa' },
  { id: 'vorderingen', titel: 'Vorderingen' },
  { id: 'liquide_middelen', titel: 'Liquide middelen' }
];
const PASSIVA_GROEPEN = [
  { id: 'eigen_vermogen', titel: 'Eigen vermogen' },
  { id: 'schulden', titel: 'Kortlopende schulden' }
];

/**
 * De balans op een datum (alle posten t/m die datum, ook afsluitposten).
 * Activa: debetsaldo positief. Passiva en eigen vermogen: creditsaldo positief.
 * Btw-rekeningen komen per saldo op één regel (te betalen of te vorderen). Het nog niet
 * verdeelde resultaat staat in het eigen vermogen: "Resultaat boekjaar" (tot de jaarafsluiting)
 * en "Resultaat eerdere jaren" (jaren die nog niet zijn afgesloten).
 */
export function balans(posten: readonly JournaalPost[], grootboek: readonly Grootboekrekening[], datum: Datum): Balans {
  const info = rekeningInfo(grootboek);
  const j = jaarVan(datum);
  const saldo = mutaties(posten, null, datum);
  // Resultaat van dit boekjaar zonder de afsluitpost; is het jaar al afgesloten, dan staat
  // alles op kapitaal en telt er geen "resultaat dit jaar" meer.
  const afgesloten = posten.some((p) => isAfsluiting(p) && p.datum >= jaarBegin(j) && p.datum <= datum);
  const ditJaar = afgesloten ? new Map<string, Centen>() : mutaties(posten, jaarBegin(j), datum, { zonderAfsluiting: true });
  const activa = new Map(ACTIVA_GROEPEN.map((g) => [g.id, [] as BalansRegel[]]));
  const passiva = new Map(PASSIVA_GROEPEN.map((g) => [g.id, [] as BalansRegel[]]));
  let btw = 0;
  let resultaatJaar = 0;
  let resultaatEerder = 0;
  for (const code of [...saldo.keys()].sort()) {
    const s = saldo.get(code) ?? 0;
    const i = info(code);
    if (isResultaatSoort(i.soort)) {
      const d = ditJaar.get(code) ?? 0;
      resultaatJaar -= d;
      resultaatEerder -= s - d;
      continue;
    }
    if (s === 0) continue;
    if (i.rubriek === 'btw') {
      btw += s;
      continue;
    }
    if (i.soort === 'activa') {
      const g = activa.has(i.rubriek) ? i.rubriek : 'vorderingen';
      activa.get(g)!.push({ code, naam: i.naam, bedrag: s });
    } else {
      const g = i.soort === 'eigen_vermogen' ? 'eigen_vermogen' : 'schulden';
      passiva.get(g)!.push({ code, naam: i.naam, bedrag: -s });
    }
  }
  if (btw > 0) activa.get('vorderingen')!.push({ code: null, naam: 'Btw te vorderen (per saldo)', bedrag: btw });
  if (btw < 0) passiva.get('schulden')!.push({ code: null, naam: 'Btw te betalen (per saldo)', bedrag: -btw });
  // Vaste namen (los van het jaartal), zodat begin- en eindbalans regel voor regel naast elkaar staan.
  if (resultaatEerder) passiva.get('eigen_vermogen')!.push({ code: null, naam: 'Resultaat eerdere jaren (niet verdeeld)', bedrag: resultaatEerder });
  if (resultaatJaar) passiva.get('eigen_vermogen')!.push({ code: null, naam: 'Resultaat boekjaar', bedrag: resultaatJaar });

  const naarGroepen = (defs: { id: string; titel: string }[], m: Map<string, BalansRegel[]>): BalansGroep[] =>
    defs.map((d) => ({ ...d, regels: m.get(d.id)!, totaal: som(m.get(d.id)!.map((r) => r.bedrag)) })).filter((g) => g.regels.length);
  const a = naarGroepen(ACTIVA_GROEPEN, activa);
  const p = naarGroepen(PASSIVA_GROEPEN, passiva);
  const totaalActiva = som(a.map((g) => g.totaal));
  const totaalPassiva = som(p.map((g) => g.totaal));
  return { datum, activa: a, passiva: p, totaalActiva, totaalPassiva, verschil: totaalActiva - totaalPassiva };
}

// ---------------------------------------------------------------------------------
// Proefbalans en grootboekkaart
// ---------------------------------------------------------------------------------
export interface ProefRegel {
  code: string;
  naam: string;
  soort: RekeningSoort;
  rgs: string | null;
  begin: Centen;
  debet: Centen;
  credit: Centen;
  eind: Centen;
}

export interface Proefbalans {
  van: Datum;
  tot: Datum;
  regels: ProefRegel[];
  totaal: { begin: Centen; debet: Centen; credit: Centen; eind: Centen };
}

/** Per rekening: beginsaldo, debet- en creditmutaties in de periode en het eindsaldo (debet − credit). */
export function proefbalansRapport(posten: readonly JournaalPost[], grootboek: readonly Grootboekrekening[], van: Datum, tot: Datum): Proefbalans {
  const info = rekeningInfo(grootboek);
  const rij = new Map<string, ProefRegel>();
  const pak = (code: string) => {
    let r = rij.get(code);
    if (!r) {
      const i = info(code);
      r = { code, naam: i.naam, soort: i.soort, rgs: i.rgs, begin: 0, debet: 0, credit: 0, eind: 0 };
      rij.set(code, r);
    }
    return r;
  };
  for (const p of posten) {
    if (p.datum > tot) continue;
    for (const r of p.regels) {
      const x = pak(r.grootboek);
      if (p.datum < van) x.begin += r.debet - r.credit;
      else {
        x.debet += r.debet;
        x.credit += r.credit;
      }
    }
  }
  const regels = [...rij.values()].map((r) => ({ ...r, eind: r.begin + r.debet - r.credit })).filter((r) => r.begin || r.debet || r.credit).sort((a, b) => (a.code < b.code ? -1 : 1));
  const totaal = { begin: som(regels.map((r) => r.begin)), debet: som(regels.map((r) => r.debet)), credit: som(regels.map((r) => r.credit)), eind: som(regels.map((r) => r.eind)) };
  return { van, tot, regels, totaal };
}

export interface KaartRegel {
  postId: string;
  bron: JournaalPost['bron'];
  bronId: string;
  datum: Datum;
  omschrijving: string;
  debet: Centen;
  credit: Centen;
  saldo: Centen;
}

export interface Grootboekkaart {
  code: string;
  naam: string;
  begin: Centen;
  regels: KaartRegel[];
  debet: Centen;
  credit: Centen;
  eind: Centen;
}

/** Alle mutaties op één rekening in een periode, met lopend saldo (debet − credit). */
export function grootboekkaart(posten: readonly JournaalPost[], grootboek: readonly Grootboekrekening[], code: string, van: Datum, tot: Datum): Grootboekkaart {
  let begin = 0;
  const regels: KaartRegel[] = [];
  let saldo = 0;
  for (const p of posten) {
    if (p.datum > tot) continue;
    let d = 0;
    let c = 0;
    for (const r of p.regels) {
      if (r.grootboek !== code) continue;
      d += r.debet;
      c += r.credit;
    }
    if (!d && !c) continue;
    if (p.datum < van) {
      begin += d - c;
      continue;
    }
    if (!regels.length) saldo = begin;
    saldo += d - c;
    regels.push({ postId: p.id, bron: p.bron, bronId: p.bronId, datum: p.datum, omschrijving: p.omschrijving, debet: d, credit: c, saldo });
  }
  const debet = som(regels.map((r) => r.debet));
  const credit = som(regels.map((r) => r.credit));
  return { code, naam: rekeningInfo(grootboek)(code).naam, begin, regels, debet, credit, eind: begin + debet - credit };
}

// ---------------------------------------------------------------------------------
// Vennoten: winstverdeling en kapitaal
// ---------------------------------------------------------------------------------
export interface Winstdeel {
  vennootId: string;
  naam: string;
  aandeel: number;
  bedrag: Centen;
}

/** Het resultaat verdeeld over de actieve vennoten naar hun winstaandeel (exact, op de cent). */
export function winstverdeling(vennoten: readonly Vennoot[], resultaat: Centen): Winstdeel[] {
  const mee = vennoten.filter((v) => v.actief && v.aandeel > 0);
  if (!mee.length) return [];
  // Aandelen in honderdsten van procenten (numeric(5,2)) als gehele gewichten.
  const bedragen = verdeel(resultaat, mee.map((v) => Math.round(v.aandeel * 100)));
  return mee.map((v, i) => ({ vennootId: v.id, naam: v.naam, aandeel: v.aandeel, bedrag: bedragen[i] }));
}

export interface KapitaalRegel {
  vennootId: string;
  naam: string;
  aandeel: number;
  /** Kapitaal + privé op 1 januari (creditsaldo = positief). */
  begin: Centen;
  /** Inbreng of correcties op de kapitaalrekening in het jaar (memoriaal). */
  inbreng: Centen;
  winstaandeel: Centen;
  /** Stortingen en voorgeschoten kosten (privé credit). */
  stortingen: Centen;
  /** Privé-opnamen (privé debet). */
  opnamen: Centen;
  /** begin + inbreng + winstaandeel + stortingen − opnamen */
  eind: Centen;
  /** Kapitaal + privé volgens het grootboek op 31-12 (gelijk aan eind na de jaarafsluiting). */
  grootboek: Centen;
}

export interface Kapitaalvergelijking {
  jaar: number;
  resultaat: Centen;
  regels: KapitaalRegel[];
  /** Saldo van 0900 (beginvermogen / onverdeeld) plus het resultaat van jaren vóór dit jaar dat nog openstaat. */
  onverdeeld: Centen;
}

export function kapitaalVergelijking(posten: readonly JournaalPost[], stam: Pick<Stamdata, 'grootboek' | 'vennoten'>, jaar: number, totDatum?: Datum): Kapitaalvergelijking {
  const eindDatum = totDatum && totDatum < jaarEinde(jaar) ? totDatum : jaarEinde(jaar);
  const resultaat = resultaatVan(posten, stam.grootboek, jaar, eindDatum);
  const delen = new Map(winstverdeling(stam.vennoten, resultaat).map((w) => [w.vennootId, w.bedrag]));
  const voor = mutaties(posten, null, jaarEinde(jaar - 1));
  const tot = mutaties(posten, null, eindDatum);
  const inJaar = new Map<string, { debet: Centen; credit: Centen }>();
  for (const p of posten) {
    if (p.datum < jaarBegin(jaar) || p.datum > eindDatum || isAfsluiting(p)) continue;
    for (const r of p.regels) {
      const t = inJaar.get(r.grootboek) ?? { debet: 0, credit: 0 };
      t.debet += r.debet;
      t.credit += r.credit;
      inJaar.set(r.grootboek, t);
    }
  }
  const regels: KapitaalRegel[] = stam.vennoten
    .filter((v) => v.actief || vol(tot, v.grootboekKapitaal) || vol(tot, v.grootboekPrive))
    .map((v) => {
      const begin = -(vol(voor, v.grootboekKapitaal) + vol(voor, v.grootboekPrive));
      const k = inJaar.get(v.grootboekKapitaal) ?? { debet: 0, credit: 0 };
      const p = inJaar.get(v.grootboekPrive) ?? { debet: 0, credit: 0 };
      const inbreng = k.credit - k.debet;
      const winstaandeel = delen.get(v.id) ?? 0;
      const eind = begin + inbreng + winstaandeel + p.credit - p.debet;
      return {
        vennootId: v.id,
        naam: v.naam,
        aandeel: v.aandeel,
        begin,
        inbreng,
        winstaandeel,
        stortingen: p.credit,
        opnamen: p.debet,
        eind,
        grootboek: -(vol(tot, v.grootboekKapitaal) + vol(tot, v.grootboekPrive))
      };
    });
  return { jaar, resultaat, regels, onverdeeld: onverdeeldVermogen(posten, stam.grootboek, jaar) };
}

/**
 * Wat er op 31-12 nog niet aan een vennoot is toegerekend: het saldo van 0900 (beginbalans /
 * onverdeeld) plus het resultaat van eerdere jaren dat niet is afgesloten (bv. afschrijvingen
 * vóór de start van de administratie). Creditsaldo = positief.
 */
export function onverdeeldVermogen(posten: readonly JournaalPost[], grootboek: readonly Grootboekrekening[], jaar: number): Centen {
  const info = rekeningInfo(grootboek);
  const voor = mutaties(posten, null, jaarEinde(jaar - 1));
  let rest = -vol(mutaties(posten, null, jaarEinde(jaar)), GB.beginbalans);
  for (const [code, v] of voor) if (isResultaatSoort(info(code).soort)) rest -= v;
  return rest;
}

// ---------------------------------------------------------------------------------
// Jaarafsluiting
// ---------------------------------------------------------------------------------
export interface AfsluitVoorstel {
  jaar: number;
  datum: Datum;
  resultaat: Centen;
  /** Resultaat van eerdere jaren dat nog op de resultaatrekeningen stond (gaat naar 0900). */
  resultaatEerder: Centen;
  verdeling: (Winstdeel & { prive: Centen })[];
  regels: MemoriaalRegel[];
}

/**
 * De afsluitpost op 31-12:
 *   - elke resultaatrekening naar 0 (het saldo t/m 31-12, zonder eerdere afsluitposten van dit jaar);
 *   - het resultaat van het jaar naar de kapitaalrekeningen, naar winstaandeel (exact verdeeld);
 *   - een resultaat van eerdere, niet afgesloten jaren (vóór de start) naar 0900;
 *   - de privérekeningen naar de kapitaalrekening van dezelfde vennoot.
 * De post sluit altijd (debet = credit).
 */
export function jaarafsluitingVoorstel(posten: readonly JournaalPost[], stam: Pick<Stamdata, 'grootboek' | 'vennoten'>, jaar: number): AfsluitVoorstel {
  const info = rekeningInfo(stam.grootboek);
  const datum = jaarEinde(jaar);
  const totEind = mutaties(posten, null, datum);
  const ditJaar = mutaties(posten, jaarBegin(jaar), datum, { zonderAfsluiting: true });
  const regels: MemoriaalRegel[] = [];
  const kant = (grootboek: string, bedrag: Centen, omschrijving: string, vennootId: string | null = null): MemoriaalRegel | null =>
    bedrag === 0 ? null : bedrag > 0 ? { grootboek, debet: bedrag, credit: 0, vennootId, omschrijving } : { grootboek, debet: 0, credit: -bedrag, vennootId, omschrijving };
  const plus = (r: MemoriaalRegel | null) => {
    if (r) regels.push(r);
  };

  let resultaat = 0;
  let resultaatEerder = 0;
  for (const code of [...totEind.keys()].sort()) {
    if (!isResultaatSoort(info(code).soort)) continue;
    const s = totEind.get(code) ?? 0;
    if (!s) continue;
    plus(kant(code, -s, 'Resultaatrekening naar 0'));
    const d = ditJaar.get(code) ?? 0;
    resultaat -= d;
    resultaatEerder -= s - d;
  }
  const delen = winstverdeling(stam.vennoten, resultaat);
  if (resultaat !== 0 && !delen.length) throw new Error('jaarafsluiting: geen vennoten met een winstaandeel');
  for (const w of delen) {
    const v = stam.vennoten.find((x) => x.id === w.vennootId)!;
    plus(kant(v.grootboekKapitaal, -w.bedrag, `Winstaandeel ${jaar} (${w.aandeel}%)`, v.id));
  }
  plus(kant(GB.beginbalans, -resultaatEerder, 'Resultaat van vóór dit boekjaar'));
  const verdeling: AfsluitVoorstel['verdeling'] = [];
  for (const v of stam.vennoten) {
    const p = vol(totEind, v.grootboekPrive);
    if (p) {
      plus(kant(v.grootboekPrive, -p, 'Privé naar kapitaal', v.id));
      plus(kant(v.grootboekKapitaal, p, 'Privé naar kapitaal', v.id));
    }
    const w = delen.find((x) => x.vennootId === v.id);
    if (w || p) verdeling.push({ vennootId: v.id, naam: v.naam, aandeel: v.aandeel, bedrag: w?.bedrag ?? 0, prive: -p });
  }
  const d = som(regels.map((r) => r.debet));
  const c = som(regels.map((r) => r.credit));
  if (d !== c) throw new Error(`jaarafsluiting sluit niet: ${d} ≠ ${c}`);
  return { jaar, datum, resultaat, resultaatEerder, verdeling, regels };
}

export interface AfsluitControle {
  id: string;
  titel: string;
  ok: boolean;
  /** true = moet in orde zijn vóór afsluiten; false = waarschuwing. */
  blokkeert: boolean;
  uitleg: string;
  href?: string;
}

export interface BanksaldoControle {
  rekeningId: string;
  naam: string;
  berekend: Centen;
  opgegeven: Centen | null;
  ok: boolean;
}

/**
 * De checklist vóór de jaarafsluiting. `banksaldi` = het saldo volgens het bankafschrift per
 * 31-12 per rekening (zoals ingevuld); zonder opgave is die controle niet in orde.
 */
export function afsluitControles(o: {
  jaar: number;
  vandaag: Datum;
  stam: Stamdata;
  posten: readonly JournaalPost[];
  boekingen: readonly Boeking[];
  aangiften: readonly { jaar: number; kwartaal: Kwartaal }[];
  /** Begin van de administratie (eerste kwartaal dat aangegeven moet zijn). */
  start: Datum;
  banksaldi: Record<string, Centen | null | undefined>;
  /** Kwartalen van dit jaar die na indiening zijn gewijzigd (labels). */
  gewijzigdNaIndiening?: string[];
}): { controles: AfsluitControle[]; banksaldi: BanksaldoControle[] } {
  const { jaar, stam, posten } = o;
  const eind = jaarEinde(jaar);
  const saldo = mutaties(posten, null, eind);
  const startJaar = jaarVan(o.start);
  const controles: AfsluitControle[] = [];

  controles.push({
    id: 'voorbij',
    titel: `Boekjaar ${jaar} is voorbij`,
    ok: o.vandaag > eind,
    blokkeert: true,
    uitleg: o.vandaag > eind ? 'Het jaar is afgelopen.' : `Afsluiten kan vanaf 1 januari ${jaar + 1}.`
  });

  const eerderOpen: number[] = [];
  for (let j = startJaar; j < jaar; j++) if (!stam.vergrendeling.boekjaren.includes(j)) eerderOpen.push(j);
  controles.push({
    id: 'eerder',
    titel: 'Eerdere boekjaren afgesloten',
    ok: eerderOpen.length === 0,
    blokkeert: true,
    uitleg: eerderOpen.length ? `Sluit eerst ${eerderOpen.join(', ')} af.` : jaar > startJaar ? 'Alle eerdere jaren zijn afgesloten.' : 'Dit is het eerste boekjaar.',
    href: eerderOpen.length ? `/boekhouding/rapporten/jaarafsluiting/${eerderOpen[0]}` : undefined
  });

  const eersteQ: Kwartaal = jaar === startJaar ? kwartaalVan(o.start) : 1;
  const open: string[] = [];
  for (let q = eersteQ; q <= 4; q++) if (!o.aangiften.some((a) => a.jaar === jaar && a.kwartaal === q)) open.push(`Q${q}`);
  controles.push({
    id: 'btw',
    titel: 'Alle btw-aangiften ingediend',
    ok: open.length === 0,
    blokkeert: true,
    uitleg: open.length ? `Nog niet ingediend: ${open.join(', ')} ${jaar}.` : 'Alle kwartalen zijn ingediend (en daarmee vergrendeld).',
    href: open.length ? `/boekhouding/btw/${jaar}/${open[0].slice(1)}` : undefined
  });
  if (o.gewijzigdNaIndiening?.length) {
    controles.push({
      id: 'gewijzigd',
      titel: 'Btw gewijzigd na indiening',
      ok: false,
      blokkeert: false,
      uitleg: `${o.gewijzigdNaIndiening.join(', ')}: na het indienen is er nog iets gewijzigd. Neem het verschil mee in een volgende aangifte of dien een suppletie in.`,
      href: '/boekhouding/btw'
    });
  }

  const teVerwerken = o.boekingen.filter((b) => b.status === 'te_verwerken' && jaarVan(b.datum) === jaar).length;
  controles.push({
    id: 'te_verwerken',
    titel: 'Alle bankregels verwerkt',
    ok: teVerwerken === 0,
    blokkeert: true,
    uitleg: teVerwerken ? `${teVerwerken} ${teVerwerken === 1 ? 'regel staat' : 'regels staan'} nog op "te verwerken".` : 'Geen regels meer te verwerken.',
    href: teVerwerken ? `/boekhouding/bank?jaar=${jaar}&status=te_verwerken` : undefined
  });

  const somAandelen = stam.vennoten.filter((v) => v.actief).reduce((t, v) => t + Math.round(v.aandeel * 100), 0);
  controles.push({
    id: 'aandelen',
    titel: 'Winstverdeling klopt',
    ok: somAandelen === 10000,
    blokkeert: true,
    uitleg:
      somAandelen === 10000
        ? stam.vennoten.filter((v) => v.actief).map((v) => `${v.naam} ${v.aandeel}%`).join(' · ')
        : `De winstaandelen tellen op tot ${somAandelen / 100}% in plaats van 100%.`,
    href: '/boekhouding/instellingen#vennoten'
  });

  const banksaldi: BanksaldoControle[] = stam.rekeningen
    .filter((r) => r.actief || vol(saldo, r.grootboek) !== 0)
    .map((r) => {
      const berekend = vol(saldo, r.grootboek);
      const opg = o.banksaldi[r.id];
      const opgegeven = typeof opg === 'number' && Number.isSafeInteger(opg) ? opg : null;
      return { rekeningId: r.id, naam: r.naam, berekend, opgegeven, ok: opgegeven !== null && opgegeven === berekend };
    });
  const mis = banksaldi.filter((b) => !b.ok);
  controles.push({
    id: 'bank',
    titel: 'Banksaldi aangesloten op 31-12',
    ok: mis.length === 0,
    blokkeert: true,
    uitleg: mis.length
      ? `Vul het saldo volgens het bankafschrift per 31 december in${mis.some((b) => b.opgegeven !== null) ? '; bij een verschil ontbreekt er een regel of staat er een dubbel' : ''}.`
      : 'Het berekende saldo is gelijk aan het bankafschrift.'
  });

  const kruis = vol(saldo, GB.kruisposten);
  controles.push({
    id: 'kruisposten',
    titel: 'Kruisposten op nul',
    ok: kruis === 0,
    blokkeert: false,
    uitleg: kruis ? 'Er staat nog een overboeking tussen eigen rekeningen open (bv. onderweg over de jaargrens). Controleer bij Openstaand.' : 'Alle overboekingen tussen eigen rekeningen zijn compleet.',
    href: kruis ? '/boekhouding/openstaand' : undefined
  });
  const vraag = vol(saldo, GB.vraagposten);
  controles.push({
    id: 'vraagposten',
    titel: 'Geen vraagposten',
    ok: vraag === 0,
    blokkeert: false,
    uitleg: vraag ? 'Er staat een bedrag op 1900 Vraagposten (onbekende rekening of categorie). Corrigeer de boeking of boek een memoriaalpost.' : 'Geen onbekende posten.',
    href: vraag ? `/boekhouding/rapporten?r=grootboek&jaar=${jaar}&code=${GB.vraagposten}` : undefined
  });
  const onverdeeld = onverdeeldVermogen(posten, stam.grootboek, jaar);
  controles.push({
    id: 'beginvermogen',
    titel: 'Beginvermogen verdeeld over de vennoten',
    ok: onverdeeld === 0,
    blokkeert: false,
    uitleg: onverdeeld
      ? 'Er staat nog vermogen op 0900 (beginbalans / onverdeeld). Boek een memoriaalpost die het naar de kapitaalrekeningen van de vennoten verdeelt.'
      : 'Al het vermogen staat op naam van een vennoot.',
    href: onverdeeld ? '/boekhouding/instellingen#memoriaal' : undefined
  });
  return { controles, banksaldi };
}

export const afsluitenMag = (controles: readonly AfsluitControle[]): boolean => controles.every((c) => c.ok || !c.blokkeert);
