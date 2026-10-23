import { isUuid } from '@/lib/auth/team';
import { driveRoute, json, leesJson } from '@/lib/drive/api';
import { doelMap, mapInhoud } from '@/lib/drive/bestanden';
import { verbind } from '@/lib/drive/koppeling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/drive/map?id=<map>          inhoud van een map binnen "Studio Levant" (leeg = root)
// GET /api/drive/map?klant=<uuid>      de map van een klant, als die er al is (anders map: null)
// GET /api/drive/map?project=<uuid>    idem voor een project
// → { inhoud: MapInhoud | null }
export const GET = driveRoute(async (request, _ctx, lid) => {
  const p = new URL(request.url).searchParams;
  const v = await verbind(lid.bewijs);
  const klant = p.get('klant');
  const project = p.get('project');
  if (klant || project) {
    const { mapId } = await doelMap(v, klant ? { klant } : { project }, false, isUuid);
    return json({ inhoud: mapId ? await mapInhoud(v, mapId) : null });
  }
  return json({ inhoud: await mapInhoud(v, p.get('id')) });
});

// POST /api/drive/map  { klant } | { project }  → maakt de map (bij eerste gebruik) → { inhoud }
export const POST = driveRoute(async (request, _ctx, lid) => {
  const b = await leesJson(request);
  const v = await verbind(lid.bewijs);
  const { mapId } = await doelMap(v, { klant: b.klant, project: b.project }, true, isUuid);
  return json({ inhoud: await mapInhoud(v, mapId) }, 201);
});
