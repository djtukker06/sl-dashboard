import { json, leesJson, maakUploadUrl, socialRoute } from '@/lib/social/posts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/social/media/upload-url  { post_id, bestandsnaam, mime, grootte } → { pad, token, signedUrl }
// Stap 1 van een upload (zelfde patroon als de bonnetjes): de server kiest het pad in de
// privé-bucket 'social-media' en geeft een signed upload-URL. De browser zet het bestand
// rechtstreeks in Storage (video's passen niet door de ~4,5 MB-limiet van Vercel) en meldt
// het daarna aan via POST /api/social/posts/[id]/media.
export const POST = socialRoute(async (request, _ctx, service) => {
  return json(await maakUploadUrl(service, await leesJson(request)));
}, 'social upload');
