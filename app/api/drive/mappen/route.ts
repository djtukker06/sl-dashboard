import { driveRoute, fout, json, leesJson } from '@/lib/drive/api';
import { naarItem } from '@/lib/drive/bestanden';
import { MAP_MIME, schoneNaam } from '@/lib/drive/kern';
import { verbind } from '@/lib/drive/koppeling';
import { binnen } from '@/lib/drive/mappen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/drive/mappen  { ouder, naam } → { item }  nieuwe map binnen "Studio Levant".
export const POST = driveRoute(async (request, _ctx, lid) => {
  const b = await leesJson(request);
  const naam = schoneNaam(b.naam, '');
  if (!naam) return fout(400, 'Geef de map een naam.');
  const v = await verbind(lid.bewijs);
  const ouder = typeof b.ouder === 'string' && b.ouder && b.ouder !== v.rootId ? await binnen(v, b.ouder) : await v.client.bestand(v.rootId);
  if (ouder.mimeType !== MAP_MIME) return fout(400, 'Dit is geen map.');
  const map = await v.client.maakMap(ouder.id, naam);
  return json({ item: naarItem(map) }, 201);
});
