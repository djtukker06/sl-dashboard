require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const ejs = require('ejs');
const puppeteer = require('puppeteer');

const config = require('./config');
const store = require('./lib/store');
const basicAuth = require('./lib/auth');
const { formatDatumNL, formatEuro, parseBedrag, slugify } = require('./lib/helpers');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(basicAuth);
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let browserPromise;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browserPromise;
}

function klantenOverzicht() {
  return store.alleKlanten().map((slug) => {
    const facturen = store.facturenVanKlant(slug);
    const naam = facturen.length > 0 ? facturen[0].klant.bedrijfsnaam : slug;
    const totaal = facturen.reduce((som, f) => som + f.totaal, 0);
    return { slug, naam, facturen, totaalWeergave: formatEuro(totaal) };
  }).filter((klant) => klant.facturen.length > 0);
}

app.get('/', (req, res) => {
  const klanten = klantenOverzicht();
  const huidigJaar = new Date().getFullYear();
  const facturenDitJaar = store.alleFacturen().filter((f) => new Date(f.datum).getFullYear() === huidigJaar);

  // Facturen die al bestonden vóór dit tool in gebruik werd genomen (buiten dit archief om),
  // tellen mee zodat het aantal klopt met de doorlopende nummering.
  const basisAantal = config.factuurnummerStart.jaar === huidigJaar
    ? config.factuurnummerStart.laatsteVolgnummer
    : 0;

  const facturen = store.alleFacturen()
    .map((f) => ({ ...f, slug: slugify(f.klant.bedrijfsnaam) }))
    .sort((a, b) => b.factuurnummer.localeCompare(a.factuurnummer));

  res.render('overzicht', {
    klanten,
    facturen,
    stats: {
      aantalFacturenDitJaar: basisAantal + facturenDitJaar.length
    }
  });
});

app.post('/klanten/:slug/facturen/:nummer/verwijderen', (req, res) => {
  store.verwijderFactuur(req.params.slug, req.params.nummer);
  res.redirect(req.get('Referer') || '/');
});

app.get('/nieuwe-factuur', (req, res) => {
  const jaar = new Date().getFullYear();
  res.render('nieuwe-factuur', { volgendFactuurnummer: store.volgendFactuurnummer(jaar) });
});

app.post('/facturen', async (req, res, next) => {
  try {
    const {
      klantBedrijfsnaam, klantTav, klantAdres, klantPostcode, middenKolomLabel
    } = req.body;

    const beschrijvingen = [].concat(req.body.regelBeschrijving || []);
    const middens = [].concat(req.body.regelMidden || []);
    const totalen = [].concat(req.body.regelTotaal || []);

    const regels = beschrijvingen.map((beschrijving, i) => {
      const bedrag = parseBedrag(totalen[i] || '0');
      return {
        beschrijving,
        midden: (middens[i] || '').trim(),
        totaal: bedrag,
        totaalWeergave: formatEuro(bedrag)
      };
    }).filter((regel) => regel.beschrijving.trim() !== '');

    if (regels.length === 0) {
      return res.status(400).send('Voeg minimaal 1 factuurregel toe.');
    }

    const subtotaal = regels.reduce((som, regel) => som + regel.totaal, 0);
    const btw = subtotaal * (config.btwPercentage / 100);
    const totaal = subtotaal + btw;

    const nu = new Date();
    const jaar = nu.getFullYear();
    const factuurnummer = store.volgendFactuurnummer(jaar);

    const factuur = {
      factuurnummer,
      datum: nu.toISOString(),
      datumWeergave: formatDatumNL(nu),
      klant: {
        bedrijfsnaam: klantBedrijfsnaam.trim(),
        tav: klantTav.trim(),
        adres: klantAdres.trim(),
        postcode: klantPostcode.trim()
      },
      middenKolomLabel: (middenKolomLabel || '').trim(),
      regels,
      subtotaal,
      subtotaalWeergave: formatEuro(subtotaal),
      btw,
      btwWeergave: formatEuro(btw),
      totaal,
      totaalWeergave: formatEuro(totaal)
    };

    const html = await ejs.renderFile(path.join(__dirname, 'views', 'factuur.ejs'), {
      factuur,
      bedrijf: config
    });

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await page.close();

    store.bewaarFactuur({
      klantnaam: factuur.klant.bedrijfsnaam,
      factuurnummer,
      metadata: factuur,
      pdfBuffer
    });
    store.legFactuurnummerVast(jaar);

    const slug = slugify(factuur.klant.bedrijfsnaam);
    res.redirect(`/klanten/${slug}/facturen/${encodeURIComponent(factuurnummer)}/pdf`);
  } catch (err) {
    next(err);
  }
});

app.get('/klanten/:slug', (req, res) => {
  const facturen = store.facturenVanKlant(req.params.slug);
  if (facturen.length === 0) return res.status(404).send('Klant niet gevonden.');
  const naam = facturen[0].klant.bedrijfsnaam;
  res.render('overzicht', {
    klanten: [{ slug: req.params.slug, naam, facturen }],
    enkelKlant: naam
  });
});

app.get('/klanten/:slug/facturen/:nummer/pdf', (req, res) => {
  const bestandPad = store.pdfPad(req.params.slug, req.params.nummer);
  if (!fs.existsSync(bestandPad)) return res.status(404).send('Factuur niet gevonden.');
  res.type('application/pdf');
  res.sendFile(bestandPad);
});

app.listen(PORT, () => {
  console.log(`Facturen-app draait op http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
  }
  process.exit(0);
});
