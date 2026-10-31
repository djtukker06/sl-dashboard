import { INTER_400, INTER_600, INTER_700, INTER_800, EB_GARAMOND_700 } from './font-data';
import { LOGO_PNG_BASE64 } from './logo-data';

// EJS-template voor de factuur-PDF. Zelfde visuele ontwerp als de oorspronkelijke
// Express-versie (navy-op-crème A4-layout), maar met zelf-gehoste, ingebedde fonts
// (Inter i.p.v. Helvetica Neue/Arial, EB Garamond i.p.v. Georgia) zodat de PDF er op
// de serverless Vercel-omgeving (Linux, geen Apple-systeemfonts) identiek uitziet aan
// wat lokaal is goedgekeurd.
export const FACTUUR_TEMPLATE = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title><%= factuur.soort === 'prijsopgave' ? 'Prijsopgave' : 'Factuur' %> <%= factuur.factuurnummer %></title>
<style>
  @font-face {
    font-family: 'Inter';
    font-weight: 400;
    src: url(data:font/woff2;base64,${INTER_400}) format('woff2');
  }
  @font-face {
    font-family: 'Inter';
    font-weight: 600;
    src: url(data:font/woff2;base64,${INTER_600}) format('woff2');
  }
  @font-face {
    font-family: 'Inter';
    font-weight: 700;
    src: url(data:font/woff2;base64,${INTER_700}) format('woff2');
  }
  @font-face {
    font-family: 'Inter';
    font-weight: 800;
    src: url(data:font/woff2;base64,${INTER_800}) format('woff2');
  }
  @font-face {
    font-family: 'EB Garamond';
    font-weight: 700;
    src: url(data:font/woff2;base64,${EB_GARAMOND_700}) format('woff2');
  }

  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Inter', sans-serif;
    color: #1c2a3a;
    background: #f4f5f8;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 18mm 16mm;
    background: #f4f5f8;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 10mm;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 4mm;
  }
  .logo {
    width: 16mm;
    height: 16mm;
    background: #1c2a4a;
    border-radius: 1.5mm;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .logo img {
    width: 62%;
    height: 62%;
    object-fit: contain;
  }
  .brand-name {
    font-family: 'EB Garamond', serif;
    font-size: 18pt;
    font-weight: 700;
    color: #1c2a4a;
    line-height: 1.1;
  }
  .brand-people {
    font-size: 8.5pt;
    font-weight: 400;
    color: #4a5a70;
    margin-top: 1mm;
  }
  .invoice-title {
    font-size: 26pt;
    font-weight: 800;
    color: #1c2a4a;
    letter-spacing: 0.5px;
  }
  .info-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 8mm;
    margin-bottom: 10mm;
    font-size: 9.5pt;
    font-weight: 400;
    line-height: 1.55;
  }
  .sender { grid-column: 1; grid-row: 1; }
  .aan-block { grid-column: 1; grid-row: 2; margin-top: 4mm; }
  .aan-label { font-weight: 700; display: inline-block; width: 9mm; vertical-align: top; }
  .aan-content { display: inline-block; vertical-align: top; }
  .gegevens { grid-column: 2; grid-row: 2; align-self: start; }
  .gegevens table { border-collapse: collapse; }
  .gegevens td { padding: 0.3mm 0; font-size: 9.5pt; }
  .gegevens td.label { font-weight: 700; text-align: right; padding-right: 3mm; white-space: nowrap; }
  .gegevens td.value { font-weight: 400; text-align: right; white-space: nowrap; }

  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 6mm;
  }
  table.items thead th {
    background: #1c2a4a;
    color: #fff;
    font-size: 8.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 3mm 4mm;
    text-align: left;
  }
  table.items thead th.mid { text-align: right; }
  table.items thead th.totaal { text-align: right; }
  table.items tbody td {
    padding: 3mm 4mm;
    font-size: 9.5pt;
    font-weight: 400;
    border-bottom: 1px solid #dfe3ea;
  }
  table.items tbody td.beschrijving { font-weight: 600; }
  table.items tbody td.mid { text-align: right; color: #4a5a70; }
  table.items tbody td.totaal { text-align: right; }

  .samenvatting {
    width: 65mm;
    margin-left: auto;
    margin-bottom: 14mm;
  }
  .samenvatting table { width: 100%; border-collapse: collapse; }
  .samenvatting td { padding: 1.6mm 0; font-size: 9.5pt; font-weight: 400; }
  .samenvatting td.label { text-align: right; padding-right: 4mm; color: #4a5a70; }
  .samenvatting td.value { text-align: right; }
  .samenvatting tr.totaal td { border-top: 1px solid #1c2a4a; font-weight: 800; font-size: 10.5pt; padding-top: 2.5mm; }

  .footer {
    text-align: center;
    font-size: 8.5pt;
    font-weight: 400;
    color: #3a4a60;
    line-height: 1.8;
  }
  .footer a { color: #1c2a4a; white-space: nowrap; }
  .footer .btw-verlegd { font-weight: 600; color: #1c2a4a; margin-bottom: 1.5mm; }
  .footer .aanbetaling { font-weight: 600; color: #1c2a4a; margin-bottom: 1.5mm; }
  .title-block { text-align: right; }
  .aanbetaling-label {
    display: inline-block;
    margin-top: 2mm;
    padding: 1.2mm 3mm;
    background: #1c2a4a;
    color: #fff;
    border-radius: 1mm;
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div class="brand">
        <div class="logo"><img src="data:image/png;base64,${LOGO_PNG_BASE64}" alt="Studio Levant"></div>
        <div>
          <div class="brand-name"><%= bedrijf.bedrijfsnaam %></div>
          <div class="brand-people"><%= bedrijf.eigenaren %></div>
        </div>
      </div>
      <% if (factuur.aanbetalingPercentage || factuur.restbetaling) { %>
      <div class="title-block">
        <div class="invoice-title">Factuur</div>
        <% if (factuur.aanbetalingPercentage) { %>
        <div class="aanbetaling-label">Aanbetaling <%= factuur.aanbetalingPercentage %>%</div>
        <% } else { %>
        <div class="aanbetaling-label">Restbetaling <%= factuur.restbetaling.percentage %>%</div>
        <% } %>
      </div>
      <% } else { %>
      <div class="invoice-title"><%= factuur.soort === 'prijsopgave' ? 'Prijsopgave' : 'Factuur' %></div>
      <% } %>
    </div>

    <div class="info-row">
      <div class="sender">
        <div><%= bedrijf.bedrijfsnaam %></div>
        <div><%= bedrijf.adresregel %></div>
        <div><%= bedrijf.postcode %></div>
      </div>
      <% if (factuur.aanRegels.length > 0) { %>
      <div class="aan-block">
        <% factuur.aanRegels.forEach(function(regel, i) { %><% if (i > 0) { %><br>
        <% } %><span class="aan-label"><%= i === 0 ? 'Aan:' : '' %></span><span class="aan-content"><%= regel %></span><% }) %>
      </div>
      <% } %>
      <div class="gegevens">
        <table>
          <tr><td class="label">Datum:</td><td class="value"><%= factuur.datumWeergave %></td></tr>
          <% if (factuur.soort !== 'prijsopgave') { %><tr><td class="label">Bank:</td><td class="value"><%= bedrijf.iban %></td></tr><% } %>
          <tr><td class="label">KVK-nummer:</td><td class="value"><%= bedrijf.kvkNummer %></td></tr>
          <tr><td class="label">Btw-nummer:</td><td class="value"><%= bedrijf.btwNummer %></td></tr>
          <% if (factuur.soort === 'prijsopgave') { %>
          <% if (factuur.factuurnummer) { %><tr><td class="label">Prijsopgavenummer:</td><td class="value"><%= factuur.factuurnummer %></td></tr><% } %>
          <% } else { %>
          <tr><td class="label">Factuurnummer:</td><td class="value"><%= factuur.factuurnummer %></td></tr>
          <% } %>
        </table>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Beschrijving</th>
          <% if (factuur.middenKolomLabel) { %><th class="mid"><%= factuur.middenKolomLabel %></th><% } %>
          <th class="totaal"><% if (factuur.aanbetalingPercentage) { %>Aanbetaling (<%= factuur.aanbetalingPercentage %>%)<% } else { %>Totaal<% } %></th>
        </tr>
      </thead>
      <tbody>
        <% factuur.regels.forEach(function(regel) { %>
        <tr>
          <td class="beschrijving"><%= regel.beschrijving %></td>
          <% if (factuur.middenKolomLabel) { %><td class="mid"><%= regel.midden || '-' %></td><% } %>
          <td class="totaal">&euro; <%= regel.totaalWeergave %></td>
        </tr>
        <% }) %>
      </tbody>
    </table>

    <div class="samenvatting">
      <table>
        <tr><td class="label">Subtotaal</td><td class="value">&euro; <%= factuur.subtotaalWeergave %></td></tr>
        <% if (factuur.btwVerlegd) { %>
        <tr><td class="label">Btw</td><td class="value"><%= factuur.btwVerlegdTekst %></td></tr>
        <% } else { %>
        <tr><td class="label">Btw (<%= factuur.btwPercentage %>%)</td><td class="value">&euro; <%= factuur.btwWeergave %></td></tr>
        <% } %>
        <tr class="totaal"><td class="label"><%= factuur.aanbetalingPercentage ? 'Totaal aanbetaling' : 'Totaal' %></td><td class="value">&euro; <%= factuur.totaalWeergave %></td></tr>
      </table>
    </div>

    <div class="footer">
      <% if (factuur.aanbetalingPercentage) { %><div class="aanbetaling">Deze factuur betreft een aanbetaling van <%= factuur.aanbetalingPercentage %>% van het totale opdrachtbedrag van &euro; <%= factuur.volledigSubtotaalWeergave %> (excl. btw). Het resterende bedrag van &euro; <%= factuur.restantWeergave %> (excl. btw) dient te worden voldaan na de oplevering van het project.</div><% } %>
      <% if (factuur.restbetaling) { %><div class="aanbetaling">Deze factuur betreft het resterende bedrag (<%= factuur.restbetaling.percentage %>%) van de opdracht, na de aanbetaling van <%= 100 - factuur.restbetaling.percentage %>% op factuur <%= factuur.restbetaling.aanbetalingNummer %>.</div><% } %>
      <% if (factuur.btwVerlegdReden) { %><div class="btw-verlegd"><%= factuur.btwVerlegdReden %></div><% } %>
      <% if (factuur.soort === 'prijsopgave') { %>
      <div>Na schriftelijk akkoord starten wij met de werkzaamheden.</div>
      <div>De genoemde prijs is exclusief kosten voor hosting, domeinnaam, betaalde plugins/licenties en eventueel meerwerk of aanvullende functionaliteiten buiten de afgesproken scope.</div>
      <div>Wij kijken uit naar een prettige samenwerking.</div>
      <div>Op deze prijsopgave zijn onze algemene voorwaarden van toepassing, te vinden op <a href="https://<%= bedrijf.algemeneVoorwaardenUrl %>"><%= bedrijf.algemeneVoorwaardenUrl %></a>.</div>
      <% } else { %>
      <div>Betaling van deze factuur dient binnen 14 dagen te worden voldaan aan <%= bedrijf.bedrijfsnaam %>.</div>
      <div>Bij betaling van deze factuur gaat u automatisch akkoord met onze algemene voorwaarden, te vinden op <a href="https://<%= bedrijf.algemeneVoorwaardenUrl %>"><%= bedrijf.algemeneVoorwaardenUrl %></a>.</div>
      <div>Bedankt voor de samenwerking!</div>
      <% } %>
      <div>Voor al uw vragen zijn wij bereikbaar op <%= bedrijf.email %>.</div>
    </div>
  </div>
</body>
</html>
`;
