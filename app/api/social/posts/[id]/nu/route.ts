import { isUuid } from '@/lib/auth/team';
import { plaatsPost } from '@/lib/social/plaatsen';
import { fout, json, klaarVoorNu, leesPost, socialRoute } from '@/lib/social/posts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Een reel kan even duren (container aanmaken, wachten tot Meta de video verwerkt heeft).
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/social/posts/[id]/nu → { status, fouten, post }  (PlaatsResultaat + de nieuwe stand)
// Ook "Opnieuw proberen" bij een mislukte of deels geplaatste post. De post wordt eerst gecontroleerd en op
// 'ingepland' met het huidige tijdstip gezet; plaatsPost (lib/social/plaatsen.ts) claimt hem
// daarna, zodat een gelijktijdige cronrun hem niet dubbel plaatst.
export const POST = socialRoute(async (_request, ctx: Ctx, service) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze post bestaat niet (meer).');
  const huidig = await leesPost(service, id);
  if (!huidig) return fout(404, 'Deze post bestaat niet (meer).');
  // Deels geplaatst: alleen de mislukte kanalen opnieuw (plaatsPost slaat geplaatste over);
  // de inhoud ligt dan vast, dus geen nieuwe controle.
  if (huidig.status !== 'deels') await klaarVoorNu(service, id);
  const resultaat = await plaatsPost(service, id);
  return json({ ...resultaat, post: await leesPost(service, id) });
}, 'social nu');
