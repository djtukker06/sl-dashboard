import { isUuid } from '@/lib/auth/team';
import { driveRoute, fout, json, leesJson } from '@/lib/drive/api';
import { naarItem } from '@/lib/drive/bestanden';
import { isDriveId } from '@/lib/drive/kern';
import { verbind } from '@/lib/drive/koppeling';
import { binnen } from '@/lib/drive/mappen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Uploaden, stap 2: POST /api/drive/upload/klaar  { id, klant?, project? } → { item }
// Het bestand staat al in Drive (de browser uploadde rechtstreeks). Controleer dat het
// binnen "Studio Levant" ligt en leg vast wie het uploadde (drive_bestanden), zodat de
// lijst "door <naam>" kan tonen. Lukt het vastleggen niet (vóór 0024), dan staat het
// bestand er gewoon, alleen zonder naam erbij.
export const POST = driveRoute(async (request, _ctx, lid) => {
  const b = await leesJson(request);
  if (!isDriveId(b.id)) return fout(400, 'Ongeldig bestand.');
  const v = await verbind(lid.bewijs);
  const bestand = await binnen(v, b.id);
  const { error } = await v.service.from('drive_bestanden').upsert(
    {
      drive_file_id: bestand.id,
      naam: bestand.name.slice(0, 500),
      geupload_door: lid.userId,
      client_id: isUuid(b.klant) ? b.klant : null,
      project_id: isUuid(b.project) ? b.project : null
    },
    { onConflict: 'drive_file_id' }
  );
  if (error) console.warn('[drive] uploader vastleggen', error.code ?? '', error.message);
  return json({ item: naarItem(bestand, error ? null : lid.userId) }, 201);
});
