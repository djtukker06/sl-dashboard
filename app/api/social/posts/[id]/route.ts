import { isUuid } from '@/lib/auth/team';
import { fout, json, leesJson, leesPost, socialRoute, verwijderPost, wijzigPost } from '@/lib/social/posts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const ONBEKEND = 'Deze post bestaat niet (meer).';

// GET    /api/social/posts/[id]                 → { post }
// PATCH  /api/social/posts/[id]  body Partial<PostInvoer> → { post, waarschuwingen }
//        (een geplaatste post: alleen { notities })
// DELETE /api/social/posts/[id][?definitief=1]  → { ok, geannuleerd, post? }
//        een ingeplande post wordt geannuleerd (terug naar concept); definitief=1 verwijdert hem.
export const GET = socialRoute(async (_request, ctx: Ctx, service) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, ONBEKEND);
  const post = await leesPost(service, id);
  if (!post) return fout(404, ONBEKEND);
  return json({ post });
}, 'social post');

export const PATCH = socialRoute(async (request, ctx: Ctx, service) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, ONBEKEND);
  const { post, waarschuwingen } = await wijzigPost(service, id, await leesJson(request));
  return json({ post, waarschuwingen });
}, 'social post');

export const DELETE = socialRoute(async (request, ctx: Ctx, service) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, ONBEKEND);
  const definitief = new URL(request.url).searchParams.get('definitief') === '1';
  const r = await verwijderPost(service, id, definitief);
  return json({ ok: true, ...r });
}, 'social post');
