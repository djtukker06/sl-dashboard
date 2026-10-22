import { mailRoute, json } from '@/lib/mail/api';
import { metImap } from '@/lib/mail/imap';
import { laatsteBerichten } from '@/lib/mail/berichten';
import type { MailOverzicht } from '@/lib/mail/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/mail/overzicht → { geconfigureerd, ongelezen, berichten (laatste 6 uit de inbox) }
// voor de inbox-widget op het dashboard.
export const GET = mailRoute(async (_request: Request, _ctx: unknown, mail) => {
  if (!mail.cfg) return json({ geconfigureerd: false, ongelezen: 0, berichten: [] } satisfies MailOverzicht);
  const res = await metImap(mail.cfg, async (c) => {
    const s = await c.status('INBOX', { unseen: true });
    const berichten = await laatsteBerichten(c, 'INBOX', 6);
    return { ongelezen: s ? (s.unseen ?? 0) : 0, berichten };
  });
  return json({ geconfigureerd: true, ...res } satisfies MailOverzicht);
});
