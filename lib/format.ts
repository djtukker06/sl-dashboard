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
  const genormaliseerd = input.trim().replace(/\./g, '').replace(',', '.');
  const getal = parseFloat(genormaliseerd);
  return Number.isFinite(getal) ? getal : 0;
}
