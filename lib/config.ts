export const bedrijf = {
  bedrijfsnaam: 'Studio Levant',
  eigenaren: 'Daniël Tukker & Bram Huiskes',
  adresregel: 'Brink 21, Almelo',
  postcode: '7603 ED',
  iban: 'NL92 RBRB 8848 5940 69',
  kvkNummer: '95422145',
  btwNummer: 'NL867124374B01',
  email: 'info@studio-levant.nl',
  algemeneVoorwaardenUrl: 'www.studio-levant.nl/algemene-voorwaarden',
  btwPercentage: 21
} as const;

// Er waren al 7 facturen in 2026 vóórdat dit systeem in gebruik werd genomen.
// Alleen in dat jaar meetellen bij de "facturen dit jaar"-statistiek.
export const BASELINE_INVOICES = {
  jaar: 2026,
  aantal: 7
} as const;
