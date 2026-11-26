import 'server-only';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bucketOntbreekt } from '@/lib/db/ontbreekt';
import { logFout } from '@/lib/log';
import { maakMediaPad } from './kern';
import { MEDIA_BUCKET, MIGRATIE_MELDING } from './types';

// Supabase Storage voor social media (bucket 'social-media', privé, migratie 0041). Alleen
// aanroepen met een service-role-cliënt ná de teamlidcontrole (of vanuit de cron): de bucket
// heeft bewust geen policies, dus de browser kan er zelf niets lezen of schrijven.
//
// Uploaden gaat in twee stappen, rechtstreeks van de browser naar Storage (Vercel neemt
// maar ~4,5 MB per request aan, video's passen daar niet door):
//   1. POST /api/social/media/upload-url  → de server kiest het pad en geeft een signed upload-URL;
//   2. de browser PUT het bestand naar die URL en meldt het aan via POST /api/social/posts/[id]/media.
// Tonen in de browser: kortlevende signed URL's (`bekijkUrls`). Meta haalt een bestand zelf
// op bij het aanmaken van de container: `publiekeMediaUrl` (ook een signed URL, iets langer geldig).

/** Fout van de opslag, met een Nederlandse melding voor de gebruiker. */
export class MediaFout extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function opslagFout(error: unknown, melding: string): MediaFout {
  if (bucketOntbreekt(error)) return new MediaFout(503, MIGRATIE_MELDING, 'opslag_ontbreekt');
  logFout('[social] opslag', error);
  return new MediaFout(500, melding);
}

/** Een nieuw, veilig pad voor een bestand van deze post (null bij een ongeldige post-id). */
export function nieuwMediaPad(postId: string, bestandsnaam: string): string | null {
  return maakMediaPad(postId, bestandsnaam, randomBytes(6).toString('hex'));
}

/** Signed upload-URL (2 uur geldig, Supabase-standaard) voor één nieuw bestand. */
export async function uploadUrl(service: SupabaseClient, pad: string): Promise<{ pad: string; token: string; signedUrl: string }> {
  const { data, error } = await service.storage.from(MEDIA_BUCKET).createSignedUploadUrl(pad);
  if (error || !data?.signedUrl) throw opslagFout(error, 'Kon de upload niet voorbereiden.');
  return { pad, token: data.token, signedUrl: data.signedUrl };
}

/** Grootte van een geüpload bestand in bytes, of null als het er (nog) niet staat. */
export async function bestandsGrootte(service: SupabaseClient, pad: string): Promise<number | null> {
  const map = pad.slice(0, pad.lastIndexOf('/'));
  const naam = pad.slice(pad.lastIndexOf('/') + 1);
  const { data, error } = await service.storage.from(MEDIA_BUCKET).list(map, { search: naam, limit: 10 });
  if (error) throw opslagFout(error, 'Kon het bestand niet controleren.');
  const hit = (data ?? []).find((o) => o.name === naam);
  if (!hit) return null;
  const size = (hit.metadata as { size?: number } | null)?.size;
  return typeof size === 'number' ? size : 0;
}

/** Kortlevende signed URL's om te tonen, in één verzoek. Onbekende paden → geen sleutel. */
export async function bekijkUrls(service: SupabaseClient, paden: string[], seconden = 3600): Promise<Map<string, string>> {
  const uit = new Map<string, string>();
  const uniek = [...new Set(paden.filter(Boolean))];
  if (!uniek.length) return uit;
  const { data, error } = await service.storage.from(MEDIA_BUCKET).createSignedUrls(uniek, seconden);
  if (error) {
    // Zonder bucket (migratie half uitgevoerd) of bij een storing: posts zonder beeld tonen.
    if (!bucketOntbreekt(error)) logFout('[social] signed urls', error);
    return uit;
  }
  for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) uit.set(r.path, r.signedUrl);
  return uit;
}

/**
 * Signed URL die Meta kan ophalen bij het aanmaken van een container (Meta downloadt het
 * bestand zelf). `seconden`: zo kort als kan, maar lang genoeg voor de verwerking van een
 * video (bv. 3600).
 */
export async function publiekeMediaUrl(service: SupabaseClient, pad: string, seconden: number): Promise<string> {
  const { data, error } = await service.storage.from(MEDIA_BUCKET).createSignedUrl(pad, Math.max(60, Math.round(seconden)));
  if (error || !data?.signedUrl) throw opslagFout(error, 'Kon het bestand niet klaarzetten voor Meta.');
  return data.signedUrl;
}

/** Bestanden weghalen (bij het verwijderen van een bestand of een hele post). Fouten alleen loggen. */
export async function verwijderBestanden(service: SupabaseClient, paden: string[]): Promise<void> {
  const lijst = [...new Set(paden.filter(Boolean))];
  if (!lijst.length) return;
  const { error } = await service.storage.from(MEDIA_BUCKET).remove(lijst);
  if (error && !bucketOntbreekt(error)) logFout('[social] verwijderen', error);
}
