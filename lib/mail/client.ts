'use client';

import { DAGNAMEN_KORT, inAmsterdam, MAANDNAMEN_KORT, plusDagen, vandaag } from '@/lib/agenda/datum';
import type { Adres, Bericht, BerichtenPagina, InboxMetTeller, MailMap, MailOverzicht, MailStatus } from './types';
import { ALLE_INBOXEN } from './zichtbaarheid';

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

// Elke inbox-gebonden aanroep krijgt het id van de inbox mee (?mb=…); de server controleert
// dat jij die inbox mag zien. `mb` = ALLE_INBOXEN bij berichten = de INBOX van alle inboxen.
export const mailApi = {
  inboxen: () => api<{ inboxen: InboxMetTeller[]; ongelezen: number }>('/api/mail/inboxen'),
  status: () => api<MailStatus>('/api/mail/status'),
  overzicht: () => api<MailOverzicht>('/api/mail/overzicht'),
  mappen: (mb: string) => api<{ mappen: MailMap[] }>(`/api/mail/mappen?${q({ mb })}`),
  berichten: (mb: string, map: string, pagina: number, zoek = '', per = 40) =>
    api<BerichtenPagina>(
      mb === ALLE_INBOXEN
        ? `/api/mail/berichten?${q({ alle: 1, pagina, per, zoek })}`
        : `/api/mail/berichten?${q({ mb, map, pagina, per, zoek })}`
    ),
  bericht: (mb: string, map: string, uid: number) => api<{ bericht: Bericht }>(`/api/mail/berichten/${uid}?${q({ mb, map })}`),
  vlaggen: (mb: string, map: string, uid: number, v: { gelezen?: boolean; gemarkeerd?: boolean }) =>
    api<{ ok: true }>(`/api/mail/berichten/${uid}/vlaggen?${q({ mb, map })}`, { method: 'POST', body: JSON.stringify(v) }),
  verplaats: (mb: string, map: string, uid: number, naar: { naar?: string; naarMap?: string }) =>
    api<{ naar: string; uid: number | null }>(`/api/mail/berichten/${uid}/verplaatsen?${q({ mb, map })}`, {
      method: 'POST',
      body: JSON.stringify(naar)
    }),
  adressen: (mb: string) => api<{ adressen: Adres[] }>(`/api/mail/adressen?${q({ mb })}`),
  /** Verzenden vanaf inbox `van` (ook een met het team gedeelde inbox). */
  verzend: (van: string, body: FormData | string) =>
    api<{ ok: true; waarschuwing?: string }>(`/api/mail/verzenden?${q({ mb: van })}`, { method: 'POST', body })
};

export const bijlageUrl = (mb: string, map: string, uid: number, deel: string) =>
  `/api/mail/berichten/${uid}/bijlagen/${encodeURIComponent(deel)}?${q({ mb, map })}`;

/** Header waarmee de lezer laat weten dat hij via fetch downloadt (zie bijlagen-route). */
export const DOWNLOAD_HEADER = 'X-SL-Download';
export const SIGNED_HEADER = 'X-SL-Signed';

function klikDownload(href: string, naam?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (naam) a.download = naam;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Bijlage downloaden via fetch, zodat een fout (te groot, bericht verplaatst, opslag ontbreekt)
 * als Nederlandse melding getoond kan worden in plaats van "Download mislukt" in de browser.
 * Grote bijlagen komen terug als signed URL (Supabase Storage), die openen we direct.
 */
export async function downloadBijlage(url: string, naam: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { [DOWNLOAD_HEADER]: 'fetch' }, cache: 'no-store' });
  } catch {
    throw new MailApiFout(0, 'Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  if (res.status === 401) {
    const terug = window.location.pathname + window.location.search;
    window.location.href = `/login?next=${encodeURIComponent(terug)}`;
    throw new MailApiFout(401, 'Je bent uitgelogd.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new MailApiFout(res.status, (data && data.error) || 'Downloaden van de bijlage is mislukt.', data?.code);
  }
  if (res.headers.get(SIGNED_HEADER) === '1') {
    const data = (await res.json().catch(() => null)) as { url?: string } | null;
    if (!data?.url) throw new MailApiFout(500, 'Downloaden van de bijlage is mislukt.');
    klikDownload(data.url);
    return;
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  klikDownload(objectUrl, naam);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

// ---------- korte cache (60 s) voor badge en dashboard-widget ----------

const CACHE_MS = 60_000;

/**
 * Cache-sleutel per gebruiker (data-gebruiker op de rail): wie na een ander teamlid op
 * dezelfde computer inlogt, ziet nooit diens mail uit de cache. Uitloggen leegt alle
 * "sl-"-sleutels (public/shell/shell.js).
 */
function perGebruiker(sleutel: string): string {
  try {
    const id = document.querySelector('.sl-rail[data-gebruiker]')?.getAttribute('data-gebruiker');
    return id ? `${sleutel}:${id}` : sleutel;
  } catch {
    return sleutel;
  }
}

export function leesCache<T>(sleutel: string, maxLeeftijd = CACHE_MS): T | null {
  try {
    const ruw = sessionStorage.getItem(perGebruiker(sleutel));
    if (!ruw) return null;
    const { t, v } = JSON.parse(ruw) as { t: number; v: T };
    return Date.now() - t < maxLeeftijd ? v : null;
  } catch {
    return null;
  }
}

export function schrijfCache(sleutel: string, v: unknown) {
  try {
    sessionStorage.setItem(perGebruiker(sleutel), JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* privémodus of vol: geen cache */
  }
}

/** Laat de rail-badge (public/shell/shell.js) het nieuwe aantal ongelezen weten (som over alle inboxen). */
export function meldOngelezen(aantal: number) {
  schrijfCache('sl-mail-status', { geconfigureerd: true, ongelezen: aantal });
  window.dispatchEvent(new CustomEvent('sl-mail-ongelezen', { detail: aantal }));
}

/** Laatst gekozen afzender-inbox (per gebruiker, alleen in deze browser). */
export function leesLaatsteVan(): string | null {
  try {
    return localStorage.getItem(perGebruiker('sl-mail-van'));
  } catch {
    return null;
  }
}

export function bewaarLaatsteVan(id: string) {
  try {
    localStorage.setItem(perGebruiker('sl-mail-van'), id);
  } catch {
    /* geen opslag */
  }
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
