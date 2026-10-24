// HTML voor de PDF's van de boekhouding (gerenderd met renderPdf uit lib/invoice/pdf.ts, dat
// alleen wordt geïmporteerd): het jaarrapport (winst-en-verlies, balans, activastaat en
// kapitaal per vennoot) en het overzicht van een btw-aangifte. Zwart op wit, A4, met dezelfde
// ingebedde letters als de facturen (werkt identiek op Vercel).

import { INTER_400, INTER_600, INTER_700 } from '../invoice/font-data';
import { formatBedrag, formatCenten, formatHeleEuro, type Centen } from './kern/geld';
import { langeDatum, korteDatum, kwartaalLabel, type Datum } from './kern/periode';
import { RUBRIEK_GROEPEN, RUBRIEK_INFO, MET_BTW, type AangifteBerekening, type Aangifte } from './kern/aangifte';
import type { Balans, BalansGroep } from './kern/rapporten';
import type { Jaarrapport } from './jaarwerk';
import type { Instellingen } from './model';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const b = (c: Centen) => (c === 0 ? '—' : formatBedrag(c));

const STIJL = `
  @font-face { font-family: 'Inter'; font-weight: 400; src: url(data:font/woff2;base64,${INTER_400}) format('woff2'); }
  @font-face { font-family: 'Inter'; font-weight: 600; src: url(data:font/woff2;base64,${INTER_600}) format('woff2'); }
  @font-face { font-family: 'Inter'; font-weight: 700; src: url(data:font/woff2;base64,${INTER_700}) format('woff2'); }
  @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body { background: #fff; }
  body { margin: 0; font-family: 'Inter', Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #1b1b1b; line-height: 1.4; }
  h1 { margin: 0 0 2mm; font-size: 18pt; font-weight: 700; letter-spacing: -0.01em; }
  h2 { margin: 9mm 0 3mm; font-size: 12pt; font-weight: 700; }
  h3 { margin: 4mm 0 1.5mm; font-size: 9.5pt; font-weight: 700; }
  .kop { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 4mm; border-bottom: 1.5pt solid #1b1b1b; }
  .sub { color: #666; font-size: 8.5pt; }
  .label { font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: #777; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 7.5pt; letter-spacing: 0.06em; text-transform: uppercase; color: #777; font-weight: 600; padding: 1.5mm 1mm; border-bottom: 0.6pt solid #bbb; }
  td { padding: 1.3mm 1mm; border-bottom: 0.4pt solid #e3e3e3; vertical-align: top; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.code { width: 12mm; color: #777; }
  tr.tot td { font-weight: 700; border-bottom: 0.8pt solid #1b1b1b; border-top: 0.6pt solid #999; }
  tr.groot td { font-size: 11pt; font-weight: 700; border-bottom: 1.5pt solid #1b1b1b; }
  .twee { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
  .blok { break-inside: avoid; }
  .noot { margin-top: 3mm; color: #666; font-size: 8pt; }
  .pil { display: inline-block; padding: 0.5mm 2mm; border: 0.6pt solid #999; border-radius: 3mm; font-size: 7.5pt; color: #444; }
  .nieuw { break-before: page; }
`;

function document(titel: string, inhoud: string): string {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>${STIJL}</style></head><body>${inhoud}</body></html>`;
}

function kop(inst: Instellingen, titel: string, sub: string, rechts: string): string {
  const ids = [inst.kvk ? `KvK ${inst.kvk}` : '', inst.btwNummer ? `Btw ${inst.btwNummer}` : ''].filter(Boolean).join(' · ');
  return `<div class="kop"><div><div class="label">${esc(inst.bedrijfsnaam)}${inst.rechtsvorm === 'vof' ? ' VOF' : ''}</div><h1>${esc(titel)}</h1><div class="sub">${esc(sub)}</div></div><div class="sub" style="text-align:right">${esc(rechts)}${ids ? `<br>${esc(ids)}` : ''}</div></div>`;
}

function balansKolom(titel: string, groepen: BalansGroep[], groepenBegin: BalansGroep[], totaal: Centen, totaalBegin: Centen, eindLabel: string, beginLabel: string): string {
  let h = `<div class="blok"><h3>${esc(titel)}</h3><table><thead><tr><th></th><th class="r">${esc(beginLabel)}</th><th class="r">${esc(eindLabel)}</th></tr></thead><tbody>`;
  const ids = [...new Set([...groepenBegin.map((g) => g.id), ...groepen.map((g) => g.id)])];
  for (const id of ids) {
    const ge = groepen.find((g) => g.id === id);
    const gb = groepenBegin.find((g) => g.id === id);
    const namen = [...new Set([...(gb?.regels ?? []), ...(ge?.regels ?? [])].map((r) => r.naam))];
    h += `<tr><td colspan="3" style="font-weight:600;border-bottom:0;padding-top:2.5mm">${esc((ge ?? gb)!.titel)}</td></tr>`;
    for (const n of namen) {
      h += `<tr><td>${esc(n)}</td><td class="r">${b(gb?.regels.find((r) => r.naam === n)?.bedrag ?? 0)}</td><td class="r">${b(ge?.regels.find((r) => r.naam === n)?.bedrag ?? 0)}</td></tr>`;
    }
  }
  h += `<tr class="tot"><td>Totaal</td><td class="r">${formatBedrag(totaalBegin)}</td><td class="r">${formatBedrag(totaal)}</td></tr></tbody></table></div>`;
  return h;
}

function balansHtml(begin: Balans, eind: Balans): string {
  const bl = `per ${korteDatum(begin.datum)}`;
  const el = `per ${korteDatum(eind.datum)}`;
  return `<div class="twee">${balansKolom('Activa', eind.activa, begin.activa, eind.totaalActiva, begin.totaalActiva, el, bl)}${balansKolom('Passiva', eind.passiva, begin.passiva, eind.totaalPassiva, begin.totaalPassiva, el, bl)}</div>`;
}

/** Het jaarrapport: W&V, balans, activastaat en kapitaal per vennoot. */
export function jaarrapportHtml(o: { inst: Instellingen; r: Jaarrapport; vandaag: Datum; demo: boolean }): string {
  const { inst, r } = o;
  const status = r.afgesloten ? 'Boekjaar afgesloten' : r.lopend ? `Voorlopig, t/m ${korteDatum(r.tot)}` : 'Boekjaar nog niet afgesloten';
  let h = kop(inst, `Jaarrapport ${r.jaar}`, `${status}${o.demo ? ' · DEMO (voorbeeldgegevens)' : ''}`, `Gemaakt op ${langeDatum(o.vandaag)}`);

  h += `<h2>Winst-en-verliesrekening</h2><table><thead><tr><th>Rekening</th><th class="r">Q1</th><th class="r">Q2</th><th class="r">Q3</th><th class="r">Q4</th><th class="r">${r.jaar}</th><th class="r">${r.jaar - 1}</th></tr></thead><tbody>`;
  for (const g of r.wv.groepen) {
    h += `<tr><td colspan="7" style="font-weight:600;border-bottom:0;padding-top:2.5mm">${esc(g.titel)}</td></tr>`;
    for (const x of g.regels) h += `<tr><td>${esc(x.code)} ${esc(x.naam)}</td>${x.kwartalen.map((k) => `<td class="r">${b(k)}</td>`).join('')}<td class="r">${b(x.jaar)}</td><td class="r">${b(x.vorigJaar)}</td></tr>`;
    h += `<tr class="tot"><td>Totaal ${esc(g.titel.toLowerCase())}</td>${g.kwartalen.map((k) => `<td class="r">${b(k)}</td>`).join('')}<td class="r">${b(g.jaar)}</td><td class="r">${b(g.vorigJaar)}</td></tr>`;
  }
  h += `<tr class="groot"><td>Resultaat</td>${r.wv.resultaat.kwartalen.map((k) => `<td class="r">${formatBedrag(k)}</td>`).join('')}<td class="r">${formatBedrag(r.wv.resultaat.jaar)}</td><td class="r">${formatBedrag(r.wv.resultaat.vorigJaar)}</td></tr></tbody></table>`;
  h += `<p class="noot">Bedragen in euro's, exclusief btw. Factuurstelsel: omzet en kosten in de periode van de factuur- of bondatum.</p>`;

  h += `<div class="nieuw"></div><h2>Balans</h2>${balansHtml(r.balansBegin, r.balansEind)}`;
  if (r.balansEind.verschil !== 0) h += `<p class="noot">Let op: de balans sluit niet (verschil ${formatCenten(r.balansEind.verschil)}).</p>`;

  h += `<div class="blok"><h2>Kapitaal per vennoot</h2><table><thead><tr><th>Vennoot</th><th class="r">1 jan</th><th class="r">Inbreng</th><th class="r">Winstaandeel</th><th class="r">Stortingen</th><th class="r">Opnamen</th><th class="r">31 dec</th></tr></thead><tbody>`;
  for (const v of r.kapitaal.regels) {
    h += `<tr><td>${esc(v.naam)} <span class="sub">(${v.aandeel}%)</span></td><td class="r">${formatBedrag(v.begin)}</td><td class="r">${b(v.inbreng)}</td><td class="r">${formatBedrag(v.winstaandeel)}</td><td class="r">${b(v.stortingen)}</td><td class="r">${b(-v.opnamen)}</td><td class="r">${formatBedrag(v.eind)}</td></tr>`;
  }
  h += `<tr class="tot"><td>Resultaat ${r.jaar}</td><td></td><td></td><td class="r">${formatBedrag(r.kapitaal.resultaat)}</td><td></td><td></td><td></td></tr></tbody></table>`;
  h += `<p class="noot">Winstverdeling volgens de aandelen in de instellingen. Het winstaandeel is de basis voor de inkomstenbelasting van elke vennoot.${r.kapitaal.onverdeeld ? ` Nog niet verdeeld vermogen: ${formatCenten(r.kapitaal.onverdeeld)}.` : ''}</p></div>`;

  h += `<div class="blok"><h2>Activastaat</h2><table><thead><tr><th>Activum</th><th class="r">Begin</th><th class="r">Investering</th><th class="r">Afschrijving</th><th class="r">Desinvestering</th><th class="r">Eind</th></tr></thead><tbody>`;
  for (const a of r.activa.regels) {
    h += `<tr><td>${esc(a.activum.omschrijving)} <span class="sub">${korteDatum(a.activum.ingebruikname)} · ${Math.round(a.activum.looptijdMaanden / 12 * 10) / 10} jr</span></td><td class="r">${b(a.begin)}</td><td class="r">${b(a.investering)}</td><td class="r">${b(a.afschrijving)}</td><td class="r">${b(a.desinvestering)}</td><td class="r">${b(a.eind)}</td></tr>`;
  }
  const t = r.activa.totaal;
  h += `<tr class="tot"><td>Totaal</td><td class="r">${b(t.begin)}</td><td class="r">${b(t.investering)}</td><td class="r">${b(t.afschrijving)}</td><td class="r">${b(t.desinvestering)}</td><td class="r">${b(t.eind)}</td></tr></tbody></table>`;
  h += `<p class="noot">Lineair per maand vanaf ingebruikname; afschrijving voor het hele jaar ${r.jaar}.</p></div>`;
  return document(`Jaarrapport ${r.jaar} · ${inst.bedrijfsnaam}`, h);
}

/** Het overzicht van één btw-aangifte, in de opbouw van het formulier. */
export function aangifteHtml(o: { inst: Instellingen; ber: AangifteBerekening; aangifte: Aangifte | null; vandaag: Datum; demo: boolean }): string {
  const { inst, ber } = o;
  const label = kwartaalLabel(ber.jaar, ber.kwartaal);
  const status = o.aangifte ? `Ingediend op ${korteDatum(o.aangifte.ingediendOp.slice(0, 10))}${o.aangifte.kenmerk ? ` · kenmerk ${o.aangifte.kenmerk}` : ''}` : 'Nog niet ingediend';
  let h = kop(inst, `Btw-aangifte ${label}`, `${korteDatum(ber.van)} t/m ${korteDatum(ber.tot)} · ${status}${o.demo ? ' · DEMO (voorbeeldgegevens)' : ''}`, `Gemaakt op ${langeDatum(o.vandaag)}`);
  h += `<table style="margin-top:6mm"><thead><tr><th style="width:10mm">Rubriek</th><th></th><th class="r">Omzet</th><th class="r">Omzetbelasting</th></tr></thead><tbody>`;
  for (const g of RUBRIEK_GROEPEN) {
    h += `<tr><td colspan="4" style="font-weight:600;border-bottom:0;padding-top:3mm">${esc(g.titel)}</td></tr>`;
    for (const rb of g.rubrieken) {
      const x = ber.rubrieken[rb];
      h += `<tr><td class="code">${rb}</td><td>${esc(RUBRIEK_INFO[rb].titel)}</td><td class="r">${formatHeleEuro(x.grondslag.euro)}</td><td class="r">${MET_BTW.has(rb) ? formatHeleEuro(x.btw.euro) : ''}</td></tr>`;
    }
  }
  h += `<tr><td colspan="4" style="font-weight:600;border-bottom:0;padding-top:3mm">5. Voorbelasting en totaal</td></tr>`;
  h += `<tr><td class="code">5a</td><td>${esc(RUBRIEK_INFO['5a'].titel)}</td><td></td><td class="r">${formatHeleEuro(ber.verschuldigd.euro)}</td></tr>`;
  h += `<tr><td class="code">5b</td><td>${esc(RUBRIEK_INFO['5b'].titel)}</td><td></td><td class="r">${formatHeleEuro(ber.voorbelasting.euro)}</td></tr>`;
  h += `<tr class="groot"><td class="code">5c</td><td>${ber.saldo.euro >= 0 ? 'Te betalen' : 'Terug te vragen'}</td><td></td><td class="r">${formatHeleEuro(Math.abs(ber.saldo.euro))}</td></tr></tbody></table>`;
  h += `<p class="noot">Hele euro's, afgerond in het voordeel van de ondernemer (omzet en verschuldigde btw omlaag, voorbelasting omhoog). Exact in centen: te betalen ${formatCenten(ber.saldo.centen)}. Factuurstelsel.</p>`;
  return document(`Btw-aangifte ${label} · ${inst.bedrijfsnaam}`, h);
}
