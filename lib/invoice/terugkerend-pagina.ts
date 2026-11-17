import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { zichtbareMailboxen } from '@/lib/mail/mailboxen';
import type { InboxKeuze } from '@/components/facturen/TerugkerendFormulier';

/** De inboxen waarvandaan je kunt laten versturen: zichtbaar, werkend en geen oude koppeling. */
export async function inboxKeuzes(lid: Teamlid): Promise<InboxKeuze[]> {
  try {
    const { lijst } = await zichtbareMailboxen(lid);
    return lijst.filter((m) => m.cfg && m.soort !== 'oud').map((m) => ({ id: m.id, label: m.label, email: m.email }));
  } catch (e) {
    console.error('[terugkerend] inboxen ophalen mislukt', (e as Error)?.message ?? e);
    return [];
  }
}
