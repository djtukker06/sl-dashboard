import { bkRoute, fout } from '@/lib/boekhouding/api';
import { aangifteBetalingActie, aangifteBetalingLosActie, leesKwartaal } from '@/lib/boekhouding/acties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jaar: string; kw: string }> };

// POST /api/boekhouding/aangiften/[jaar]/[kw]/betaling  { boekingId, bedrag? } → { betaling }
//   Koppelt de btw-betaling (of teruggaaf) op de bank aan de ingediende aangifte.
export const POST = bkRoute(async (request, ctx: Ctx, { repo }) => {
  const p = await ctx.params;
  const kw = leesKwartaal(p.jaar, p.kw);
  if (!kw) return fout(404, 'Onbekend kwartaal.');
  return aangifteBetalingActie(request, repo, kw);
});

// DELETE /api/boekhouding/aangiften/[jaar]/[kw]/betaling?id= → { ok }
export const DELETE = bkRoute(async (request, ctx: Ctx, { repo }) => {
  const p = await ctx.params;
  if (!leesKwartaal(p.jaar, p.kw)) return fout(404, 'Onbekend kwartaal.');
  return aangifteBetalingLosActie(request, repo);
});
