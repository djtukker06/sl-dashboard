import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { kluisBeschikbaar } from '@/lib/mail/kluis';
import { vergeetMailboxen, zichtbareMailboxen } from '@/lib/mail/mailboxen';
import type { MailboxStatus } from './types';

/**
 * De mailbox-status voor de welkomstflow en de "koppel je inbox"-schermen: je EERSTE eigen
 * inbox (meerdere inboxen beheer je op /account, lib/mail/beheer.ts). Nooit het wachtwoord,
 * ook niet versleuteld.
 */
export async function mailboxStatus(lid: Teamlid): Promise<MailboxStatus> {
  vergeetMailboxen();
  const { lijst, opslag } = await zichtbareMailboxen(lid);
  const eigen = lijst.find((m) => m.vanMij && m.soort !== 'env') ?? null;
  const env = lijst.find((m) => m.soort === 'env') ?? null;
  return {
    bron: eigen?.leesbaar ? 'eigen' : env ? 'standaard' : 'geen',
    ingericht: opslag !== 'geen',
    sleutel: kluisBeschikbaar(),
    standaardAdres: env?.email ?? null,
    eigen: eigen
      ? {
          id: eigen.id,
          email: eigen.email,
          imapHost: eigen.imapHost,
          imapPort: eigen.imapPort,
          smtpHost: eigen.smtpHost,
          smtpPort: eigen.smtpPort,
          fromName: eigen.fromName,
          handtekening: eigen.handtekening,
          heeftWachtwoord: true,
          leesbaar: eigen.leesbaar,
          geverifieerdOp: eigen.geverifieerdOp
        }
      : null
  };
}
