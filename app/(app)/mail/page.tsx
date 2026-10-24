import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { magEnvMailbox } from '@/lib/mail/config';
import { inboxenDto, zichtbareMailboxen, type Mailbox } from '@/lib/mail/mailboxen';
import { ALLE_INBOXEN } from '@/lib/mail/zichtbaarheid';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { NietGekoppeld } from '@/components/mail/NietGekoppeld';
import { MailApp } from '@/components/mail/MailApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mail · Studio Levant' };

// Mail (Namecheap Private Email e.a.). De pagina controleert zelf de sessie; de mail zelf laadt
// de client via /api/mail/** (die elk ook zelf de sessie en de gekozen inbox controleren).
// Meerdere inboxen staan onder elkaar (eigen + met het team gedeeld), elk met eigen mappen.
//   ?mb=<inbox>|alle&map=<pad>&uid=<uid>   opent direct die inbox/map/dat bericht
//   ?nieuw=1                               opent direct een nieuwe mail
export default async function MailPage({
  searchParams
}: {
  searchParams: Promise<{ mb?: string; umb?: string; map?: string; uid?: string; nieuw?: string; aan?: string }>;
}) {
  const lid = await vereisTeamlidPagina('/mail');

  // Alleen inboxen die dit teamlid mag zien. Naar de client gaat geen wachtwoord of server.
  let lijst: Mailbox[] = [];
  try {
    lijst = (await zichtbareMailboxen(lid)).lijst;
  } catch (e) {
    console.error('[mail] inboxen ophalen mislukt', (e as Error)?.message ?? e);
  }
  if (!lijst.some((m) => m.cfg)) {
    return (
      <>
        <ModuleKop label="Inbox" titel="Mail" />
        <NietGekoppeld email={lid.email} reden={(await magEnvMailbox(lid)) ? 'instellen' : 'eigen'} />
      </>
    );
  }

  const sp = await searchParams;
  const uid = Number(sp.uid);
  const ids = new Set(lijst.map((m) => m.id));
  const startMb = typeof sp.mb === 'string' && (ids.has(sp.mb) || (sp.mb === ALLE_INBOXEN && lijst.length > 1)) ? sp.mb : null;
  return (
    <MailApp
      inboxen={inboxenDto(lijst)}
      startMb={startMb}
      startBerichtMb={typeof sp.umb === 'string' && ids.has(sp.umb) ? sp.umb : null}
      startMap={typeof sp.map === 'string' && sp.map.length < 300 ? sp.map : 'INBOX'}
      startUid={Number.isInteger(uid) && uid > 0 ? uid : null}
      nieuw={sp.nieuw === '1'}
      nieuwAan={typeof sp.aan === 'string' ? sp.aan.slice(0, 300) : ''}
    />
  );
}
