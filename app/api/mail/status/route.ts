import { mailRoute, json } from '@/lib/mail/api';
import { metImap } from '@/lib/mail/imap';
import type { MailStatus } from '@/lib/mail/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/mail/status → { geconfigureerd, ongelezen } — voor de badge in de rail.
export const GET = mailRoute(async (_request: Request, _ctx: unknown, mail) => {
  if (!mail.cfg) return json({ geconfigureerd: false, ongelezen: 0 } satisfies MailStatus);
  const ongelezen = await metImap(mail.cfg, async (c) => {
    const s = await c.status('INBOX', { unseen: true });
    return s ? (s.unseen ?? 0) : 0;
  });
  return json({ geconfigureerd: true, ongelezen, account: mail.cfg.user } satisfies MailStatus);
});
