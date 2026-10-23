import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { mailboxStatus } from '@/lib/account/mailbox';
import { WelkomFlow, type WelkomMailbox } from '@/components/welkom/WelkomFlow';
import '../../public/shell/shell.css';
import '../(app)/app.css';
import '../(app)/agenda.css';
import '../(app)/account.css';
import './welkom.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Welkom · Studio Levant' };

// Welkomstflow bij de eerste login van een nieuw teamlid (bv. Bram): 1. profiel bevestigen,
// 2. inbox koppelen (overslaan kan), 3. klaar. app/(app)/layout.tsx stuurt hierheen zolang
// profiles.welkom_klaar_op leeg is (migratie 0022). Bewust buiten app/(app): geen rail.
// Wie klaar is (of zonder 0022) gaat direct door naar het dashboard.
export default async function WelkomPage() {
  const lid = await vereisTeamlidPagina('/welkom');
  if (lid.welkomKlaar) redirect('/');

  let mailbox: WelkomMailbox = { kan: false, uitleg: 'Je mailbox koppelen lukt nu niet. Dat kan later via Account & mail.', gekoppeld: null };
  try {
    const s = await mailboxStatus(lid);
    if (s.bron === 'eigen' && s.eigen) mailbox = { kan: true, uitleg: '', gekoppeld: s.eigen.email };
    else if (!s.ingericht || !s.sleutel)
      mailbox = { kan: false, uitleg: 'Mail koppelen staat op de server nog uit. Dat kan later via Account & mail.', gekoppeld: null };
    else mailbox = { kan: true, uitleg: '', gekoppeld: null };
  } catch (e) {
    console.error('[welkom] mailboxstatus', (e as Error)?.message ?? e);
  }

  return (
    <WelkomFlow
      email={lid.email}
      profiel={{ naam: lid.profiel.naam, initialen: lid.profiel.initialen, kleur: lid.profiel.kleur }}
      mailbox={mailbox}
    />
  );
}
