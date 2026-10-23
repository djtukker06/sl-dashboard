import { driveRoute, json } from '@/lib/drive/api';
import { zoek } from '@/lib/drive/bestanden';
import { verbind } from '@/lib/drive/koppeling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/drive/zoeken?q=…  → { items }  alleen resultaten binnen "Studio Levant".
export const GET = driveRoute(async (request, _ctx, lid) => {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return json({ items: [] });
  const v = await verbind(lid.bewijs);
  return json({ items: await zoek(v, q) });
});
