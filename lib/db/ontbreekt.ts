// Herkent "deze tabel/functie bestaat (nog) niet"-fouten van Supabase/PostgREST, zodat
// een module vóór zijn migratie een nette melding toont in plaats van een 500.
//   PGRST205: tabel niet in de schema-cache   42P01: undefined_table (Postgres)
//   PGRST202: RPC-functie niet gevonden       42883: undefined_function (Postgres)
const CODES = new Set(['PGRST205', '42P01', 'PGRST202', '42883']);

export function tabelOntbreekt(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && CODES.has(code);
}

/** Storage: de bucket bestaat (nog) niet. */
export function bucketOntbreekt(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: unknown; error?: unknown; statusCode?: unknown };
  const tekst = `${String(e.message ?? '')} ${String(e.error ?? '')}`.toLowerCase();
  return tekst.includes('bucket not found');
}

// Een kolom of koppeling die (nog) niet bestaat: een nieuwere migratie (bv. 0022) is nog
// niet uitgevoerd terwijl de tabel zelf er al is.
//   42703: undefined_column (Postgres)   PGRST204: kolom niet in de schema-cache (schrijven)
//   PGRST200: koppeling (embed) tussen tabellen niet gevonden
const KOLOM_CODES = new Set(['42703', 'PGRST204', 'PGRST200']);

export function kolomOntbreekt(error: unknown): boolean {
  if (tabelOntbreekt(error)) return true;
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && KOLOM_CODES.has(code);
}
