import { bkRoute, fout } from '@/lib/boekhouding/api';
import { indienenActie, intrekkenActie, leesKwartaal } from '@/lib/boekhouding/acties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jaar: string; kw: string }> };

// POST /api/boekhouding/aangiften/[jaar]/[kw]  { kenmerk?, opmerking?, verwacht? } → { aangifte }
//   Markeert het kwartaal als ingediend: de server rekent de aangifte zelf uit en bewaart die
//   (snapshot); daarmee is het kwartaal vergrendeld. `verwacht` = het te betalen bedrag dat de
//   gebruiker zag (centen); wijkt dat af, dan 409 (eerst opnieuw bekijken).
export const POST = bkRoute(async (request, ctx: Ctx, { repo }) => {
  const p = await ctx.params;
  const kw = leesKwartaal(p.jaar, p.kw);
  if (!kw) return fout(404, 'Onbekend kwartaal.');
  return indienenActie(request, repo, kw);
});

// DELETE /api/boekhouding/aangiften/[jaar]/[kw] → { ok }
//   Intrekken (het kwartaal weer openzetten): alleen de eigenaar, ingelogd met 2FA.
export const DELETE = bkRoute(
  async (_request, ctx: Ctx, { repo }) => {
    const p = await ctx.params;
    const kw = leesKwartaal(p.jaar, p.kw);
    if (!kw) return fout(404, 'Onbekend kwartaal.');
    return intrekkenActie(repo, kw);
  },
  { alleenEigenaar: true }
);
