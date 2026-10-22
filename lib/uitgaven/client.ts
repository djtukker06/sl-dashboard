'use client';

import { isBestandsType, MAX_BESTAND_BYTES, type BestandsType, type Leverancier, type Uitgave, type UitgaveInvoer } from './model';
import type { BtwOverzicht } from './btw';

// Browser-kant van uitgaven: fetch-hulpjes, verkleinen van foto's en de upload-flow
// (signed upload-URL → Storage → aanmelden → uitlezen). Gebruikt door
// /boekhouding/bonnetjes, de "Bonnetje uploaden"-knop op het dashboard en "Opslaan als uitgave" in mail.

export class UitgavenApiFout extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  get nietIngericht() {
    return this.code === 'tabel_ontbreekt' || this.code === 'opslag_ontbreekt';
  }
}

function naarLogin() {
  const terug = window.location.pathname + window.location.search;
  window.location.href = `/login?next=${encodeURIComponent(terug)}`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      cache: 'no-store'
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new UitgavenApiFout(0, 'Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  if (res.status === 401) {
    naarLogin();
    throw new UitgavenApiFout(401, 'Je bent uitgelogd.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new UitgavenApiFout(res.status, (data && data.error) || 'Er ging iets mis.', data?.code);
  return data as T;
}

const body = (b: unknown) => JSON.stringify(b);
const qs = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');

export interface ZoekResultaat {
  uitgaven: Uitgave[];
  /** Signed URL (10 min) van de eerste foto per uitgave-id. */
  voorbeelden: Record<string, string>;
  /** Aantal treffers in totaal (de lijst toont er max. 200). */
  totaal: number;
  vandaag: string;
}

export const uitgavenApi = {
  lijst: (van: string, tot: string) => api<{ uitgaven: Uitgave[]; vandaag: string }>(`/api/uitgaven?${qs({ van, tot })}`),
  zoek: (params: { q?: string; jaar?: string; maand?: string; soort?: string; door?: string }, signal?: AbortSignal) =>
    api<ZoekResultaat>(`/api/uitgaven?${qs(params)}`, { signal }),
  uitgave: (id: string) => api<{ uitgave: Uitgave }>(`/api/uitgaven/${id}`),
  maak: (b: UitgaveInvoer) => api<{ uitgave: Uitgave }>('/api/uitgaven', { method: 'POST', body: body(b) }),
  wijzig: (id: string, b: UitgaveInvoer) => api<{ uitgave: Uitgave }>(`/api/uitgaven/${id}`, { method: 'PATCH', body: body(b) }),
  verwijder: (id: string) => api<{ ok: true }>(`/api/uitgaven/${id}`, { method: 'DELETE' }),
  uitlezen: (id: string) => api<{ uitgave: Uitgave }>(`/api/uitgaven/${id}/uitlezen`, { method: 'POST' }),
  verwijderBestand: (id: string, bestand: string) =>
    api<{ uitgave: Uitgave }>(`/api/uitgaven/${id}/bestanden/${bestand}`, { method: 'DELETE' }),
  leveranciers: () => api<{ leveranciers: Leverancier[] }>('/api/uitgaven/leveranciers'),
  btw: (jaar: number) => api<{ overzicht: BtwOverzicht }>(`/api/uitgaven/btw?jaar=${jaar}`),
  zipExport: (params: Record<string, string | undefined>) =>
    api<{ delen: { naam: string; url: string; aantal: number }[] }>(`/api/uitgaven/export?${qs({ ...params, formaat: 'zip' })}`),
  uitMail: (b: { map: string; uid: number; deel: string; onderwerp?: string }) =>
    api<{ uitgave: Uitgave }>('/api/uitgaven/uit-mail', { method: 'POST', body: body(b) })
};

export const csvExportUrl = (params: Record<string, string | undefined>) => `/api/uitgaven/export?${qs({ ...params, formaat: 'csv' })}`;
export const bestandUrl = (uitgaveId: string, bestandId: string, download = false) =>
  `/api/uitgaven/${uitgaveId}/bestanden/${bestandId}${download ? '?download=1' : ''}`;

// ---------- foto's verkleinen ----------

const MAX_ZIJDE = 2400;

/** Type van een gekozen bestand (sommige systemen geven HEIC/PDF zonder type door). */
export function typeVan(f: File): BestandsType | null {
  if (isBestandsType(f.type)) return f.type;
  const ext = f.name.toLowerCase().split('.').pop();
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}

/**
 * Foto's worden in de browser verkleind tot max. 2400 px en als JPEG opgeslagen (sneller
 * uploaden, en ruim binnen de 5 MB die Claude per afbeelding accepteert). Lukt decoderen
 * niet (bv. HEIC in Chrome), dan gaat het origineel. PDF's blijven ongewijzigd.
 */
export async function bereidVoor(f: File): Promise<{ blob: Blob; type: BestandsType; naam: string }> {
  const type = typeVan(f);
  if (!type) throw new Error('Alleen foto’s (jpg, png, webp, heic) en PDF’s zijn toegestaan.');
  if (type === 'application/pdf') return { blob: f, type, naam: f.name };
  try {
    const beeld = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const schaal = Math.min(1, MAX_ZIJDE / Math.max(beeld.width, beeld.height));
    const w = Math.max(1, Math.round(beeld.width * schaal));
    const h = Math.max(1, Math.round(beeld.height * schaal));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('geen canvas');
    ctx.fillStyle = '#fff'; // transparante screenshots niet zwart maken
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(beeld, 0, 0, w, h);
    beeld.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.86));
    if (!blob) throw new Error('geen blob');
    // Al klein genoeg en kleiner dan het resultaat? Dan het origineel houden.
    if (schaal === 1 && type === 'image/jpeg' && f.size <= blob.size) return { blob: f, type, naam: f.name };
    const naam = f.name.replace(/\.[^.]+$/, '') + '.jpg';
    return { blob, type: 'image/jpeg', naam: naam === '.jpg' ? 'bonnetje.jpg' : naam };
  } catch {
    return { blob: f, type, naam: f.name };
  }
}

export type UploadFase = 'voorbereiden' | 'uploaden' | 'uitlezen' | 'klaar' | 'fout';

/**
 * Volledige upload van één bestand: verkleinen → signed URL → PUT naar Storage →
 * aanmelden (maakt het concept) → uitlezen. Met uitgaveId wordt het bestand aan een
 * bestaande uitgave toegevoegd (dan zonder automatisch uitlezen, tenzij `uitlezen`).
 */
export async function uploadBonnetje(
  f: File,
  opties: {
    uitgaveId?: string;
    uitlezen?: boolean;
    onFase?: (fase: UploadFase) => void;
    /** Direct na het aanmelden (vóór het uitlezen): de uitgave staat er al. */
    onAangemeld?: (u: Uitgave) => void;
  } = {}
): Promise<Uitgave> {
  opties.onFase?.('voorbereiden');
  const { blob, type, naam } = await bereidVoor(f);
  if (blob.size > MAX_BESTAND_BYTES) throw new Error('Dit bestand is te groot (max. 25 MB).');
  opties.onFase?.('uploaden');
  const doel = await api<{ uitgaveId: string; pad: string; signedUrl: string }>('/api/uitgaven/upload-url', {
    method: 'POST',
    body: body({ naam, type, grootte: blob.size, uitgaveId: opties.uitgaveId })
  });
  let put: Response;
  try {
    put = await fetch(doel.signedUrl, { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
  } catch {
    throw new Error('Uploaden mislukt: geen verbinding.');
  }
  if (!put.ok) throw new Error(put.status === 413 ? 'Dit bestand is te groot (max. 25 MB).' : `Uploaden mislukt (${put.status}).`);
  const { uitgave } = await api<{ uitgave: Uitgave }>(`/api/uitgaven/${doel.uitgaveId}/bestanden`, {
    method: 'POST',
    body: body({ pad: doel.pad, naam })
  });
  opties.onAangemeld?.(uitgave);
  if (opties.uitlezen === false || (opties.uitgaveId && !opties.uitlezen)) {
    opties.onFase?.('klaar');
    return uitgave;
  }
  opties.onFase?.('uitlezen');
  try {
    const r = await uitgavenApi.uitlezen(uitgave.id);
    opties.onFase?.('klaar');
    return r.uitgave;
  } catch {
    // Uitlezen is een extraatje: het concept staat er, de gebruiker vult zelf in.
    opties.onFase?.('klaar');
    return uitgave;
  }
}

export { euro } from './format';

/** Signed URL's openen/downloaden zonder de pagina te verlaten. */
export function downloadLink(href: string, naam?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (naam) a.download = naam;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
