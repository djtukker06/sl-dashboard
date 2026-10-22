import type { CSSProperties } from 'react';
import Link from 'next/link';
import { avatarStijl, LOGO_SRC, railItems, type RailAccount } from '@/lib/shell/rail';
import { RailNav } from './RailNav';

/** "--a:b;--c:d" → React-stijlobject (zelfde waarden als de HTML-rail). */
function alsStijl(css: string): CSSProperties | undefined {
  if (!css) return undefined;
  return Object.fromEntries(css.split(';').map((d) => d.split(':') as [string, string])) as CSSProperties;
}

// De navigatierail voor alle React-pagina's binnen app/(app). Zelfde opbouw en classes
// als railHtml() in lib/shell/rail.ts (die de social-module gebruikt).
export function Rail({ account }: { account: RailAccount }) {
  return (
    <nav className="sl-rail" aria-label="Hoofdmenu" data-gebruiker={account.id}>
      {/* Het logo brengt je altijd terug naar het dashboard. */}
      <Link className="sl-rail-logo" href="/" title="Studio Levant — Dashboard" aria-label="Naar het dashboard">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_SRC} alt="" width={36} height={37} />
      </Link>
      <RailNav items={railItems()} />
      <div className="sl-rail-foot">
        <details className="sl-account">
          <summary className="sl-account-knop" title={`${account.naam} · ${account.email}`} aria-label="Account">
            <span className="sl-avatar" style={alsStijl(avatarStijl(account.kleur))}>
              {account.initialen}
            </span>
            <span className="sl-account-label">Account</span>
          </summary>
          <div className="sl-account-pop">
            <p className="sl-account-naam">{account.naam}</p>
            <p className="sl-account-mail">{account.email}</p>
            <a className="sl-account-link" href="/account">
              Account &amp; mail
            </a>
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
