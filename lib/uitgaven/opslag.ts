import { randomBytes } from 'node:crypto';
import { bewijsUitContext } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { bucketOntbreekt } from '@/lib/db/ontbreekt';
import { OPSLAG_NIET_INGERICHT, UitgavenFout } from './api';
import { extensieVoor, slug, type BestandsType } from './model';
import { logFout } from '@/lib/log';

// Supabase Storage voor uitgaven. Alleen aanroepen ná de sessiecheck in de route: de
// service-role omzeilt RLS (de buckets hebben bewust geen policies).
//   uitgaven         <uitgave-id>/<ts>-<hex>-<slug>.<ext>   (bonnetjes, 25 MB, migratie 0020)
//   uitgaven-export  <ts>-<hex>/<naam>.zip                  (tijdelijke exports, 15 min)

export const BUCKET = 'uitgaven';
export const EXPORT_BUCKET = 'uitgaven-export';
const EXPORT_MAX_LEEFTIJD_MS = 15 * 60 * 1000;

// Alleen binnen een gecontroleerde route (uitgavenRoute zet het bewijs in de context).
const opslag = () => createServiceRoleClient(bewijsUitContext()).storage;

/** Pad voor een nieuw bestand van een uitgave. */
export function nieuwPad(uitgaveId: string, naam: string, type: BestandsType): string {
  const basis = slug(naam.replace(/\.[^.]+$/, ''), 40);
  return `${uitgaveId}/${Date.now()}-${randomBytes(4).toString('hex')}-${basis}.${extensieVoor(type)}`;
}

/** Klopt een pad (uit de client) met het formaat van nieuwPad voor deze uitgave? */
export function isPadVan(uitgaveId: string, pad: unknown): pad is string {
  if (typeof pad !== 'string' || pad.length > 200) return false;
  const [map, bestand, ...rest] = pad.split('/');
  return map === uitgaveId && rest.length === 0 && /^\d{10,16}-[0-9a-f]{8}-[a-z0-9-]{1,40}\.(jpg|png|webp|heic|heif|pdf)$/.test(bestand ?? '');
}

function opslagFout(error: unknown, melding: string): UitgavenFout {
  if (bucketOntbreekt(error)) return new UitgavenFout(503, OPSLAG_NIET_INGERICHT, 'opslag_ontbreekt');
  logFout('[uitgaven] opslag', error);
  return new UitgavenFout(500, melding);
}

/** Signed upload-URL: de browser zet het bestand rechtstreeks in Storage (buiten Vercel om). */
export async function uploadUrl(pad: string): Promise<string> {
  const { data, error } = await opslag().from(BUCKET).createSignedUploadUrl(pad);
  if (error || !data?.signedUrl) throw opslagFout(error, 'Kon de upload niet voorbereiden.');
  return data.signedUrl;
}

/** Grootte van een geüpload bestand, of null als het er (nog) niet staat. */
export async function grootte(pad: string): Promise<number | null> {
  const map = pad.slice(0, pad.lastIndexOf('/'));
  const naam = pad.slice(pad.lastIndexOf('/') + 1);
  const { data, error } = await opslag().from(BUCKET).list(map, { search: naam, limit: 10 });
  if (error) throw opslagFout(error, 'Kon het bestand niet controleren.');
  const hit = (data ?? []).find((o) => o.name === naam);
  if (!hit) return null;
  const size = (hit.metadata as { size?: number } | null)?.size;
  return typeof size === 'number' ? size : 0;
}

export async function upload(pad: string, inhoud: Buffer, type: string): Promise<void> {
  const { error } = await opslag().from(BUCKET).upload(pad, inhoud, { contentType: type, upsert: false });
  if (error) throw opslagFout(error, 'Kon het bestand niet opslaan.');
}

export async function download(pad: string): Promise<Buffer | null> {
  const { data, error } = await opslag().from(BUCKET).download(pad);
  if (error || !data) {
    if (bucketOntbreekt(error)) throw opslagFout(error, '');
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Kortlevende signed URL om een bonnetje te bekijken (of te downloaden). */
export async function bekijkUrl(pad: string, opties: { download?: string; seconden?: number } = {}): Promise<string> {
  const { data, error } = await opslag()
    .from(BUCKET)
    .createSignedUrl(pad, opties.seconden ?? 300, opties.download ? { download: opties.download } : undefined);
  if (error || !data?.signedUrl) throw opslagFout(error, 'Kon het bestand niet openen.');
  return data.signedUrl;
}

/** Signed URL's voor meerdere bestanden in één aanroep (thumbnails in de galerij). */
export async function bekijkUrls(paden: string[], seconden = 600): Promise<Map<string, string>> {
  const uit = new Map<string, string>();
  if (!paden.length) return uit;
  const { data, error } = await opslag().from(BUCKET).createSignedUrls(paden, seconden);
  if (error) {
    // Thumbnails zijn een extraatje: zonder blijft de lijst gewoon werken.
    logFout('[uitgaven] voorbeelden', error);
    return uit;
  }
  for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) uit.set(r.path, r.signedUrl);
  return uit;
}

/** Verwijdert bestanden (best effort per batch; fouten gaan naar de log). */
export async function verwijder(paden: string[]): Promise<void> {
  for (let i = 0; i < paden.length; i += 100) {
    const { error } = await opslag().from(BUCKET).remove(paden.slice(i, i + 100));
    if (error) logFout('[uitgaven] verwijderen uit opslag', error);
  }
}

async function ruimExportsOp() {
  try {
    const st = opslag().from(EXPORT_BUCKET);
    const { data, error } = await st.list('', { limit: 1000 });
    if (error) return;
    const grens = Date.now() - EXPORT_MAX_LEEFTIJD_MS;
    for (const map of (data ?? []).filter((o) => Number(o.name.split('-')[0]) < grens).map((o) => o.name)) {
      const { data: inhoud } = await st.list(map, { limit: 100 });
      const paden = (inhoud ?? []).map((o) => `${map}/${o.name}`);
      if (paden.length) await st.remove(paden);
    }
  } catch (e) {
    logFout('[uitgaven] exports opruimen', e);
  }
}

/** Zet een export klaar en geeft een signed download-URL van 5 minuten terug. */
export async function exportKlaarzetten(naam: string, inhoud: Buffer): Promise<string> {
  await ruimExportsOp();
  const st = opslag().from(EXPORT_BUCKET);
  const pad = `${Date.now()}-${randomBytes(4).toString('hex')}/${naam}`;
  const { error } = await st.upload(pad, inhoud, { contentType: 'application/zip', upsert: false });
  if (error) {
    if (bucketOntbreekt(error)) {
      throw new UitgavenFout(
        503,
        'De opslag voor exports (bucket "uitgaven-export") bestaat nog niet: voer in Supabase supabase/UITVOEREN_0020_UITGAVEN.sql uit.',
        'opslag_ontbreekt'
      );
    }
    throw opslagFout(error, 'Kon de export niet klaarzetten.');
  }
  const { data, error: e2 } = await st.createSignedUrl(pad, 300, { download: naam });
  if (e2 || !data?.signedUrl) throw opslagFout(e2, 'Kon de export niet klaarzetten.');
  return data.signedUrl;
}
