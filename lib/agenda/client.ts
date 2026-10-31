'use client';

import { useSyncExternalStore } from 'react';
import type {
  Afspraak,
  AfspraakInvoer,
  Project,
  ProjectInvoer,
  Subtaak,
  SubtaakInvoer,
  Taak,
  TaakDetail,
  TaakInvoer,
  TakenFilter,
  Tellingen
} from './types';

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
  /** Geen recht om dit te wijzigen (niet de maker en niet toegewezen). */
  get geenRecht() {
    return this.status === 403;
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

function qs(p: Record<string, string | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v);
  const t = u.toString();
  return t ? `?${t}` : '';
}

export const agendaApi = {
  /** Alles voor de planning op het dashboard in één verzoek (zie app/api/dashboard). */
  dashboard: () =>
    api<{
      planning: {
        taken: Taak[];
        afspraken: Afspraak[];
        teLaat: Taak[];
        zonderDeadline: Taak[];
        later: Taak[];
        uitgezet: number;
      };
      vandaag: string;
    }>('/api/dashboard'),
  /** herhaling: of migratie 0034 (herhalende afspraken) er is. */
  bereik: (van: string, tot: string) =>
    api<{ tasks: Taak[]; events: Afspraak[]; herhaling?: boolean }>(`/api/agenda${qs({ van, tot })}`),
  taken: (filter: TakenFilter, opties: { project?: string | null } = {}) =>
    api<{ tasks: Taak[]; tellingen: Tellingen; vandaag: string }>(
      `/api/taken${qs({ filter, project: opties.project })}`
    ),
  taak: (id: string) => api<{ task: TaakDetail }>(`/api/taken/${id}`),
  maakTaak: (b: TaakInvoer) => api<{ task: Taak }>('/api/taken', { method: 'POST', body: body(b) }),
  wijzigTaak: (id: string, b: TaakInvoer) => api<{ task: Taak }>(`/api/taken/${id}`, { method: 'PATCH', body: body(b) }),
  /** Zoals wijzigTaak, maar met "voor wie": task is null als je de taak aan een ander gaf en hem niet meer mag zien. */
  bewaarTaak: (id: string, b: TaakInvoer) =>
    api<{ task: Taak | null; overgedragen?: boolean }>(`/api/taken/${id}`, { method: 'PATCH', body: body(b) }),
  verwijderTaak: (id: string) => api<{ ok: true }>(`/api/taken/${id}`, { method: 'DELETE' }),
  maakSubtaak: (taakId: string, titel: string) =>
    api<{ subtaak: Subtaak }>(`/api/taken/${taakId}/subtaken`, { method: 'POST', body: body({ titel }) }),
  wijzigSubtaak: (taakId: string, id: string, b: SubtaakInvoer) =>
    api<{ subtaak: Subtaak }>(`/api/taken/${taakId}/subtaken/${id}`, { method: 'PATCH', body: body(b) }),
  verwijderSubtaak: (taakId: string, id: string) =>
    api<{ ok: true }>(`/api/taken/${taakId}/subtaken/${id}`, { method: 'DELETE' }),
  afspraak: (id: string) => api<{ event: Afspraak }>(`/api/afspraken/${id}`),
  maakAfspraak: (b: AfspraakInvoer) => api<{ event: Afspraak }>('/api/afspraken', { method: 'POST', body: body(b) }),
  wijzigAfspraak: (id: string, b: AfspraakInvoer) =>
    api<{ event: Afspraak }>(`/api/afspraken/${id}`, { method: 'PATCH', body: body(b) }),
  /** Bij een voorkomen van een reeks: 'deze' slaat alleen dit voorkomen over, anders de hele reeks. */
  verwijderAfspraak: (id: string, toepassen?: 'deze' | 'reeks') =>
    api<{ ok: true }>(`/api/afspraken/${id}${qs({ toepassen })}`, { method: 'DELETE' }),
  project: (id: string) => api<{ project: Project }>(`/api/projecten/${id}`),
  projecten: (status: 'lopend' | 'afgerond' | 'alle' = 'lopend') =>
    api<{ projecten: Project[] }>(`/api/projecten${qs({ status })}`),
  maakProject: (b: ProjectInvoer) => api<{ project: Project; klantWeerActief?: boolean }>('/api/projecten', { method: 'POST', body: body(b) }),
  wijzigProject: (id: string, b: ProjectInvoer & { klantNaam?: string }) =>
    api<{ project: Project; klantAangemaakt?: { id: string; naam: string } | null }>(`/api/projecten/${id}`, { method: 'PATCH', body: body(b) })
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
