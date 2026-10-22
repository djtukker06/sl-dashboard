import { mailRoute, json } from '@/lib/mail/api';
import { metImap } from '@/lib/mail/imap';
import { controleerMap, parseUid } from '@/lib/mail/mappen';
import { haalBericht } from '@/lib/mail/berichten';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ uid: string }> };

// GET /api/mail/berichten/[uid]?map=INBOX → { bericht }
// Opgehaald met PEEK: openen zet het bericht níet op gelezen (dat doet de client via /vlaggen).
// De HTML is gesaneerd en externe afbeeldingen zijn geblokkeerd (data-extern-src).
export const GET = mailRoute(async (request: Request, ctx: Ctx) => {
  const { uid: uidRuw } = await ctx.params;
  const uid = parseUid(uidRuw);
  const sp = new URL(request.url).searchParams;
  const bericht = await metImap(async (c) => {
    const map = await controleerMap(c, sp.get('map'));
    return haalBericht(c, map.pad, uid);
  });
  return json({ bericht });
});
