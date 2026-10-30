import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { huidigTeamlid } from '@/lib/auth/team';
import { veiligVervolg } from '@/lib/vervolg';
import { TfaCode } from '@/components/beveiliging/TfaCode';
import '../login.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Code invullen · Studio Levant' };

// Tweede stap van inloggen voor wie tweestapsverificatie heeft: de 6 cijfers uit de
// authenticator-app. Zonder sessie terug naar /login; wie al op aal2 zit of geen factor heeft,
// gaat meteen door.
export default async function TweestapsPagina({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const vervolg = veiligVervolg(next);
  const s = await huidigTeamlid();
  if (s.soort === 'anoniem') redirect('/login');
  if (s.soort === 'geen_toegang') redirect('/geen-toegang');
  if (s.soort === 'lid') redirect(vervolg);
  if (s.soort === 'wachtwoord') redirect('/nieuw-wachtwoord');
  if (s.soort === 'tfa' && s.stap === 'instellen') redirect(s.sessie.welkomKlaar ? `/beveiliging/instellen${next ? `?next=${encodeURIComponent(vervolg)}` : ''}` : '/welkom');
  if (s.soort === 'storing') throw new Error('De toegangscontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.');

  const factoren = s.soort === 'tfa' ? s.sessie.tfa.factoren.map((f) => ({ id: f.id, naam: f.naam })) : [];

  return (
    <div className="login-wrap">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-banner" src="/brand/banner-licht.png" alt="Studio Levant" width={800} height={297} />
        <h1>Tweestapsverificatie</h1>
        <p className="section-hint" style={{ marginBottom: 20 }}>
          Open je authenticator-app en vul de code van 6 cijfers in voor Studio Levant.
        </p>
        <TfaCode vervolg={vervolg} factoren={factoren} />
        <p className="section-hint" style={{ marginTop: 20 }}>
          Telefoon kwijt? Gebruik je tweede apparaat (bv. je wachtwoordmanager), of vraag de eigenaar om je
          tweestapsverificatie te resetten.
        </p>
        <form method="post" action="/auth/uitloggen">
          <button type="submit" className="login-link login-link-knop">
            Uitloggen
          </button>
        </form>
      </div>
    </div>
  );
}
