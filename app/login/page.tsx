import Link from 'next/link';
import { headers } from 'next/headers';
import { signIn } from '@/app/actions/login';
import { VervolgVeld } from '@/components/VervolgVeld';
import { veiligVervolg } from '@/lib/vervolg';
import { Openingsanimatie } from '@/components/login/Openingsanimatie';
import { IntroScript } from '@/components/login/IntroScript';

// Draait tijdens het parsen, vóór de kaart getekend wordt: beslist of de openingsanimatie
// speelt (klasse "sl-intro" op .login-wrap, zie components/login/Openingsanimatie.tsx). Eén keer
// per browsersessie; niet na een foutmelding of automatische uitlog (?error= / ?reden=), niet
// als je vanuit de app hier komt (uitloggen) en niet bij reduced motion. Laadt het JavaScript
// niet binnen 5 s, dan valt hij terug op het gewone formulier.
const INTRO_SCRIPT = `(function(){try{var d=document.currentScript&&document.currentScript.parentElement,q=new URLSearchParams(location.search);if(!d)return;if(sessionStorage.getItem('sl-intro'))return;sessionStorage.setItem('sl-intro','1');if(q.has('error')||q.has('reden'))return;if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;if(document.referrer&&new URL(document.referrer).origin===location.origin)return;d.classList.add('sl-intro');setTimeout(function(){if(!d.hasAttribute('data-intro-bezig'))d.classList.remove('sl-intro')},5000)}catch(e){}})();`;

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string; reden?: string }>;
}) {
  const { error, next, reden } = await searchParams;
  const vervolg = veiligVervolg(next);
  // De CSP (proxy.ts) staat alleen inline scripts met de nonce van dit verzoek toe.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    // suppressHydrationWarning: het inline script zet hier vóór de hydratie de klasse sl-intro.
    <div className="login-wrap" suppressHydrationWarning>
      <IntroScript code={INTRO_SCRIPT} nonce={nonce} />
      <Openingsanimatie />
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-banner" src="/brand/banner-licht.png" alt="Studio Levant" width={800} height={297} />
        <h1>Inloggen</h1>
        {reden === 'verlopen' && !error && (
          <p className="login-melding" role="status">
            Je bent automatisch uitgelogd (lang niet actief of langer dan 14 dagen ingelogd). Log opnieuw in.
          </p>
        )}
        {error && <div className="foutmelding">{error}</div>}
        <form action={signIn}>
          <VervolgVeld next={vervolg !== '/' ? vervolg : undefined} />
          <label>
            E-mailadres
            {/* Geen autoFocus: Openingsanimatie zet de focus, pas na de animatie. */}
            <input type="email" name="email" required autoComplete="username" maxLength={320} />
          </label>
          <label>
            Wachtwoord
            <input type="password" name="password" required autoComplete="current-password" />
          </label>
          <button type="submit" className="btn-primair">
            Inloggen
          </button>
        </form>
        <Link href="/wachtwoord-vergeten" className="login-link">
          Wachtwoord vergeten?
        </Link>
      </div>
    </div>
  );
}
