import { MAIL_ENV_VARS } from '@/lib/mail/types';

// Uitleg zolang de mailkoppeling niet is ingesteld: welke omgevingsvariabelen nodig zijn.
// Bevat alleen namen, nooit waarden.
export function NietGekoppeld({ compact = false }: { compact?: boolean }) {
  const verplicht = MAIL_ENV_VARS.filter((v) => v.verplicht);
  const optioneel = MAIL_ENV_VARS.filter((v) => !v.verplicht);
  if (compact) {
    return (
      <div className="db-melding db-melding-setup">
        <p className="db-melding-titel">Mail is nog niet gekoppeld</p>
        <p className="db-melding-tekst">
          Zet <code className="ml-code">MAIL_USER</code> en <code className="ml-code">MAIL_PASSWORD</code> in de
          omgevingsvariabelen (Vercel en <code className="ml-code">.env.local</code>). Server en poorten staan al goed
          voor Private Email.
        </p>
        <div className="db-melding-actie">
          <a className="db-knop" href="/mail">
            Uitleg bekijken
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="ml-setup">
      <p className="db-label">Nog niet gekoppeld</p>
      <h2>Koppel de mailbox van Studio Levant</h2>
      <p className="ml-setup-tekst">
        De inbox leest en verstuurt mail rechtstreeks via Namecheap Private Email (IMAP en SMTP met SSL). Zet de
        volgende omgevingsvariabelen in Vercel (<em>Project Settings → Environment Variables</em>) en lokaal in{' '}
        <code className="ml-code">.env.local</code>, en start de app daarna opnieuw.
      </p>
      <dl className="ml-setup-vars">
        {verplicht.map((v) => (
          <div key={v.naam}>
            <dt>
              <code className="ml-code">{v.naam}</code> <span className="ml-setup-verplicht">verplicht</span>
            </dt>
            <dd>{v.uitleg}</dd>
          </div>
        ))}
        {optioneel.map((v) => (
          <div key={v.naam}>
            <dt>
              <code className="ml-code">{v.naam}</code>
            </dt>
            <dd>{v.uitleg}</dd>
          </div>
        ))}
      </dl>
      <p className="ml-setup-tekst ml-setup-klein">
        Server en poorten hoeven alleen als ze afwijken: standaard is het <code className="ml-code">mail.privateemail.com</code>{' '}
        (IMAP 993, SMTP 465). Het wachtwoord staat alleen op de server en komt nooit in de browser. Zie ook de README,
        sectie &ldquo;Mail&rdquo;.
      </p>
    </div>
  );
}
