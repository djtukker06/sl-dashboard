import { mailRoute, json, leesJson } from '@/lib/mail/api';
import { MailFout } from '@/lib/mail/fout';
import { metImap } from '@/lib/mail/imap';
import { controleerMap, parseUid } from '@/lib/mail/mappen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ uid: string }> };

// POST /api/mail/berichten/[uid]/vlaggen?map=INBOX  { gelezen?: boolean, gemarkeerd?: boolean }
export const POST = mailRoute(
  async (request: Request, ctx: Ctx) => {
    const { uid: uidRuw } = await ctx.params;
    const uid = parseUid(uidRuw);
    const sp = new URL(request.url).searchParams;
    const body = await leesJson(request);
    const wijzig: [string, boolean][] = [];
    if (typeof body.gelezen === 'boolean') wijzig.push(['\\Seen', body.gelezen]);
    if (typeof body.gemarkeerd === 'boolean') wijzig.push(['\\Flagged', body.gemarkeerd]);
    if (!wijzig.length) throw new MailFout(400, 'ongeldig', 'Niets om te wijzigen.');

    await metImap(async (c) => {
      const map = await controleerMap(c, sp.get('map'));
      const lock = await c.getMailboxLock(map.pad);
      try {
        for (const [vlag, aan] of wijzig) {
          if (aan) await c.messageFlagsAdd(String(uid), [vlag], { uid: true });
          else await c.messageFlagsRemove(String(uid), [vlag], { uid: true });
        }
      } finally {
        lock.release();
      }
    });
    return json({ ok: true });
  },
  { muterend: true }
);
