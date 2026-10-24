import { mailRoute, json } from '@/lib/mail/api';
import { ongelezenPerInbox } from '@/lib/mail/tellers';
import type { MailStatus } from '@/lib/mail/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/mail/status → { geconfigureerd, ongelezen, perInbox } — voor de badge in de rail.
// `ongelezen` is de som over alle inboxen die je mag zien (eigen + gedeeld met het team).
export const GET = mailRoute(async (_request: Request, _ctx: unknown, mail) => {
  const bruikbaar = mail.mailboxen.filter((m) => m.cfg);
  if (!bruikbaar.length) return json({ geconfigureerd: false, ongelezen: 0 } satisfies MailStatus);
  const perInbox = await ongelezenPerInbox(bruikbaar);
  const ongelezen = perInbox.reduce((s, t) => s + t.ongelezen, 0);
  return json({ geconfigureerd: true, ongelezen, perInbox } satisfies MailStatus);
});
