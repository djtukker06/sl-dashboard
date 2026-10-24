// Jaarwerk: wat de rapportschermen, de exports en de jaarafsluiting samen gebruiken, bovenop
// de pure kern (kern/rapporten.ts). Geen netwerk; werkt op de geladen BoekhoudData.

import type { Centen } from './kern/geld';
import type { JournaalPost } from './kern/journaal';
import { aangifteRubrieken, vergelijkMetIngediend } from './kern/aangifte';
import { jaarVan, kwartaalLabel, type Datum } from './kern/periode';
import { activastaat } from './kern/afschrijving';
import {
  afsluitControles,
  afsluitenMag,
  balans,
  jaarafsluitingVoorstel,
  jaarEinde,
  kapitaalVergelijking,
  winstEnVerlies,
  type AfsluitControle,
  type AfsluitVoorstel,
  type BanksaldoControle
} from './kern/rapporten';
import type { BoekhoudData } from './repo/types';

/** Begin van de administratie: de startdatum of het vroegste beginsaldo (anders 1 januari dit jaar). */
export function administratieStart(d: BoekhoudData, vandaag: Datum): Datum {
  const kandidaten = [d.stam.instellingen.startdatum, ...d.stam.rekeningen.map((r) => r.begindatum)].filter((x): x is string => !!x);
  const begin = kandidaten.length ? kandidaten.sort()[0] : `${jaarVan(vandaag)}-01-01`;
  return begin > vandaag ? vandaag : begin;
}

/** De boekjaren om uit te kiezen (nieuwste eerst), vanaf het startjaar. */
export function boekjarenLijst(d: BoekhoudData, vandaag: Datum): number[] {
  const nu = jaarVan(vandaag);
  const start = Math.max(nu - 11, jaarVan(administratieStart(d, vandaag)));
  return Array.from({ length: nu - start + 1 }, (_, i) => nu - i);
}

/** Kwartalen van een jaar die na indiening nog zijn gewijzigd ("Q2 2026"). */
export function gewijzigdNaIndiening(d: BoekhoudData, posten: readonly JournaalPost[], jaar: number): string[] {
  return d.aangiften
    .filter((a) => a.jaar === jaar && a.snapshot)
    .filter((a) => vergelijkMetIngediend(a.snapshot!, aangifteRubrieken(posten, a.jaar, a.kwartaal)).advies !== 'geen')
    .map((a) => kwartaalLabel(a.jaar, a.kwartaal));
}

/** Tot welke datum een jaar telt in de rapporten: 31-12, of vandaag voor het lopende jaar. */
export function rapportTot(jaar: number, vandaag: Datum): Datum {
  const eind = jaarEinde(jaar);
  return vandaag < eind ? vandaag : eind;
}

export interface AfsluitStatus {
  jaar: number;
  afgesloten: boolean;
  controles: AfsluitControle[];
  banksaldi: BanksaldoControle[];
  voorstel: AfsluitVoorstel | null;
  fout: string | null;
  mag: boolean;
}

export function afsluitStatus(d: BoekhoudData, posten: readonly JournaalPost[], jaar: number, vandaag: Datum, banksaldi: Record<string, Centen | null | undefined>): AfsluitStatus {
  const { controles, banksaldi: saldi } = afsluitControles({
    jaar,
    vandaag,
    stam: d.stam,
    posten,
    boekingen: d.boekingen,
    aangiften: d.aangiften,
    start: administratieStart(d, vandaag),
    banksaldi,
    gewijzigdNaIndiening: gewijzigdNaIndiening(d, posten, jaar)
  });
  let voorstel: AfsluitVoorstel | null = null;
  let fout: string | null = null;
  try {
    voorstel = jaarafsluitingVoorstel(posten, d.stam, jaar);
  } catch (e) {
    fout = (e as Error).message;
  }
  const afgesloten = d.stam.vergrendeling.boekjaren.includes(jaar);
  return { jaar, afgesloten, controles, banksaldi: saldi, voorstel, fout, mag: !afgesloten && !fout && afsluitenMag(controles) };
}

/** Wat bij de jaarafsluiting wordt bewaard (bk_boekjaren.samenvatting): de kerncijfers op dat moment. */
export function jaarSamenvatting(d: BoekhoudData, posten: readonly JournaalPost[], jaar: number, voorstel: AfsluitVoorstel, banksaldi: BanksaldoControle[]): Record<string, unknown> {
  const wv = winstEnVerlies(posten, d.stam.grootboek, jaar);
  const b = balans(posten, d.stam.grootboek, jaarEinde(jaar));
  return {
    versie: 1,
    resultaat: voorstel.resultaat,
    omzet: wv.groepen.find((g) => g.id === 'omzet')?.jaar ?? 0,
    kosten: wv.kosten.jaar,
    balanstotaal: b.totaalActiva,
    verdeling: voorstel.verdeling.map((v) => ({ vennoot: v.naam, aandeel: v.aandeel, winst: v.bedrag, prive: v.prive })),
    banksaldi: banksaldi.map((s) => ({ rekening: s.naam, saldo: s.berekend })),
    activa: activastaat(d.activa, jaar).totaal.eind
  };
}

/** Alles voor het jaarrapport (scherm, PDF en CSV). */
export function jaarrapport(d: BoekhoudData, posten: readonly JournaalPost[], jaar: number, vandaag: Datum) {
  const tot = rapportTot(jaar, vandaag);
  return {
    jaar,
    tot,
    lopend: tot < jaarEinde(jaar),
    afgesloten: d.stam.vergrendeling.boekjaren.includes(jaar),
    wv: winstEnVerlies(posten, d.stam.grootboek, jaar, tot),
    balansBegin: balans(posten, d.stam.grootboek, jaarEinde(jaar - 1)),
    balansEind: balans(posten, d.stam.grootboek, tot),
    kapitaal: kapitaalVergelijking(posten, d.stam, jaar, tot),
    activa: activastaat(d.activa, jaar)
  };
}
export type Jaarrapport = ReturnType<typeof jaarrapport>;
