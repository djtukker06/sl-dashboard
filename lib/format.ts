const MAANDEN = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'
];

export function formatDatumNL(date: Date): string {
  const dag = date.getDate();
  const maand = MAANDEN[date.getMonth()];
  const jaar = date.getFullYear();
  return `${dag} ${maand} ${jaar}`;
}

export function formatEuro(bedrag: number): string {
  const vast = Math.round((bedrag + Number.EPSILON) * 100) / 100;
  return vast.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseBedrag(input: string): number {
  if (typeof input !== 'string') return 0;
  const tekst = input.trim();
  // Precies één punt met 1-2 cijfers erachter en geen komma: dat is een decimale punt
  // ('12.50' → 12,5). Anders is de punt een duizendtalscheiding ('1.250' → 1250).
  if (/^-?\d*\.\d{1,2}$/.test(tekst)) {
    const getal = parseFloat(tekst);
    return Number.isFinite(getal) ? getal : 0;
  }
  const genormaliseerd = tekst.replace(/\./g, '').replace(',', '.');
  const getal = parseFloat(genormaliseerd);
  return Number.isFinite(getal) ? getal : 0;
}
