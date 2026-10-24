import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { mailboxenOverzicht, type MailboxenOverzicht } from '@/lib/mail/beheer';
import { AccountApp } from '@/components/account/AccountApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Account & mail · Studio Levant' };

// Account & mail: je eigen profiel (naam, initialen, kleur), je inboxen koppelen en beheren
// (meerdere, ook gedeeld met het team) en je wachtwoord wijzigen. Alles hier gaat alleen over
// de ingelogde gebruiker zelf. Accounts aanmaken kan niet in de app (alleen via
// scripts/teamlid-toevoegen.mjs).
export default async function AccountPage() {
  const lid = await vereisTeamlidPagina('/account');

  let mailboxen: MailboxenOverzicht | null = null;
  try {
    mailboxen = await mailboxenOverzicht(lid);
  } catch (e) {
    console.error('[account] inboxen', (e as Error)?.message ?? e);
  }

  return (
    <AccountApp
      email={lid.email}
      rol={lid.rol}
      overgang={lid.overgang}
      profiel={{ naam: lid.profiel.naam, initialen: lid.profiel.initialen, kleur: lid.profiel.kleur }}
      mailboxen={mailboxen}
    />
  );
}
