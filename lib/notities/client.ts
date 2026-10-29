'use client';

import type { Notitie, NotitieFilter, NotitieSamenvatting, TiptapKnoop } from './kern';

// Browser-kant van de Scratchpad: fetch-hulpjes voor /api/notities. Gebruikt door de
// pagina /scratchpad en het blok op de klant- en projectpagina.

export class NotitieApiFout extends Error {
  status: number;
  code?: string;
  /** Bij een conflict (409): de versie die nu in de database staat. */
  huidig?: Notitie;
  constructor(status: number, message: string, code?: string, huidig?: Notitie) {
    super(message);
    this.status = status;
    this.code = code;
    this.huidig = huidig;
  }
  get conflict() {
    return this.status === 409 && this.code === 'conflict';
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
    throw new NotitieApiFout(0, 'Geen verbinding. Je wijzigingen worden opgeslagen zodra je weer online bent.');
  }
  if (res.status === 401) {
    const data = await res.json().catch(() => null);
    // 2FA- of wachtwoordstap: niet wegnavigeren (dan raak je je tekst kwijt), alleen melden.
    if (data?.code === 'niet_ingelogd') {
      throw new NotitieApiFout(401, 'Je bent uitgelogd. Kopieer je tekst en log opnieuw in.', 'niet_ingelogd');
    }
    throw new NotitieApiFout(401, data?.error || 'Je sessie is verlopen.', data?.code);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new NotitieApiFout(res.status, (data && data.error) || 'Er ging iets mis.', data?.code, data?.huidig);
  return data as T;
}

export interface NotitieWijziging {
  titel?: string;
  emoji?: string | null;
  inhoud?: TiptapKnoop;
  klantId?: string | null;
  projectId?: string | null;
  prive?: boolean;
  vastgepind?: boolean;
  verwijderd?: false;
  sinds?: string;
}

function qs(p: Record<string, string | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v);
  const t = u.toString();
  return t ? `?${t}` : '';
}

export const notitieApi = {
  lijst: (o: { q?: string; filter?: NotitieFilter; klant?: string; project?: string; limiet?: number } = {}) =>
    api<{ notities: NotitieSamenvatting[] }>(
      `/api/notities${qs({ q: o.q?.trim() || null, filter: o.filter && o.filter !== 'alles' ? o.filter : null, klant: o.klant, project: o.project, limiet: o.limiet ? String(o.limiet) : null })}`
    ),
  ophalen: (id: string) => api<{ notitie: Notitie }>(`/api/notities/${id}`),
  maak: (b: Omit<NotitieWijziging, 'sinds' | 'verwijderd' | 'vastgepind'> = {}) =>
    api<{ notitie: Notitie }>('/api/notities', { method: 'POST', body: JSON.stringify(b) }),
  wijzig: (id: string, b: NotitieWijziging, opties: { keepalive?: boolean } = {}) =>
    api<{ notitie: NotitieSamenvatting }>(`/api/notities/${id}`, { method: 'PATCH', body: JSON.stringify(b), keepalive: opties.keepalive }),
  verwijder: (id: string) => api<{ ok: true }>(`/api/notities/${id}`, { method: 'DELETE' }),
  herstel: (id: string) => api<{ notitie: NotitieSamenvatting }>(`/api/notities/${id}`, { method: 'PATCH', body: JSON.stringify({ verwijderd: false }) })
};

// ---------- concept in de browser (vangnet) ----------
// Elke wijziging staat tot hij is opgeslagen ook in localStorage (per gebruiker en notitie).
// Lukt opslaan niet (geen verbinding, tabblad gesloten), dan biedt de editor bij het
// openen aan om het concept terug te zetten. Uitloggen wist deze sleutels (shell.js).

export interface Concept {
  titel: string;
  inhoud: TiptapKnoop;
  /** bewerktOp van de versie waarop het concept is gebaseerd. */
  basis: string;
  tijd: number;
}

const conceptSleutel = (gebruiker: string, id: string) => `sl-notitie-concept:${gebruiker}:${id}`;

export function bewaarConcept(gebruiker: string, id: string, c: Concept): void {
  try {
    localStorage.setItem(conceptSleutel(gebruiker, id), JSON.stringify(c));
  } catch {
    /* geen opslag of vol: niet erg, opslaan naar de server gaat gewoon door */
  }
}

export function leesConcept(gebruiker: string, id: string): Concept | null {
  try {
    const ruw = localStorage.getItem(conceptSleutel(gebruiker, id));
    if (!ruw) return null;
    const c = JSON.parse(ruw) as Concept;
    return c && typeof c.titel === 'string' && c.inhoud && typeof c.inhoud === 'object' ? c : null;
  } catch {
    return null;
  }
}

export function wisConcept(gebruiker: string, id: string): void {
  try {
    localStorage.removeItem(conceptSleutel(gebruiker, id));
  } catch {
    /* geen opslag */
  }
}
