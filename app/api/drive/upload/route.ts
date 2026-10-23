import { isUuid } from '@/lib/auth/team';
import { driveRoute, fout, json, leesJson } from '@/lib/drive/api';
import { doelMap } from '@/lib/drive/bestanden';
import { schoneNaam } from '@/lib/drive/kern';
import { verbind } from '@/lib/drive/koppeling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Uploaden, stap 1: POST /api/drive/upload  { map? | klant? | project?, naam, type, grootte }
//   → { uploadUrl, mapId }
// De server maakt bij Google een resumable upload-sessie aan voor precies dit ene bestand in
// deze map (binnen "Studio Levant"; een klant-/projectmap wordt bij eerste gebruik
// aangemaakt). De browser zet het bestand daarna rechtstreeks (PUT) op die sessie-URL, dus
// niet via onze server: zo geldt de 4,5 MB-limiet van Vercel niet en kunnen ook grote
// bestanden. De sessie-URL is eenmalig, kort geldig en geeft geen toegang tot iets anders.
// Stap 2: POST /api/drive/upload/klaar  { id, klant?, project? } legt vast wie het uploadde.
const MAX = 5 * 1024 * 1024 * 1024; // 5 GB per bestand

export const POST = driveRoute(async (request, _ctx, lid) => {
  const b = await leesJson(request);
  const naam = schoneNaam(b.naam, '', 200);
  if (!naam) return fout(400, 'Bestandsnaam ontbreekt.');
  const grootte = Number(b.grootte);
  if (Number.isFinite(grootte) && grootte > MAX) return fout(400, 'Dit bestand is te groot (max. 5 GB).');
  const type = typeof b.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(b.type) ? b.type : 'application/octet-stream';

  const v = await verbind(lid.bewijs);
  const { mapId } = await doelMap(v, { map: b.map, klant: b.klant, project: b.project }, true, isUuid);
  if (!mapId) return fout(400, 'Geen map gevonden.');
  const origin = request.headers.get('origin') ?? new URL(request.url).origin;
  const uploadUrl = await v.client.uploadSessie({
    naam,
    mime: type,
    grootte: Number.isFinite(grootte) && grootte >= 0 ? grootte : undefined,
    ouderId: mapId,
    origin
  });
  return json({ uploadUrl, mapId });
});
