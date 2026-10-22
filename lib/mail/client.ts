'use client';

import { DAGNAMEN_KORT, inAmsterdam, MAANDNAMEN_KORT, plusDagen, vandaag } from '@/lib/agenda/datum';
import type { Adres, Bericht, BerichtenPagina, MailMap, MailOverzicht, MailStatus } from './types';

// Browser-kant van de mail: fetch-hulpjes, korte cache in sessionStorage (badge, dashboard)
// en opmaak van datums/adressen. Mail-inhoud zelf blijft alleen in het geheugen van de tab.

export class MailApiFout extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  get nietGekoppeld() {
    return this.code === 'niet_gekoppeld';
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      cache: 'no-store'
    });
  } catch {
    throw new MailApiFout(0, 'Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  if (res.status === 401) {
    const terug = window.location.pathname + window.location.search;
    window.location.href = `/login?next=${encodeURIComponent(terug)}`;
    throw new MailApiFout(401, 'Je bent uitgelogd.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new MailApiFout(res.status, (data && data.error) || 'Er ging iets mis.', data?.code);
  return data as T;
}

const q = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export const mailApi = {
  status: () => api<MailStatus>('/api/mail/status'),
  overzicht: () => api<MailOverzicht>('/api/mail/overzicht'),
  mappen: () => api<{ mappen: MailMap[] }>('/api/mail/mappen'),
  berichten: (map: string, pagina: number, zoek = '', per = 40) =>
    api<BerichtenPagina>(`/api/mail/berichten?${q({ map, pagina, per, zoek })}`),
  bericht: (map: string, uid: number) => api<{ bericht: Bericht }>(`/api/mail/berichten/${uid}?${q({ map })}`),
  vlaggen: (map: string, uid: number, v: { gelezen?: boolean; gemarkeerd?: boolean }) =>
    api<{ ok: true }>(`/api/mail/berichten/${uid}/vlaggen?${q({ map })}`, { method: 'POST', body: JSON.stringify(v) }),
  verplaats: (map: string, uid: number, naar: { naar?: string; naarMap?: string }) =>
    api<{ naar: string; uid: number | null }>(`/api/mail/berichten/${uid}/verplaatsen?${q({ map })}`, {
      method: 'POST',
      body: JSON.stringify(naar)
    }),
  adressen: () => api<{ adressen: Adres[] }>('/api/mail/adressen'),
  verzend: (body: FormData | string) =>
    api<{ ok: true; waarschuwing?: string }>('/api/mail/verzenden', { method: 'POST', body })
};

export const bijlageUrl = (map: string, uid: number, deel: string) =>
  `/api/mail/berichten/${uid}/bijlagen/${encodeURIComponent(deel)}?${q({ map })}`;

// ---------- korte cache (60 s) voor badge en dashboard-widget ----------

const CACHE_MS = 60_000;

export function leesCache<T>(sleutel: string, maxLeeftijd = CACHE_MS): T | null {
  try {
    const ruw = sessionStorage.getItem(sleutel);
    if (!ruw) return null;
    const { t, v } = JSON.parse(ruw) as { t: number; v: T };
    return Date.now() - t < maxLeeftijd ? v : null;
  } catch {
    return null;
  }
}

export function schrijfCache(sleutel: string, v: unknown) {
  try {
    sessionStorage.setItem(sleutel, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* privémodus of vol: geen cache */
  }
}

/** Laat de rail-badge (public/shell/shell.js) het nieuwe aantal ongelezen weten. */
export function meldOngelezen(aantal: number) {
  schrijfCache('sl-mail-status', { geconfigureerd: true, ongelezen: aantal });
  window.dispatchEvent(new CustomEvent('sl-mail-ongelezen', { detail: aantal }));
}

// ---------- opmaak ----------

/** Lijstdatum: vandaag "14:32", gisteren "gisteren", deze week "di", dit jaar "12 okt", anders "12-10-24". */
export function lijstDatum(iso: string | null, nu = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const a = inAmsterdam(d);
  const v = vandaag(nu);
  if (a.dag === v) return a.tijd;
  if (a.dag === plusDagen(v, -1)) return 'gisteren';
  if (a.dag > plusDagen(v, -6) && a.dag < v) {
    const idx = (new Date(`${a.dag}T12:00:00Z`).getUTCDay() + 6) % 7;
    return DAGNAMEN_KORT[idx];
  }
  const [j, m, dag] = a.dag.split('-').map(Number);
  if (String(j) === v.slice(0, 4)) return `${dag} ${MAANDNAMEN_KORT[m - 1]}`;
  return `${String(dag).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(j).slice(2)}`;
}

/** Volledige datum voor de lezer: "do 22 okt 2026, 14:32". */
export function volleDatum(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const a = inAmsterdam(d);
  const [j, m, dag] = a.dag.split('-').map(Number);
  const idx = (new Date(`${a.dag}T12:00:00Z`).getUTCDay() + 6) % 7;
  return `${DAGNAMEN_KORT[idx]} ${dag} ${MAANDNAMEN_KORT[m - 1]} ${j}, ${a.tijd}`;
}

export function adresNaam(a: Adres | null | undefined): string {
  if (!a) return '(onbekend)';
  return a.naam || a.adres || '(onbekend)';
}

export function adresVol(a: Adres): string {
  if (!a.naam) return a.adres;
  const naam = /[",<>@;]/.test(a.naam) ? `"${a.naam.replace(/"/g, "'")}"` : a.naam;
  return `${naam} <${a.adres}>`;
}

export function grootteTekst(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',')} MB`;
}

export function initialen(a: Adres | null | undefined): string {
  const bron = (a?.naam || a?.adres || '?').replace(/["']/g, '').trim();
  const delen = bron.split(/[\s.@_-]+/).filter(Boolean);
  return ((delen[0]?.[0] ?? '?') + (delen.length > 1 ? delen[1][0] : '')).toUpperCase();
}
