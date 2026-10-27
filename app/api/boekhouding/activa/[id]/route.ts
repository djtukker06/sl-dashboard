import { bkRoute, fout, isUuid } from '@/lib/boekhouding/api';
import { activumVerwijderenActie, activumWijzigenActie } from '@/lib/boekhouding/acties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/boekhouding/activa/[id]  (velden optioneel, zoals bij POST; ook
//   desinvesteringDatum + desinvesteringOpbrengst) → { activum }
//   In een afgesloten boekjaar liggen aanschaf, termijn en ingebruikname vast.
export const PATCH = bkRoute(async (request, ctx: Ctx, { repo }) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Dit activum bestaat niet (meer).');
  return activumWijzigenActie(request, repo, id);
});

// DELETE /api/boekhouding/activa/[id] → { ok }
export const DELETE = bkRoute(async (_request, ctx: Ctx, { repo }) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Dit activum bestaat niet (meer).');
  return activumVerwijderenActie(repo, id);
});
