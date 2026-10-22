import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { eigenMailboxRij, mailboxVoor, standaardAdresVoor } from '@/lib/mail/config';
import { kluisBeschikbaar, ontsleutel } from '@/lib/mail/kluis';
import type { MailboxStatus } from './types';

/** De mailbox-status voor /account. Nooit het wachtwoord, ook niet versleuteld. */
export async function mailboxStatus(lid: Teamlid): Promise<MailboxStatus> {
  const [{ rij, ingericht }, { bron }, standaardAdres] = await Promise.all([
    eigenMailboxRij(lid),
    mailboxVoor(lid),
    standaardAdresVoor(lid)
  ]);
  return {
    bron,
    ingericht,
    sleutel: kluisBeschikbaar(),
    standaardAdres,
    eigen: rij
      ? {
          email: rij.email,
          imapHost: rij.imap_host,
          imapPort: rij.imap_port,
          smtpHost: rij.smtp_host,
          smtpPort: rij.smtp_port,
          fromName: rij.from_name,
          handtekening: rij.handtekening,
          heeftWachtwoord: Boolean(rij.wachtwoord_enc),
          leesbaar: ontsleutel(rij.wachtwoord_enc, lid.userId) !== null,
          geverifieerdOp: rij.geverifieerd_op
        }
      : null
  };
}
