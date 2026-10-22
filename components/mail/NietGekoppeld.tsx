import { MAIL_ENV_VARS } from '@/lib/mail/types';

// Uitleg zolang er voor dit teamlid geen mailbox is. Bevat alleen namen, nooit waarden.
//   reden 'eigen'      gewone situatie: koppel je eigen mailbox via /account
//   reden 'instellen'  de eigenaar: ook de standaard-mailbox uit de env kan nog worden ingesteld
// Mail is persoonlijk: je ziet nooit de mailbox van een ander teamlid.
export function NietGekoppeld({
  compact = false,
  reden = 'eigen'
}: {
  compact?: boolean;
  reden?: 'instellen' | 'eigen';
}) {
  const tekst =
    'Mail is persoonlijk: je ziet alleen je eigen mailbox. Koppel hem in Account & mail; je wachtwoord wordt versleuteld op de server bewaard en komt nooit in de browser.';
  if (compact) {
    return (
      <div className="db-melding db-melding-setup">
        <p className="db-melding-titel">Je mailbox is nog niet gekoppeld</p>
        <p className="db-melding-tekst">{tekst}</p>
        <div className="db-melding-actie">
          <a className="db-knop" href="/account#mailbox">
            Koppel je mailbox
          </a>
        </div>
      </div>
    );
  }
  const verplicht = MAIL_ENV_VARS.filter((v) => v.verplicht);
  const optioneel = MAIL_ENV_VARS.filter((v) => !v.verplicht);
  return (
    <div className="ml-setup">
      <p className="db-label">Nog niet gekoppeld</p>
      <h2>Koppel je mailbox</h2>
      <p className="ml-setup-tekst">{tekst}</p>
      <p>
        <a className="db-knop db-knop-primair" href="/account#mailbox">
          Naar Account &amp; mail
        </a>
      </p>
      {reden === 'instellen' && (
        <>
          <p className="ml-setup-tekst ml-setup-klein">
            Als eigenaar kun je in plaats daarvan ook de standaard-mailbox van Studio Levant instellen met
            omgevingsvariabelen in Vercel (<em>Project Settings → Environment Variables</em>) en lokaal in{' '}
            <code className="ml-code">.env.local</code>; start de app daarna opnieuw.
          </p>
          <dl className="ml-setup-vars">
            {[...verplicht, ...optioneel].map((v) => (
              <div key={v.naam}>
                <dt>
                  <code className="ml-code">{v.naam}</code>
                  {v.verplicht && <span className="ml-setup-verplicht"> verplicht</span>}
                </dt>
                <dd>{v.uitleg}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
