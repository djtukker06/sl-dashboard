// XML Auditfile Financieel (XAF 3.2) van één boekjaar: het grootboek, de openingsbalans per
// 1 januari en alle journaalposten van het jaar, ingedeeld in dagboeken (bank, verkoop,
// inkoop, memoriaal). Boekhouders en de Belastingdienst lezen dit formaat in. Pure module.
//
// Opbouw volgens het XAF 3.2-schema (namespace http://www.auditfiles.nl/XAF/3.2). Niet
// gevalideerd tegen de officiële XSD in deze omgeving; de totalen sluiten op de proefbalans
// (scripts/test-boekhouding.mjs controleert dat).

import { som, type Centen } from './geld';
import { BTW_CODES, BTW_LABELS } from './btw';
import { GB } from './constanten';
import { isResultaatSoort, jaarBegin, jaarEinde, mutaties, rekeningInfo } from './rapporten';
import { dagenInMaand, maakDatum, maandVan, type Datum } from './periode';
import type { JournaalPost } from './journaal';
import type { Stamdata } from '../model';

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

export function xmlTekst(v: string, max = 255): string {
  return v
    .slice(0, max)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 123456 → "1234.56" (altijd positief; de kant staat in amntTp). */
function xBedrag(c: Centen): string {
  const a = Math.abs(c);
  return `${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

type Dagboek = { id: string; desc: string; tp: string };
const DAGBOEKEN: Record<string, Dagboek> = {
  bank: { id: 'BNK', desc: 'Bank', tp: 'B' },
  verkoop: { id: 'VRK', desc: 'Verkoop (facturen)', tp: 'S' },
  inkoop: { id: 'INK', desc: 'Inkoop (bonnetjes en inkoopfacturen)', tp: 'P' },
  memoriaal: { id: 'MEM', desc: 'Memoriaal (beginsaldi, afschrijvingen, btw-aangifte, correcties)', tp: 'Z' }
};

function dagboekVan(p: JournaalPost): Dagboek {
  if (p.bron === 'boeking') return DAGBOEKEN.bank;
  if (p.bron === 'factuur') return DAGBOEKEN.verkoop;
  if (p.bron === 'uitgave') return DAGBOEKEN.inkoop;
  return DAGBOEKEN.memoriaal;
}

export interface XafUitkomst {
  xml: string;
  opening: { regels: number; debet: Centen; credit: Centen };
  mutaties: { regels: number; debet: Centen; credit: Centen };
}

export function xafAuditfile(o: { stam: Stamdata; posten: readonly JournaalPost[]; jaar: number; vandaag: Datum; softwareVersie?: string }): XafUitkomst {
  const { stam, posten, jaar } = o;
  const info = rekeningInfo(stam.grootboek);
  const van = jaarBegin(jaar);
  const tot = jaarEinde(jaar);
  const r: string[] = [];
  const t = (naam: string, waarde: string | number) => `<${naam}>${typeof waarde === 'number' ? waarde : xmlTekst(waarde)}</${naam}>`;

  // Openingsbalans: balansrekeningen per 31-12 vorig jaar; een nog niet afgesloten resultaat
  // van eerdere jaren komt op 0900 (onverdeeld), zodat de openingsbalans sluit.
  const voor = mutaties(posten, null, jaarEinde(jaar - 1));
  const opening = new Map<string, Centen>();
  for (const [code, s] of voor) {
    const k = isResultaatSoort(info(code).soort) ? GB.beginbalans : code;
    opening.set(k, (opening.get(k) ?? 0) + s);
  }
  const obRegels = [...opening.entries()].filter(([, s]) => s !== 0).sort(([a], [b]) => (a < b ? -1 : 1));

  // Rekeningen die voorkomen (grootboek + onbekende codes uit het journaal).
  const codes = new Set(stam.grootboek.map((g) => g.code));
  for (const p of posten) for (const x of p.regels) codes.add(x.grootboek);

  const jaarPosten = posten.filter((p) => p.datum >= van && p.datum <= tot);
  const mutRegels = jaarPosten.reduce((n, p) => n + p.regels.length, 0);
  const mutDebet = som(jaarPosten.flatMap((p) => p.regels.map((x) => x.debet)));
  const mutCredit = som(jaarPosten.flatMap((p) => p.regels.map((x) => x.credit)));
  const obDebet = som(obRegels.map(([, s]) => (s > 0 ? s : 0)));
  const obCredit = som(obRegels.map(([, s]) => (s < 0 ? -s : 0)));

  r.push('<?xml version="1.0" encoding="UTF-8"?>');
  r.push('<auditfile xmlns="http://www.auditfiles.nl/XAF/3.2">');
  r.push('<header>');
  r.push(t('fiscalYear', String(jaar)), t('startDate', van), t('endDate', tot), t('curCode', 'EUR'), t('dateCreated', o.vandaag));
  r.push(t('softwareDesc', 'Studio Levant backoffice'), t('softwareVersion', o.softwareVersie ?? '1.0'));
  r.push('</header>');
  r.push('<company>');
  if (stam.instellingen.kvk) r.push(t('companyIdent', stam.instellingen.kvk));
  r.push(t('companyName', stam.instellingen.bedrijfsnaam), t('taxRegistrationCountry', 'NL'));
  if (stam.instellingen.btwNummer) r.push(t('taxRegIdent', stam.instellingen.btwNummer));

  r.push('<generalLedger>');
  for (const code of [...codes].sort()) {
    const i = info(code);
    r.push(`<ledgerAccount>${t('accID', code)}${t('accDesc', i.naam)}${t('accTp', isResultaatSoort(i.soort) ? 'P' : 'B')}</ledgerAccount>`);
  }
  r.push('</generalLedger>');

  r.push('<vatCodes>');
  for (const c of BTW_CODES) r.push(`<vatCode>${t('vatID', c)}${t('vatDesc', `${BTW_LABELS[c].uitgave} / ${BTW_LABELS[c].inkomst}`)}</vatCode>`);
  r.push('</vatCodes>');

  r.push('<periods>');
  for (let m = 1; m <= 12; m++) {
    r.push(`<period>${t('periodNumber', m)}${t('periodDesc', `${MAANDEN[m - 1]} ${jaar}`)}${t('startDatePeriod', maakDatum(jaar, m, 1))}${t('endDatePeriod', maakDatum(jaar, m, dagenInMaand(jaar, m)))}</period>`);
  }
  r.push('</periods>');

  if (obRegels.length) {
    r.push('<openingBalance>');
    r.push(t('opBalDate', van), t('opBalDesc', `Openingsbalans ${jaar}`), t('linesCount', obRegels.length), t('totalDebit', xBedrag(obDebet)), t('totalCredit', xBedrag(obCredit)));
    obRegels.forEach(([code, s], i) => r.push(`<obLine>${t('nr', String(i + 1))}${t('accID', code)}${t('amnt', xBedrag(s))}${t('amntTp', s > 0 ? 'D' : 'C')}</obLine>`));
    r.push('</openingBalance>');
  }

  r.push('<transactions>');
  r.push(t('linesCount', mutRegels), t('totalDebit', xBedrag(mutDebet)), t('totalCredit', xBedrag(mutCredit)));
  for (const d of Object.values(DAGBOEKEN)) {
    const lijst = jaarPosten.filter((p) => dagboekVan(p) === d);
    if (!lijst.length) continue;
    r.push('<journal>');
    r.push(t('jrnID', d.id), t('desc', d.desc), t('jrnTp', d.tp));
    lijst.forEach((p, i) => {
      const bedrag = som(p.regels.map((x) => x.debet));
      r.push('<transaction>');
      r.push(t('nr', String(i + 1)), t('desc', p.omschrijving), t('periodNumber', maandVan(p.datum)), t('trDt', p.datum), t('amnt', xBedrag(bedrag)), t('amntTp', 'D'), t('sourceID', p.id.slice(0, 35)));
      p.regels.forEach((x, n) => {
        const c = x.debet - x.credit;
        r.push(`<trLine>${t('nr', String(n + 1))}${t('accID', x.grootboek)}${t('docRef', p.bronId.slice(0, 35))}${t('effDate', p.datum)}${t('desc', p.omschrijving)}${t('amnt', xBedrag(c))}${t('amntTp', c >= 0 ? 'D' : 'C')}</trLine>`);
      });
      r.push('</transaction>');
    });
    r.push('</journal>');
  }
  r.push('</transactions>');
  r.push('</company>');
  r.push('</auditfile>');
  return {
    xml: `${r.join('\n')}\n`,
    opening: { regels: obRegels.length, debet: obDebet, credit: obCredit },
    mutaties: { regels: mutRegels, debet: mutDebet, credit: mutCredit }
  };
}
