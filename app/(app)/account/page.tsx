import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { mailboxStatus } from '@/lib/account/mailbox';
import type { MailboxStatus } from '@/lib/account/types';
import { AccountApp } from '@/components/account/AccountApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Account & mail · Studio Levant' };

// Account & mail: je eigen profiel (naam, initialen, kleur), je eigen mailbox koppelen en
// je wachtwoord wijzigen. Alles hier gaat alleen over de ingelogde gebruiker zelf.
// Accounts aanmaken kan niet in de app (alleen via scripts/teamlid-toevoegen.mjs).
export default async function AccountPage() {
  const lid = await vereisTeamlidPagina('/account');

  let status: MailboxStatus | null = null;
  try {
    status = await mailboxStatus(lid);
  } catch (e) {
    console.error('[account] mailboxstatus', (e as Error)?.message ?? e);
  }

  return (
    <AccountApp
      email={lid.email}
      rol={lid.rol}
      overgang={lid.overgang}
      profiel={{ naam: lid.profiel.naam, initialen: lid.profiel.initialen, kleur: lid.profiel.kleur }}
      mailbox={status}
    />
  );
}
