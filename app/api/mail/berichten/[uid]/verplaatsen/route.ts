import { mailRoute, json, leesJson } from '@/lib/mail/api';
import { MailFout } from '@/lib/mail/fout';
import { metImap } from '@/lib/mail/imap';
import { controleerMap, mapVoorRol, parseUid } from '@/lib/mail/mappen';
import type { MapRol } from '@/lib/mail/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ uid: string }> };

const ROLLEN: Record<string, MapRol> = { prullenbak: 'prullenbak', archief: 'archief', inbox: 'inbox', spam: 'spam' };

// POST /api/mail/berichten/[uid]/verplaatsen?map=INBOX
//   { naar: 'prullenbak' | 'archief' | 'inbox' | 'spam' }  of  { naarMap: '<pad>' } (ongedaan maken)
//   → { naar: '<pad>', uid: <nieuwe uid of null> }
// "Verwijderen" = naar de prullenbak. Definitief wissen gebeurt hier nooit.
export const POST = mailRoute(
  async (request: Request, ctx: Ctx, mail) => {
    const { uid: uidRuw } = await ctx.params;
    const uid = parseUid(uidRuw);
    const sp = new URL(request.url).searchParams;
    const body = await leesJson(request);

    const res = await metImap(mail.cfg, async (c) => {
      const bron = await controleerMap(c, sp.get('map'));
      let doel: string | null = null;
      if (typeof body.naarMap === 'string') {
        doel = (await controleerMap(c, body.naarMap)).pad;
      } else if (typeof body.naar === 'string' && ROLLEN[body.naar]) {
        const rol = ROLLEN[body.naar];
        doel = rol === 'inbox' ? 'INBOX' : await mapVoorRol(c, rol, rol === 'archief' || rol === 'prullenbak');
        if (!doel) throw new MailFout(404, 'niet_gevonden', `Er is geen map voor ${body.naar}.`);
      } else {
        throw new MailFout(400, 'ongeldig', 'Onbekende bestemming.');
      }
      if (doel === bron.pad) return { naar: doel, uid };

      const lock = await c.getMailboxLock(bron.pad);
      try {
        const r = await c.messageMove(String(uid), doel, { uid: true });
        if (!r) throw new MailFout(404, 'niet_gevonden', 'Dit bericht bestaat niet meer.');
        return { naar: doel, uid: r.uidMap?.get(uid) ?? null };
      } finally {
        lock.release();
      }
    });
    return json(res);
  }
);
