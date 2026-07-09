const MAANDEN = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'
];

const DIACRITICS_REGEX = new RegExp('[̀-ͯ]', 'g');

function formatDatumNL(date) {
  const dag = date.getDate();
  const maand = MAANDEN[date.getMonth()];
  const jaar = date.getFullYear();
  return `${dag} ${maand} ${jaar}`;
}

function formatEuro(bedrag) {
  const vast = Math.round((bedrag + Number.EPSILON) * 100) / 100;
  return vast.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseBedrag(input) {
  if (typeof input !== 'string') return 0;
  const genormaliseerd = input.trim().replace(/\./g, '').replace(',', '.');
  const getal = parseFloat(genormaliseerd);
  return Number.isFinite(getal) ? getal : 0;
}

function slugify(tekst) {
  return tekst
    .toString()
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'klant';
}

module.exports = { formatDatumNL, formatEuro, parseBedrag, slugify, MAANDEN };
