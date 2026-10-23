import { cache } from 'react';
import Link from 'next/link';
import type { Teamlid } from '@/lib/auth/team';
import { magEnvMailbox, mailboxVoor } from '@/lib/mail/config';
import { NietGekoppeld } from '@/components/mail/NietGekoppeld';
import { Kaart, KaartSkelet } from './Kaart';
import { InboxWidget } from './InboxWidget';

// Alles op het dashboard dat afhangt van JOUW mailbox, als eigen async componenten in
// <Suspense>: de mailcheck (service-role-query + ontsleutelen, kort gecachet in
// lib/mail/config.ts) houdt zo de begroeting, planning en de andere kaarten niet op.
// Nooit de mailbox van een ander: mailboxVoor/magEnvMailbox werken met het eigen user-id.

// Kaart en knop renderen tegelijk: binnen één render maar één keer opvragen.
const mailboxVanVerzoek = cache((lid: Teamlid) => mailboxVoor(lid));

/** De inbox-kaart: de widget (client, haalt zelf via IMAP op) of meteen koppelen. */
export async function InboxKaart({ lid }: { lid: Teamlid }) {
  const { cfg } = await mailboxVanVerzoek(lid);
  if (cfg) return <InboxWidget />;
  const reden = (await magEnvMailbox(lid)) ? 'instellen' : 'eigen';
  return (
    <Kaart label="Inbox" href="/mail" linkTekst="Mail" className="db-smal db-inbox">
      <NietGekoppeld email={lid.email} compact reden={reden} />
    </Kaart>
  );
}

export function InboxKaartSkelet() {
  return <KaartSkelet label="Inbox" regels={3} className="db-smal db-inbox" />;
}

/** De knop "Nieuwe mail" in de kop, alleen met een gekoppelde mailbox. */
export async function NieuweMailKnop({ lid }: { lid: Teamlid }) {
  const { cfg } = await mailboxVanVerzoek(lid);
  if (!cfg) return null;
  return (
    <Link className="db-knop" href="/mail?nieuw=1">
      Nieuwe mail
    </Link>
  );
}
