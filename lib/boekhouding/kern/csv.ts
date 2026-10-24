// CSV-exports voor de boekhouder (Excel-vriendelijk: UTF-8 met BOM, puntkomma, bedragen met
// decimale komma zonder duizendtallen). Pure module.
//
// Tekstvelden die met = + - @ beginnen krijgen een apostrof ervoor, zodat een spreadsheet ze
// niet als formule uitvoert (CSV-injectie). Bedragen zijn altijd echte getallen.

import type { Centen } from './geld';
import { BTW_LABELS } from './btw';
import { jaarVan, kwartaalVan, type Datum } from './periode';
import type { JournaalPost } from './journaal';
import type { Koppeling } from './bronnen';
import { rekeningInfo, type Balans, type Kapitaalvergelijking, type Proefbalans, type WinstEnVerlies } from './rapporten';
import { berekenBoeking, RICHTING_LABELS, SOORT_LABELS, type Boeking, type Stamdata } from '../model';

/** Een bedrag in centen als CSV-getal ("1234,56", "-12,30"). */
export class CsvBedrag {
  readonly centen: Centen;
  constructor(centen: Centen) {
    this.centen = centen;
  }
}
export const bedrag = (c: Centen): CsvBedrag => new CsvBedrag(c);

export type CsvWaarde = string | number | CsvBedrag | null | undefined;

function bedragTekst(c: Centen): string {
  const abs = Math.abs(c);
  const t = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
  return c < 0 ? `-${t}` : t;
}

export function csvVeld(v: CsvWaarde): string {
  if (v === null || v === undefined) return '';
  if (v instanceof CsvBedrag) return bedragTekst(v.centen);
  if (typeof v === 'number') return String(v);
  let s = v.replace(/\r\n?/g, '\n');
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /[;"\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function naarCsv(kop: string[], rijen: CsvWaarde[][]): string {
  const regels = [kop, ...rijen].map((r) => r.map(csvVeld).join(';'));
  return `﻿${regels.join('\r\n')}\r\n`;
}

const bronLabels: Record<JournaalPost['bron'], string> = {
  boeking: 'Bank',
  beginsaldo: 'Beginsaldo',
  memoriaal: 'Memoriaal',
  factuur: 'Factuur',
  uitgave: 'Bonnetje',
  activum: 'Activum',
  afschrijving: 'Afschrijving',
  btw_afsluiting: 'Btw-aangifte'
};

/** Alle bankregels van een jaar (of alles bij jaar = null), met btw, kwartaal, categorie en koppeling. */
export function boekingenCsv(o: {
  boekingen: readonly Boeking[];
  stam: Stamdata;
  koppelingen: readonly Koppeling[];
  documentLabel: (k: Koppeling) => string;
  jaar: number | null;
}): string {
  const info = rekeningInfo(o.stam.grootboek);
  const bank = new Map(o.stam.rekeningen.map((r) => [r.id, r.naam]));
  const ven = new Map(o.stam.vennoten.map((v) => [v.id, v.naam]));
  const perBoeking = new Map<string, Koppeling[]>();
  for (const k of o.koppelingen) perBoeking.set(k.boekingId, [...(perBoeking.get(k.boekingId) ?? []), k]);
  const rijen: CsvWaarde[][] = [];
  for (const b of o.boekingen) {
    if (o.jaar !== null && jaarVan(b.datum) !== o.jaar) continue;
    const r = berekenBoeking(b);
    const ks = perBoeking.get(b.id) ?? [];
    const telt = !(ks.length && (b.soort === 'inkomst' || b.soort === 'uitgave'));
    const gb = b.grootboek ? info(b.grootboek) : null;
    rijen.push([
      b.datum,
      jaarVan(b.datum),
      `Q${kwartaalVan(b.datum)}`,
      bank.get(b.rekeningId ?? '') ?? 'Kas',
      b.omschrijving,
      b.tegenpartij,
      SOORT_LABELS[b.soort].label,
      RICHTING_LABELS[b.soort][b.richting],
      bedrag(r.bankMutatie),
      telt ? bedrag(r.teken * r.btw.excl) : null,
      telt ? bedrag(r.teken * r.btw.voorbelasting) : null,
      telt ? bedrag(r.teken * r.btw.verschuldigd) : null,
      b.soort === 'inkomst' ? BTW_LABELS[b.btwCode].inkomst : b.soort === 'uitgave' ? BTW_LABELS[b.btwCode].uitgave : '',
      telt ? r.btw.rubriek ?? '' : '',
      b.grootboek,
      gb?.naam ?? '',
      gb?.rgs ?? '',
      b.vennootId ? ven.get(b.vennootId) ?? '' : '',
      b.status === 'te_verwerken' ? 'te verwerken' : 'geboekt',
      ks.map(o.documentLabel).join(', '),
      b.notities
    ]);
  }
  return naarCsv(
    ['Datum', 'Jaar', 'Kwartaal', 'Bank', 'Omschrijving', 'Tegenpartij', 'Soort', 'Richting', 'Bedrag bank', 'Excl. btw', 'Voorbelasting', 'Af te dragen btw', 'Btw-soort', 'Rubriek', 'Grootboek', 'Categorie', 'RGS', 'Vennoot', 'Status', 'Gekoppeld aan', 'Notities'],
    rijen
  );
}

/** Alle journaalregels (dubbel boekhouden) in een periode: de mutaties per rekening. */
export function journaalCsv(posten: readonly JournaalPost[], stam: Pick<Stamdata, 'grootboek'>, van: Datum, tot: Datum): string {
  const info = rekeningInfo(stam.grootboek);
  const rijen: CsvWaarde[][] = [];
  for (const p of posten) {
    if (p.datum < van || p.datum > tot) continue;
    for (const r of p.regels) {
      const i = info(r.grootboek);
      rijen.push([p.datum, p.id, bronLabels[p.bron] + (p.memoriaalSoort ? ` (${p.memoriaalSoort})` : ''), p.omschrijving, r.grootboek, i.naam, i.rgs, bedrag(r.debet), bedrag(r.credit), p.btw?.rubriek ?? '']);
    }
  }
  return naarCsv(['Datum', 'Post', 'Bron', 'Omschrijving', 'Rekening', 'Naam', 'RGS', 'Debet', 'Credit', 'Btw-rubriek'], rijen);
}

export function wvCsv(wv: WinstEnVerlies): string {
  const rijen: CsvWaarde[][] = [];
  for (const g of wv.groepen) {
    for (const r of g.regels) rijen.push([g.titel, r.code, r.naam, ...r.kwartalen.map(bedrag), bedrag(r.jaar), bedrag(r.vorigJaar)]);
    rijen.push([`Totaal ${g.titel.toLowerCase()}`, '', '', ...g.kwartalen.map(bedrag), bedrag(g.jaar), bedrag(g.vorigJaar)]);
  }
  rijen.push(['Resultaat', '', '', ...wv.resultaat.kwartalen.map(bedrag), bedrag(wv.resultaat.jaar), bedrag(wv.resultaat.vorigJaar)]);
  return naarCsv(['Groep', 'Rekening', 'Naam', 'Q1', 'Q2', 'Q3', 'Q4', String(wv.jaar), String(wv.jaar - 1)], rijen);
}

export function balansCsv(begin: Balans, eind: Balans): string {
  const rijen: CsvWaarde[][] = [];
  const sleutel = (code: string | null, naam: string) => `${code ?? ''}|${naam}`;
  for (const zijde of ['activa', 'passiva'] as const) {
    const titels = new Map<string, string>();
    const groepen = [...begin[zijde], ...eind[zijde]];
    for (const g of groepen) titels.set(g.id, g.titel);
    for (const [id, titel] of titels) {
      const gb = begin[zijde].find((g) => g.id === id);
      const ge = eind[zijde].find((g) => g.id === id);
      const regels = new Map<string, { code: string | null; naam: string }>();
      for (const r of [...(gb?.regels ?? []), ...(ge?.regels ?? [])]) regels.set(sleutel(r.code, r.naam), r);
      for (const [k, r] of regels) {
        const b = gb?.regels.find((x) => sleutel(x.code, x.naam) === k)?.bedrag ?? 0;
        const e = ge?.regels.find((x) => sleutel(x.code, x.naam) === k)?.bedrag ?? 0;
        rijen.push([zijde === 'activa' ? 'Activa' : 'Passiva', titel, r.code, r.naam, bedrag(b), bedrag(e)]);
      }
      rijen.push([zijde === 'activa' ? 'Activa' : 'Passiva', `Totaal ${titel.toLowerCase()}`, '', '', bedrag(gb?.totaal ?? 0), bedrag(ge?.totaal ?? 0)]);
    }
    rijen.push([zijde === 'activa' ? 'Totaal activa' : 'Totaal passiva', '', '', '', bedrag(zijde === 'activa' ? begin.totaalActiva : begin.totaalPassiva), bedrag(zijde === 'activa' ? eind.totaalActiva : eind.totaalPassiva)]);
  }
  return naarCsv(['Zijde', 'Groep', 'Rekening', 'Naam', `Per ${begin.datum}`, `Per ${eind.datum}`], rijen);
}

export function proefbalansCsv(p: Proefbalans): string {
  const rijen: CsvWaarde[][] = p.regels.map((r) => [r.code, r.naam, r.rgs, r.soort, bedrag(r.begin), bedrag(r.debet), bedrag(r.credit), bedrag(r.eind)]);
  rijen.push(['Totaal', '', '', '', bedrag(p.totaal.begin), bedrag(p.totaal.debet), bedrag(p.totaal.credit), bedrag(p.totaal.eind)]);
  return naarCsv(['Rekening', 'Naam', 'RGS', 'Soort', `Saldo ${p.van}`, 'Debet', 'Credit', `Saldo ${p.tot}`], rijen);
}

export function kapitaalCsv(k: Kapitaalvergelijking): string {
  const rijen: CsvWaarde[][] = k.regels.map((r) => [r.naam, `${r.aandeel}%`, bedrag(r.begin), bedrag(r.inbreng), bedrag(r.winstaandeel), bedrag(r.stortingen), bedrag(r.opnamen), bedrag(r.eind)]);
  return naarCsv(['Vennoot', 'Winstaandeel', `Kapitaal 1-1-${k.jaar}`, 'Inbreng/correcties', `Winstaandeel ${k.jaar}`, 'Stortingen', 'Opnamen', `Kapitaal 31-12-${k.jaar}`], rijen);
}
