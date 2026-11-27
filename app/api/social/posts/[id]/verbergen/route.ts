import { isUuid } from '@/lib/auth/team';
import { fout, json, leesJson, socialRoute, zetVerborgen } from '@/lib/social/posts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/social/posts/[id]/verbergen  { verborgen: boolean } → { post }
// Verbergt een post in het overzicht (of zet hem terug). Alleen in het dashboard: op
// Instagram/Facebook verandert niets, en de sync zet hem niet terug.
export const POST = socialRoute(async (request, ctx: Ctx, service) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze post bestaat niet (meer).');
  return json(await zetVerborgen(service, id, await leesJson(request)));
}, 'social verbergen');
