import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { huidigTeamlid } from '@/lib/auth/team';
import { mailboxStatus } from '@/lib/account/mailbox';
import { logFout } from '@/lib/log';
import { WelkomFlow, type WelkomMailbox } from '@/components/welkom/WelkomFlow';
import '../../public/shell/shell.css';
import '../(app)/app.css';
import '../(app)/agenda.css';
import '../(app)/account.css';
import './welkom.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Welkom · Studio Levant' };

// Welkomstflow bij de eerste login van een nieuw teamlid (bv. Bram): 0. tweestapsverificatie
// (verplicht als afdwingen aan staat), 1. profiel bevestigen, 2. inbox koppelen (overslaan
// kan), 3. klaar. app/(app)/layout.tsx stuurt hierheen zolang profiles.welkom_klaar_op leeg
// is (migratie 0022). Bewust buiten app/(app): geen rail. Wie klaar is (of zonder 0022) gaat
// direct door naar het dashboard.
export default async function WelkomPage() {
  const s = await huidigTeamlid();
  if (s.soort === 'anoniem') redirect('/login?next=/welkom');
  if (s.soort === 'geen_toegang') redirect('/geen-toegang');
  if (s.soort === 'storing') throw new Error('De toegangscontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.');
  if (s.soort === 'wachtwoord') redirect('/nieuw-wachtwoord');
  if (s.soort === 'tfa') {
    if (s.stap === 'uitdaging') redirect('/login/2fa?next=/welkom');
    if (s.sessie.welkomKlaar) redirect('/beveiliging/instellen');
    // Alleen de 2FA-stap: vóór de code werkt verder niets (geen bewijs, geen data).
    const p = s.sessie.profiel;
    return (
      <WelkomFlow
        email={s.sessie.email}
        profiel={{ naam: p.naam, initialen: p.initialen, kleur: p.kleur }}
        mailbox={{ kan: false, uitleg: '', gekoppeld: null }}
        tfa={{ toon: true, klaar: false, verplicht: true }}
      />
    );
  }
  const lid = s.lid;
  if (lid.welkomKlaar) redirect('/');

  let mailbox: WelkomMailbox = { kan: false, uitleg: 'Je mailbox koppelen lukt nu niet. Dat kan later via Account & mail.', gekoppeld: null };
  try {
    const s = await mailboxStatus(lid);
    if (s.bron === 'eigen' && s.eigen) mailbox = { kan: true, uitleg: '', gekoppeld: s.eigen.email };
    else if (!s.ingericht || !s.sleutel)
      mailbox = { kan: false, uitleg: 'Mail koppelen staat op de server nog uit. Dat kan later via Account & mail.', gekoppeld: null };
    else mailbox = { kan: true, uitleg: '', gekoppeld: null };
  } catch (e) {
    logFout('[welkom] mailboxstatus', e);
  }
  const heeftFactor = lid.tfa.factoren.length > 0;

  return (
    <WelkomFlow
      email={lid.email}
      profiel={{ naam: lid.profiel.naam, initialen: lid.profiel.initialen, kleur: lid.profiel.kleur }}
      mailbox={mailbox}
      tfa={{ toon: heeftFactor || (lid.tfa.migratie && !lid.overgang), klaar: heeftFactor, verplicht: false }}
    />
  );
}
