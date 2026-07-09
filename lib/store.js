const fs = require('fs');
const path = require('path');
const config = require('../config');
const { slugify } = require('./helpers');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CLIENTS_DIR = path.join(DATA_DIR, 'clients');
const COUNTERS_FILE = path.join(DATA_DIR, 'counters.json');

function zorgVoorDataMap() {
  fs.mkdirSync(CLIENTS_DIR, { recursive: true });
  if (!fs.existsSync(COUNTERS_FILE)) {
    const initieel = {};
    initieel[String(config.factuurnummerStart.jaar)] = config.factuurnummerStart.laatsteVolgnummer;
    fs.writeFileSync(COUNTERS_FILE, JSON.stringify(initieel, null, 2));
  }
}

function leesCounters() {
  zorgVoorDataMap();
  return JSON.parse(fs.readFileSync(COUNTERS_FILE, 'utf8'));
}

function schrijfCounters(counters) {
  fs.writeFileSync(COUNTERS_FILE, JSON.stringify(counters, null, 2));
}

// Bepaalt het eerstvolgende factuurnummer voor het huidige jaar, zonder deze te "verbruiken".
function volgendFactuurnummer(jaar) {
  const counters = leesCounters();
  const huidig = counters[String(jaar)] || 0;
  const volgnummer = huidig + 1;
  const jaarKort = String(jaar).slice(-2);
  return `${jaarKort}-${String(volgnummer).padStart(3, '0')}`;
}

function legFactuurnummerVast(jaar) {
  const counters = leesCounters();
  const huidig = counters[String(jaar)] || 0;
  counters[String(jaar)] = huidig + 1;
  schrijfCounters(counters);
}

function klantMap(klantnaam) {
  const map = path.join(CLIENTS_DIR, slugify(klantnaam));
  fs.mkdirSync(map, { recursive: true });
  return map;
}

function bewaarFactuur({ klantnaam, factuurnummer, metadata, pdfBuffer }) {
  const map = klantMap(klantnaam);
  const bestandBasis = factuurnummer.replace('/', '-');
  fs.writeFileSync(path.join(map, `${bestandBasis}.pdf`), pdfBuffer);
  fs.writeFileSync(path.join(map, `${bestandBasis}.json`), JSON.stringify(metadata, null, 2));
}

function alleKlanten() {
  zorgVoorDataMap();
  return fs.readdirSync(CLIENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function facturenVanKlant(klantSlug) {
  const map = path.join(CLIENTS_DIR, klantSlug);
  if (!fs.existsSync(map)) return [];
  return fs.readdirSync(map)
    .filter((bestand) => bestand.endsWith('.json'))
    .map((bestand) => JSON.parse(fs.readFileSync(path.join(map, bestand), 'utf8')))
    .sort((a, b) => b.factuurnummer.localeCompare(a.factuurnummer));
}

function alleFacturen() {
  return alleKlanten().flatMap((slug) => facturenVanKlant(slug));
}

function pdfPad(klantSlug, factuurnummer) {
  const bestandBasis = factuurnummer.replace('/', '-');
  return path.join(CLIENTS_DIR, klantSlug, `${bestandBasis}.pdf`);
}

// Verwijdert een factuur uit het archief. Het factuurnummer zelf wordt nooit hergebruikt:
// de teller in counters.json telt gewoon door, ook na een verwijdering.
function verwijderFactuur(klantSlug, factuurnummer) {
  const bestandBasis = factuurnummer.replace('/', '-');
  const map = path.join(CLIENTS_DIR, klantSlug);
  const pdfBestand = path.join(map, `${bestandBasis}.pdf`);
  const jsonBestand = path.join(map, `${bestandBasis}.json`);
  if (fs.existsSync(pdfBestand)) fs.unlinkSync(pdfBestand);
  if (fs.existsSync(jsonBestand)) fs.unlinkSync(jsonBestand);
}

module.exports = {
  volgendFactuurnummer,
  legFactuurnummerVast,
  bewaarFactuur,
  alleKlanten,
  facturenVanKlant,
  alleFacturen,
  pdfPad,
  klantMap,
  verwijderFactuur
};
