'use client';

import { useSyncExternalStore } from 'react';
import type { Afspraak, AfspraakInvoer, Taak, TaakInvoer, TakenFilter, Tellingen } from './types';

// Browser-kant van de agenda: fetch-hulpjes en kleine hooks. Gebruikt door /agenda en
// de planning-widgets op het dashboard.

export class ApiFout extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  get nietIngericht() {
    return this.code === 'tabel_ontbreekt';
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      cache: 'no-store'
    });
  } catch {
    throw new ApiFout(0, 'Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  if (res.status === 401) {
    // Sessie verlopen: inloggen en daarna terug naar deze pagina.
    const terug = window.location.pathname + window.location.search;
    window.location.href = `/login?next=${encodeURIComponent(terug)}`;
    throw new ApiFout(401, 'Je bent uitgelogd.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiFout(res.status, (data && data.error) || 'Er ging iets mis.', data?.code);
  }
  return data as T;
}

const body = (b: unknown) => JSON.stringify(b);

export const agendaApi = {
  bereik: (van: string, tot: string) =>
    api<{ tasks: Taak[]; events: Afspraak[] }>(`/api/agenda?van=${van}&tot=${tot}`),
  taken: (filter: TakenFilter) =>
    api<{ tasks: Taak[]; tellingen: Tellingen; vandaag: string }>(`/api/taken?filter=${filter}`),
  taak: (id: string) => api<{ task: Taak }>(`/api/taken/${id}`),
  maakTaak: (b: TaakInvoer) => api<{ task: Taak }>('/api/taken', { method: 'POST', body: body(b) }),
  wijzigTaak: (id: string, b: TaakInvoer) => api<{ task: Taak }>(`/api/taken/${id}`, { method: 'PATCH', body: body(b) }),
  verwijderTaak: (id: string) => api<{ ok: true }>(`/api/taken/${id}`, { method: 'DELETE' }),
  afspraak: (id: string) => api<{ event: Afspraak }>(`/api/afspraken/${id}`),
  maakAfspraak: (b: AfspraakInvoer) => api<{ event: Afspraak }>('/api/afspraken', { method: 'POST', body: body(b) }),
  wijzigAfspraak: (id: string, b: AfspraakInvoer) =>
    api<{ event: Afspraak }>(`/api/afspraken/${id}`, { method: 'PATCH', body: body(b) }),
  verwijderAfspraak: (id: string) => api<{ ok: true }>(`/api/afspraken/${id}`, { method: 'DELETE' })
};

export interface KlantSuggestie {
  id: string;
  company_name: string;
  contact_name: string | null;
}

export async function zoekKlanten(q: string): Promise<KlantSuggestie[]> {
  if (!q.trim()) return [];
  try {
    const res = await fetch(`/api/clients/search?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Beste klant bij een getypte naam: exacte match, anders één die ermee begint, anders de enige. */
export async function vindKlant(naam: string): Promise<KlantSuggestie | null> {
  const lijst = await zoekKlanten(naam);
  const n = naam.toLowerCase();
  return (
    lijst.find((k) => k.company_name.toLowerCase() === n) ??
    lijst.find((k) => k.company_name.toLowerCase().startsWith(n)) ??
    (lijst.length === 1 ? lijst[0] : null) ??
    lijst[0] ??
    null
  );
}

// ---------- hooks ----------

/** Huidige minuut (ms), elke 30 s ververst; op de server null (geen hydration-verschil). */
const klokLuisteraars = new Set<() => void>();
let klokTimer: ReturnType<typeof setInterval> | null = null;
function klokAbonneer(cb: () => void) {
  klokLuisteraars.add(cb);
  if (!klokTimer) klokTimer = setInterval(() => klokLuisteraars.forEach((f) => f()), 30_000);
  return () => {
    klokLuisteraars.delete(cb);
    if (!klokLuisteraars.size && klokTimer) {
      clearInterval(klokTimer);
      klokTimer = null;
    }
  };
}
const klokNu = () => Math.floor(Date.now() / 60_000) * 60_000;
export function useNu(): number | null {
  return useSyncExternalStore(klokAbonneer, klokNu, () => null);
}

/** true op smalle schermen (≤ 720px, gelijk aan de shell). Op de server false. */
export function useSmal(query = '(max-width: 720px)'): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Typt de gebruiker ergens in (dan geen sneltoetsen)? */
export function typtIn(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
