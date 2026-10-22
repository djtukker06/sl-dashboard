import Link from 'next/link';
import { accountGegevens, LOGO_SRC, railItems } from '@/lib/shell/rail';
import { RailNav } from './RailNav';

// De navigatierail voor alle React-pagina's binnen app/(app). Zelfde opbouw en classes
// als railHtml() in lib/shell/rail.ts (die de social-module gebruikt).
export function Rail({ email, metadata }: { email: string; metadata?: Record<string, unknown> | null }) {
  const acc = accountGegevens(email, metadata);
  return (
    <nav className="sl-rail" aria-label="Hoofdmenu">
      {/* Het logo brengt je altijd terug naar het dashboard. */}
      <Link className="sl-rail-logo" href="/" title="Studio Levant — Dashboard" aria-label="Naar het dashboard">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_SRC} alt="" width={36} height={37} />
      </Link>
      <RailNav items={railItems()} />
      <div className="sl-rail-foot">
        <details className="sl-account">
          <summary className="sl-account-knop" title={acc.email} aria-label="Account">
            <span className="sl-avatar">{acc.initialen}</span>
            <span className="sl-account-label">Account</span>
          </summary>
          <div className="sl-account-pop">
            <p className="sl-account-mail">{acc.email}</p>
            <a className="sl-account-link" href="/nieuw-wachtwoord">
              Wachtwoord wijzigen
            </a>
            <form method="post" action="/auth/uitloggen">
              <button type="submit" className="sl-account-link">
                Uitloggen
              </button>
            </form>
          </div>
        </details>
      </div>
    </nav>
  );
}
