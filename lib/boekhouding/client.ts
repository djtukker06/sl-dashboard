'use client';

// Browser-kant van de boekhouding: één fetch-hulpje voor /api/boekhouding/**.

export class BkApiFout extends Error {
  status: number;
  code?: string;
  veld?: string;
  constructor(status: number, message: string, code?: string, veld?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.veld = veld;
  }
}

export async function bkApi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store'
    });
  } catch {
    throw new BkApiFout(0, 'Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  if (res.status === 401) {
    const terug = window.location.pathname + window.location.search;
    window.location.href = `/login?next=${encodeURIComponent(terug)}`;
    throw new BkApiFout(401, 'Je bent uitgelogd.');
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // geen JSON
  }
  if (!res.ok) {
    throw new BkApiFout(
      res.status,
      typeof data.error === 'string' ? data.error : 'Er ging iets mis. Probeer het opnieuw.',
      typeof data.code === 'string' ? data.code : undefined,
      typeof data.veld === 'string' ? data.veld : undefined
    );
  }
  return data as T;
}
