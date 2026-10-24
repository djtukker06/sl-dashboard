import { mailRoute, json } from '@/lib/mail/api';
import { inboxenDto } from '@/lib/mail/mailboxen';
import { ongelezenPerInbox } from '@/lib/mail/tellers';
import type { InboxMetTeller } from '@/lib/mail/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/mail/inboxen → { inboxen: [{ id, label, email, kleur, …, ongelezen, fout? }], ongelezen }
// Alle inboxen die jij mag zien (eigen + met het team gedeeld), elk met het aantal ongelezen
// in de inbox. Een inbox die nu niet bereikbaar is krijgt een eigen melding; de rest werkt.
// Nooit wachtwoorden of servers.
export const GET = mailRoute(async (_request: Request, _ctx: unknown, mail) => {
  const tellers = await ongelezenPerInbox(mail.mailboxen);
  const dto = inboxenDto(mail.mailboxen);
  const inboxen: InboxMetTeller[] = dto.map((d, i) => ({ ...d, ...tellers[i] }));
  return json({ inboxen, ongelezen: tellers.reduce((s, t) => s + t.ongelezen, 0) });
});
