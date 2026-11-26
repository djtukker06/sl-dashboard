// Uploaden in de browser (social): eigenschappen van een bestand uitlezen (afmetingen, duur)
// voor de controle vóór de upload, afbeeldingen zo nodig omzetten naar JPEG, en het bestand
// met voortgang rechtstreeks naar Storage sturen (signed upload-URL, niet via onze server).

import type { MediaMeta } from '@/lib/social/types';

/** Breedte, hoogte en (bij video) duur van een bestand, via een <img> of <video>. */
export async function leesMeta(bestand: Blob, mime: string): Promise<MediaMeta> {
  const isVideo = mime.startsWith('video/');
  const url = URL.createObjectURL(bestand);
  try {
    if (isVideo) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const ok = await new Promise<boolean>((klaar) => {
        v.onloadedmetadata = () => klaar(true);
        v.onerror = () => klaar(false);
        v.src = url;
        setTimeout(() => klaar(false), 15_000);
      });
      return {
        type: 'video',
        mime,
        breedte: ok && v.videoWidth ? v.videoWidth : null,
        hoogte: ok && v.videoHeight ? v.videoHeight : null,
        duur_sec: ok && Number.isFinite(v.duration) ? Math.round(v.duration * 100) / 100 : null,
        grootte: bestand.size
      };
    }
    const img = new Image();
    const ok = await new Promise<boolean>((klaar) => {
      img.onload = () => klaar(true);
      img.onerror = () => klaar(false);
      img.src = url;
    });
    return { type: 'afbeelding', mime, breedte: ok ? img.naturalWidth : null, hoogte: ok ? img.naturalHeight : null, duur_sec: null, grootte: bestand.size };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MAX_BREEDTE_JPEG = 1440;
const MAX_JPEG_BYTES = 8 * 1024 * 1024;

/**
 * Instagram neemt alleen JPEG aan (max. 8 MB). Een PNG/WebP, of een JPEG die te groot of
 * breder dan 1440 px is, zetten we hier om naar JPEG (max. 1440 px breed, witte achtergrond
 * voor transparantie). Al goed → het bestand zelf.
 */
export async function alsJpeg(bestand: File, meta: MediaMeta): Promise<{ blob: Blob; naam: string; mime: string; meta: MediaMeta }> {
  const nodig = meta.type === 'afbeelding' && (meta.mime !== 'image/jpeg' || bestand.size > MAX_JPEG_BYTES || (meta.breedte ?? 0) > MAX_BREEDTE_JPEG);
  if (!nodig || !meta.breedte || !meta.hoogte) return { blob: bestand, naam: bestand.name, mime: meta.mime, meta };
  const schaal = Math.min(1, MAX_BREEDTE_JPEG / meta.breedte);
  const b = Math.round(meta.breedte * schaal);
  const h = Math.round(meta.hoogte * schaal);
  const bitmap = await createImageBitmap(bestand);
  const canvas = document.createElement('canvas');
  canvas.width = b;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: bestand, naam: bestand.name, mime: meta.mime, meta };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, b, h);
  ctx.drawImage(bitmap, 0, 0, b, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((klaar) => canvas.toBlob(klaar, 'image/jpeg', 0.9));
  if (!blob) return { blob: bestand, naam: bestand.name, mime: meta.mime, meta };
  const naam = `${bestand.name.replace(/\.[^.]+$/, '') || 'foto'}.jpg`;
  return { blob, naam, mime: 'image/jpeg', meta: { ...meta, mime: 'image/jpeg', breedte: b, hoogte: h, grootte: blob.size } };
}

/** PUT naar de signed upload-URL, met voortgang (0–1). */
export function putMetVoortgang(url: string, blob: Blob, mime: string, opVoortgang: (f: number) => void): Promise<void> {
  return new Promise((klaar, mis) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opVoortgang(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? klaar() : mis(new Error(xhr.status === 413 ? 'Dit bestand is te groot.' : 'Uploaden is niet gelukt.')));
    xhr.onerror = () => mis(new Error('Uploaden is niet gelukt. Controleer je verbinding.'));
    xhr.send(blob);
  });
}
