import { SocialFout, fout, json, leesJson, leesPosts, maakPost, parseFilter, socialRoute } from '@/lib/social/posts';
import { MIGRATIE_MELDING } from '@/lib/social/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET  /api/social/posts?status=&kanaal=&van=&tot=  → { posts }  (vóór migratie 0041: { posts: [], melding })
// POST /api/social/posts  body PostInvoer           → { post, waarschuwingen }
// Teamlidcontrole via socialRoute; lezen en schrijven met de service-role (lib/social/posts.ts).
export const GET = socialRoute(async (request, _ctx, service) => {
  const filter = parseFilter(new URL(request.url).searchParams);
  try {
    return json({ posts: await leesPosts(service, filter) });
  } catch (e) {
    if (e instanceof SocialFout && e.code === 'migratie') return json({ posts: [], melding: MIGRATIE_MELDING });
    throw e;
  }
}, 'social posts');

export const POST = socialRoute(async (request, _ctx, service, lid) => {
  const body = await leesJson(request);
  if (!Object.keys(body).length) return fout(400, 'Lege post.');
  const { post, waarschuwingen } = await maakPost(service, lid, body);
  return json({ post, waarschuwingen }, 201);
}, 'social posts');
