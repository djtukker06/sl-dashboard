import 'server-only';
import { inboxFoutTekst, metTijdslimiet } from './api';
import { metImap } from './imap';
import type { Mailbox } from './mailboxen';
import type { InboxTeller } from './types';

// Ongelezen per inbox, voor de rail-badge, het dashboard en de inboxenlijst in Mail. Alle
// inboxen tegelijk, elk met een eigen tijdslimiet: één trage of kapotte mailserver houdt de
// rest niet op en geeft alleen bij die inbox een melding.

export const TIJDSLIMIET_MS = 8_000;

export const ONLEESBAAR =
  'Het wachtwoord van deze inbox kan niet meer worden gelezen. Koppel hem opnieuw via Account & mail.';

export async function ongelezenPerInbox(lijst: Mailbox[]): Promise<InboxTeller[]> {
  return Promise.all(
    lijst.map(async (m): Promise<InboxTeller> => {
      if (!m.cfg) return { id: m.id, ongelezen: 0, fout: ONLEESBAAR };
      try {
        const ongelezen = await metTijdslimiet(
          metImap(m.cfg, async (c) => {
            const s = await c.status('INBOX', { unseen: true });
            return s ? (s.unseen ?? 0) : 0;
          }),
          TIJDSLIMIET_MS
        );
        return { id: m.id, ongelezen };
      } catch (e) {
        return { id: m.id, ongelezen: 0, fout: inboxFoutTekst(e) };
      }
    })
  );
}
