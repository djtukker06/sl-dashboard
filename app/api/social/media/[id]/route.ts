import { isUuid } from '@/lib/auth/team';
import { fout, json, socialRoute, verwijderMedia } from '@/lib/social/posts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/social/media/[id] → { ok, post }  (uit de post én uit Storage)
export const DELETE = socialRoute(async (_request, ctx: Ctx, service) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Dit bestand bestaat niet (meer).');
  const { post } = await verwijderMedia(service, id);
  return json({ ok: true, post });
}, 'social media');
