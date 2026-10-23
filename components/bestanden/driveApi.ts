'use client';

import type { DriveItem } from '@/lib/drive/types';

// Fetch-hulpjes voor /api/drive/** in de browser, met de foutcode van de server erbij
// (bv. 'opnieuw_koppelen'), zodat de schermen de juiste melding kunnen tonen.

export class DriveApiFout extends Error {
  code?: string;
  status: number;
  constructor(bericht: string, status: number, code?: string) {
    super(bericht);
    this.status = status;
    this.code = code;
  }
}

export async function driveApi<T>(url: string, methode: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: methode,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store'
    });
  } catch {
    throw new DriveApiFout('Geen verbinding. Controleer je internet en probeer het opnieuw.', 0);
  }
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new DriveApiFout('Je bent uitgelogd.', 401);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new DriveApiFout((data && data.error) || 'Er ging iets mis. Probeer het opnieuw.', res.status, data?.code);
  return data as T;
}

export type UploadDoel = { map: string } | { klant: string } | { project: string };

/**
 * Eén bestand uploaden: (1) de server maakt een resumable upload-sessie bij Google, (2) de
 * browser zet het bestand daar rechtstreeks neer (met voortgang), (3) de server legt vast
 * wie het uploadde.
 */
export async function uploadBestand(bestand: File, doel: UploadDoel, onVoortgang: (fractie: number) => void): Promise<DriveItem> {
  const { uploadUrl } = await driveApi<{ uploadUrl: string; mapId: string }>('/api/drive/upload', 'POST', {
    ...doel,
    naam: bestand.name || 'Naamloos',
    type: bestand.type || 'application/octet-stream',
    grootte: bestand.size
  });

  const id = await new Promise<string>((klaar, mislukt) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', bestand.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onVoortgang(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const r = JSON.parse(xhr.responseText) as { id?: string };
          if (r.id) return klaar(r.id);
        } catch {
          /* hieronder */
        }
      }
      mislukt(new DriveApiFout(xhr.status === 403 ? 'Google weigerde de upload (opslag vol?).' : 'Uploaden naar Google Drive is mislukt.', xhr.status));
    };
    xhr.onerror = () => mislukt(new DriveApiFout('Uploaden naar Google Drive is mislukt (verbinding).', 0));
    xhr.send(bestand);
  });
  onVoortgang(1);

  const k = 'klant' in doel ? { klant: doel.klant } : 'project' in doel ? { project: doel.project } : {};
  const { item } = await driveApi<{ item: DriveItem }>('/api/drive/upload/klaar', 'POST', { id, ...k });
  return item;
}

export const inhoudUrl = (id: string, download = false) => `/api/drive/bestanden/${encodeURIComponent(id)}/inhoud${download ? '?download=1' : ''}`;
