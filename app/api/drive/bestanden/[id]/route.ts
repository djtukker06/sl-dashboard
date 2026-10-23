import { driveRoute, fout, json, leesJson } from '@/lib/drive/api';
import { naarItem, uploaders } from '@/lib/drive/bestanden';
import { DriveFout, MELDING, schoneNaam } from '@/lib/drive/kern';
import { verbind } from '@/lib/drive/koppeling';
import { beschermdeMappen, binnen } from '@/lib/drive/mappen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/drive/bestanden/[id]  { naam } → { item }   hernoemen
// DELETE /api/drive/bestanden/[id]                       naar de prullenbak van Drive
// Alleen binnen "Studio Levant"; de vaste mappen (root, Boekhouding, Klanten, …) niet.
export const PATCH = driveRoute(async (request, ctx: Ctx, lid) => {
  const { id } = await ctx.params;
  const b = await leesJson(request);
  const naam = schoneNaam(b.naam, '', 200);
  if (!naam) return fout(400, 'Geef een naam op.');
  const v = await verbind(lid.bewijs);
  const bestand = await binnen(v, id);
  if ((await beschermdeMappen(v)).has(bestand.id)) throw new DriveFout('beschermd', MELDING.beschermd);
  const nieuw = await v.client.wijzig(bestand.id, { name: naam });
  const door = await uploaders(v, [nieuw.id]);
  return json({ item: naarItem(nieuw, door.get(nieuw.id) ?? null) });
});

export const DELETE = driveRoute(async (_request, ctx: Ctx, lid) => {
  const { id } = await ctx.params;
  const v = await verbind(lid.bewijs);
  const bestand = await binnen(v, id);
  if ((await beschermdeMappen(v)).has(bestand.id)) throw new DriveFout('beschermd', MELDING.beschermd);
  await v.client.wijzig(bestand.id, { trashed: true });
  return json({ ok: true });
});
