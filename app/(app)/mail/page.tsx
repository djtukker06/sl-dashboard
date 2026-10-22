import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { mailConfig } from '@/lib/mail/config';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { NietGekoppeld } from '@/components/mail/NietGekoppeld';
import { MailApp } from '@/components/mail/MailApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mail · Studio Levant' };

// Mail (Namecheap Private Email). De pagina controleert zelf de sessie; de mail zelf laadt de
// client via /api/mail/** (die elk ook zelf de sessie controleren).
//   ?map=<pad>&uid=<uid>   opent direct dat bericht (bv. vanaf het dashboard)
//   ?nieuw=1               opent direct een nieuwe mail
export default async function MailPage({
  searchParams
}: {
  searchParams: Promise<{ map?: string; uid?: string; nieuw?: string; aan?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/mail');

  const cfg = mailConfig();
  if (!cfg) {
    return (
      <>
        <ModuleKop label="Inbox" titel="Mail" />
        <NietGekoppeld />
      </>
    );
  }

  const sp = await searchParams;
  const uid = Number(sp.uid);
  return (
    <MailApp
      account={cfg.user}
      handtekening={cfg.handtekening}
      startMap={typeof sp.map === 'string' && sp.map.length < 300 ? sp.map : 'INBOX'}
      startUid={Number.isInteger(uid) && uid > 0 ? uid : null}
      nieuw={sp.nieuw === '1'}
      nieuwAan={typeof sp.aan === 'string' ? sp.aan.slice(0, 300) : ''}
    />
  );
}
