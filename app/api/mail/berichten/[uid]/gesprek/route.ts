import { mailRoute, json } from '@/lib/mail/api';
import { metImap } from '@/lib/mail/imap';
import { controleerMap, parseUid } from '@/lib/mail/mappen';
import { haalGesprek } from '@/lib/mail/gesprek';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ uid: string }> };

// GET /api/mail/berichten/[uid]/gesprek?mb=<inbox>&map=INBOX → { gesprek: GesprekBericht[] }
// De andere berichten uit hetzelfde gesprek (via Message-ID / In-Reply-To / References),
// gezocht in deze map plus inbox, verzonden en archief; oud → nieuw, alleen platte tekst.
export const GET = mailRoute(async (request: Request, ctx: Ctx, mail) => {
  const { uid: uidRuw } = await ctx.params;
  const uid = parseUid(uidRuw);
  const sp = new URL(request.url).searchParams;
  const gesprek = await metImap(mail.cfg, async (c) => {
    const map = await controleerMap(c, sp.get('map'));
    return haalGesprek(c, map.pad, uid);
  });
  return json({ gesprek });
});
