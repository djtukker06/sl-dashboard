import { bkRoute, fout } from '@/lib/boekhouding/api';
import { aangifteBetaalActie, leesKwartaal } from '@/lib/boekhouding/acties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jaar: string; kw: string }> };

// POST /api/boekhouding/aangiften/[jaar]/[kw]/betalen  { datum, rekeningId? } → { boeking, betaling, ingepland }
//   Boekt de btw-betaling (of teruggaaf) op de bank en koppelt hem aan de aangifte. Een datum
//   na vandaag plant de betaling in.
export const POST = bkRoute(async (request, ctx: Ctx, { repo }) => {
  const p = await ctx.params;
  const kw = leesKwartaal(p.jaar, p.kw);
  if (!kw) return fout(404, 'Onbekend kwartaal.');
  return aangifteBetaalActie(request, repo, kw);
});
