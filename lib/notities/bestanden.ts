import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { bucketOntbreekt, tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logFout } from '@/lib/log';
import { bijlagePad, bijlageUrl, isAfbeelding, type Bijlage } from './kern';
import { NotitieFout } from './repo';

// Opslag van bijlagen bij notities (bucket "notities", migratie 0032). Wie wat mag, bepaalt
// RLS via de gebruikerscliënt (lid.sb: tabel notitie_bestanden en notities); de bucket zelf
// heeft geen policies en wordt hier alleen met de service-role gelezen en beschreven, ná die
// controle. Uploads gaan via een signed upload-URL rechtstreeks van de browser naar Storage.

const BUCKET = 'notities';
export const BIJLAGEN_NIET_INGERICHT = 'Foto’s en bestanden in notities werken zodra migratie 0032 is uitgevoerd (supabase/UITVOEREN_0032.sql).';

const opslag = (lid: Teamlid) => createServiceRoleClient(lid.bewijs).storage.from(BUCKET);

function fout(error: unknown, melding: string): NotitieFout {
  if (bucketOntbreekt(error) || tabelOntbreekt(error)) {
    return new NotitieFout(503, BIJLAGEN_NIET_INGERICHT, 'bijlagen_ontbreekt');
  }
  logFout('[notities] bijlagen', error);
  return new NotitieFout(500, melding);
}

/** Bestaat de notitie en mag dit teamlid hem zien (RLS)? Anders 404. */
export async function moetNotitie(lid: Teamlid, notitieId: string): Promise<void> {
  const { data, error } = await lid.sb.from('notities').select('id').eq('id', notitieId).is('verwijderd_op', null).maybeSingle();
  if (error) throw fout(error, 'Kon de notitie niet controleren.');
  if (!data) throw new NotitieFout(404, 'Deze notitie bestaat niet (meer).', 'niet_gevonden');
}

/** Stap 1: pad + signed upload-URL. */
export async function bijlageKlaarzetten(lid: Teamlid, notitieId: string, naam: string): Promise<{ pad: string; signedUrl: string }> {
  await moetNotitie(lid, notitieId);
  const pad = bijlagePad(notitieId, naam, Date.now(), randomBytes(4).toString('hex'));
  const { data, error } = await opslag(lid).createSignedUploadUrl(pad);
  if (error || !data?.signedUrl) throw fout(error, 'Kon de upload niet voorbereiden.');
  return { pad, signedUrl: data.signedUrl };
}

async function grootte(lid: Teamlid, pad: string): Promise<number | null> {
  const map = pad.slice(0, pad.lastIndexOf('/'));
  const naam = pad.slice(pad.lastIndexOf('/') + 1);
  const { data, error } = await opslag(lid).list(map, { search: naam, limit: 10 });
  if (error) throw fout(error, 'Kon het bestand niet controleren.');
  const hit = (data ?? []).find((o) => o.name === naam);
  if (!hit) return null;
  const size = (hit.metadata as { size?: number } | null)?.size;
  return typeof size === 'number' ? size : 0;
}

/** Stap 2: het bestand staat in Storage; nu vastleggen bij de notitie. */
export async function bijlageAanmelden(
  lid: Teamlid,
  notitieId: string,
  b: { pad: string; naam: string; type: string },
  max: number
): Promise<Bijlage> {
  const bytes = await grootte(lid, b.pad);
  if (bytes === null) throw new NotitieFout(400, 'Het bestand is niet (volledig) geüpload. Probeer het opnieuw.');
  if (bytes > max) {
    await opslag(lid).remove([b.pad]);
    throw new NotitieFout(400, 'Dit bestand is te groot (max. 25 MB).');
  }
  const { data, error } = await lid.sb
    .from('notitie_bestanden')
    .insert({ notitie_id: notitieId, storage_path: b.pad, file_name: b.naam, mime_type: b.type, size_bytes: bytes, created_by: lid.userId })
    .select('id')
    .single();
  if (error || !data) {
    await opslag(lid).remove([b.pad]);
    if (error?.code === '42501') throw new NotitieFout(404, 'Deze notitie bestaat niet (meer).', 'niet_gevonden');
    throw fout(error, 'Kon het bestand niet opslaan.');
  }
  return { id: data.id, url: bijlageUrl(notitieId, data.id), naam: b.naam, type: b.type, grootte: bytes, afbeelding: isAfbeelding(b.type) };
}

/** Signed URL (5 min) voor een bijlage die dit teamlid mag zien, of null. */
export async function bijlageOpenen(lid: Teamlid, notitieId: string, bestandId: string, download: boolean): Promise<string | null> {
  const { data, error } = await lid.sb
    .from('notitie_bestanden')
    .select('storage_path, file_name, mime_type')
    .eq('id', bestandId)
    .eq('notitie_id', notitieId)
    .maybeSingle();
  if (error) throw fout(error, 'Kon het bestand niet openen.');
  if (!data) return null;
  const r = data as { storage_path: string; file_name: string; mime_type: string };
  // Alles behalve foto's en PDF's altijd als download (nooit als pagina tonen).
  const alsDownload = download || !(isAfbeelding(r.mime_type) || r.mime_type === 'application/pdf');
  const { data: s, error: e2 } = await opslag(lid).createSignedUrl(r.storage_path, 300, alsDownload ? { download: r.file_name } : undefined);
  if (e2 || !s?.signedUrl) throw fout(e2, 'Kon het bestand niet openen.');
  return s.signedUrl;
}
