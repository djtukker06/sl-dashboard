import { randomBytes } from 'node:crypto';
import type { Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { bucketOntbreekt } from '@/lib/db/ontbreekt';
import { MailFout } from './fout';

// Grote bijlagen (> 4 MB) passen niet in een Vercel-respons (max. 4,5 MB). Die gaan eerst
// naar de privé-bucket "mail-tmp" (migratie 0019) en de browser downloadt ze via een
// signed URL van 60 seconden. Oude bestanden (> 15 min) worden bij elke upload opgeruimd.
// Alleen aanroepen ná de teamlidcontrole in de route (het bewijs zit in `lid`).
// Pad: <user-id>/<ts>-<willekeurig>/<bestand> — per gebruiker gescheiden en op te ruimen.

export const BUCKET = 'mail-tmp';
const MAX_LEEFTIJD_MS = 15 * 60 * 1000;

async function ruimOp(lid: Teamlid) {
  try {
    const storage = createServiceRoleClient(lid.bewijs).storage.from(BUCKET);
    const grens = Date.now() - MAX_LEEFTIJD_MS;
    const verlopen = (lijst: { name: string }[] | null, prefix: string) =>
      (lijst ?? [])
        .filter((o) => /^\d{13}-/.test(o.name) && Number(o.name.split('-')[0]) < grens)
        .map((o) => `${prefix}${o.name}`);
    const [eigen, wortel] = await Promise.all([
      storage.list(lid.userId, { limit: 1000 }),
      // Bestanden van vóór de indeling per gebruiker (<ts>-<rnd>/ direct in de bucket).
      storage.list('', { limit: 1000 })
    ]);
    const oud = [...verlopen(eigen.error ? null : eigen.data, `${lid.userId}/`), ...verlopen(wortel.error ? null : wortel.data, '')];
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

export async function signedDownload(lid: Teamlid, naam: string, inhoud: Buffer): Promise<string> {
  const storage = createServiceRoleClient(lid.bewijs).storage.from(BUCKET);
  await ruimOp(lid);
  const veiligeNaam = naam.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'bijlage';
  const pad = `${lid.userId}/${Date.now()}-${randomBytes(8).toString('hex')}/${veiligeNaam}`;
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
