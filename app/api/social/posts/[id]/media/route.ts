import { isUuid } from '@/lib/auth/team';
import { fout, json, leesJson, socialRoute, wijzigMedia } from '@/lib/social/posts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/social/posts/[id]/media → { post, waarschuwingen }
//   { pad, type, mime, breedte, hoogte, duur_sec, alt_tekst? }  na de upload aanmelden
//   { volgorde: [media-id, …] }                                  volgorde vastleggen
//   { media_id, alt_tekst }                                       alt-tekst van één bestand
// Het bestand zelf staat dan al in Storage (signed upload-URL, zie ../../../media/upload-url).
export const POST = socialRoute(async (request, ctx: Ctx, service) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze post bestaat niet (meer).');
  return json(await wijzigMedia(service, id, await leesJson(request)));
}, 'social media');
