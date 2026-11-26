// Kleine fetch-helper voor de social-schermen. Fouten van de API komen als { error, fout,
// fouten? } terug (lib/social/posts.ts); hier worden ze een ApiFout met een Nederlandse melding.

export class ApiFout extends Error {
  status: number;
  code?: string;
  fouten: string[];
  constructor(status: number, message: string, code?: string, fouten: string[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.fouten = fouten;
  }
}

export async function api<T>(url: string, opties: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opties.method ?? 'GET',
      headers: opties.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opties.body !== undefined ? JSON.stringify(opties.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store'
    });
  } catch {
    throw new ApiFout(0, 'Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const melding = (typeof data.fout === 'string' && data.fout) || (typeof data.error === 'string' && data.error) || 'Er ging iets mis. Probeer het opnieuw.';
    const fouten = Array.isArray(data.fouten) ? data.fouten.filter((x): x is string => typeof x === 'string') : [];
    throw new ApiFout(res.status, melding, typeof data.code === 'string' ? data.code : undefined, fouten);
  }
  return data as T;
}

/** Melding van een onbekende fout (voor een toast). */
export function foutTekst(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Er ging iets mis. Probeer het opnieuw.';
}
