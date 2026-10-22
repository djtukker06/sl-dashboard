import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { bucketOntbreekt } from '@/lib/db/ontbreekt';
import { MailFout } from './fout';

// Grote bijlagen (> 4 MB) passen niet in een Vercel-respons (max. 4,5 MB). Die gaan eerst
// naar de privé-bucket "mail-tmp" (migratie 0019) en de browser downloadt ze via een
// signed URL van 60 seconden. Oude bestanden (> 15 min) worden bij elke upload opgeruimd.
// Alleen aanroepen ná de sessiecheck in de route.

export const BUCKET = 'mail-tmp';
const MAX_LEEFTIJD_MS = 15 * 60 * 1000;

async function ruimOp() {
  try {
    const storage = createServiceRoleClient().storage.from(BUCKET);
    const { data, error } = await storage.list('', { limit: 1000 });
    if (error) return;
    const grens = Date.now() - MAX_LEEFTIJD_MS;
    const oud = (data ?? []).filter((o) => Number(o.name.split('-')[0]) < grens).map((o) => o.name);
    // Elke map (<ts>-<rnd>/) bevat precies één bestand; list() geeft mappen terug als prefix.
    for (const map of oud) {
      const { data: inhoud } = await storage.list(map, { limit: 10 });
      const paden = (inhoud ?? []).map((o) => `${map}/${o.name}`);
      if (paden.length) await storage.remove(paden);
    }
  } catch (e) {
    console.error('[mail] opruimen mail-tmp', e);
  }
}

export async function signedDownload(naam: string, inhoud: Buffer): Promise<string> {
  const storage = createServiceRoleClient().storage.from(BUCKET);
  await ruimOp();
  const veiligeNaam = naam.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'bijlage';
  const pad = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}/${veiligeNaam}`;
  const { error: upErr } = await storage.upload(pad, inhoud, { contentType: 'application/octet-stream', upsert: false });
  if (upErr) {
    console.error('[mail] upload mail-tmp', upErr.message);
    if (bucketOntbreekt(upErr)) {
      throw new MailFout(
        503,
        'opslag_ontbreekt',
        'Bijlagen groter dan 4 MB hebben de opslag "mail-tmp" nodig: voer in Supabase migratie 0019 uit.'
      );
    }
    throw new MailFout(500, 'onbereikbaar', 'Kon de bijlage niet klaarzetten.');
  }
  const { data, error } = await storage.createSignedUrl(pad, 60, { download: naam });
  if (error || !data?.signedUrl) throw new MailFout(500, 'onbereikbaar', 'Kon de bijlage niet klaarzetten.');
  return data.signedUrl;
}
