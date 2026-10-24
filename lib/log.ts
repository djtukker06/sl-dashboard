// Fouten loggen zonder gevoelige data. Supabase-, Google- en Anthropic-fouten kunnen
// query-details, e-mailadressen of URL's met tokens bevatten; daarom alleen naam, code,
// status en een ingekorte, gemaskeerde melding. Gebruik: logFout('[social] opslaan', e).

const MASKERS: [RegExp, string][] = [
  [/([?&](?:token|sig|signature|apikey|api_key|key|code|access_token|refresh_token|X-Amz-[A-Za-z-]+)=)[^&\s"']+/gi, '$1***'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[jwt]'],
  [/\bsk-[A-Za-z0-9_-]{10,}/g, '[sleutel]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-mail]']
];

export function maskeer(tekst: string): string {
  let s = tekst;
  for (const [re, vervang] of MASKERS) s = s.replace(re, vervang);
  return s;
}

/** Korte, veilige samenvatting van een fout (voor logs, nooit voor de gebruiker). */
export function foutSamenvatting(e: unknown): string {
  if (e === null || e === undefined) return 'onbekend';
  if (typeof e === 'string') return maskeer(e).slice(0, 300);
  if (typeof e !== 'object') return String(e).slice(0, 100);
  const o = e as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
  const delen: string[] = [];
  if (typeof o.name === 'string' && o.name !== 'Error') delen.push(o.name);
  if (typeof o.code === 'string' || typeof o.code === 'number') delen.push(`code=${String(o.code).slice(0, 40)}`);
  const status = o.status ?? o.statusCode;
  if (typeof status === 'number' || typeof status === 'string') delen.push(`status=${String(status).slice(0, 10)}`);
  if (typeof o.message === 'string' && o.message) delen.push(maskeer(o.message).slice(0, 300));
  return delen.join(' ') || 'onbekende fout';
}

export function logFout(label: string, e?: unknown): void {
  console.error(label, e === undefined ? '' : foutSamenvatting(e));
}

export function logWaarschuwing(label: string, e?: unknown): void {
  console.warn(label, e === undefined ? '' : foutSamenvatting(e));
}
