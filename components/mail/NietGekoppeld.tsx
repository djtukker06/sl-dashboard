import { MAIL_ENV_VARS } from '@/lib/mail/types';
import { MailboxSnelKoppelen } from '@/components/account/MailboxSnelKoppelen';

// Zolang er voor dit teamlid geen mailbox is: meteen koppelen met één knop (e-mailadres +
// wachtwoord), zonder eerst naar Account & mail te hoeven. Bevat alleen env-namen, nooit waarden.
//   reden 'eigen'      gewone situatie
//   reden 'instellen'  de eigenaar: ook de standaard-mailbox uit de env kan nog (ingeklapt)
// Mail is persoonlijk: je ziet nooit de mailbox van een ander teamlid.
export function NietGekoppeld({
  email,
  compact = false,
  reden = 'eigen'
}: {
  email: string;
  compact?: boolean;
  reden?: 'instellen' | 'eigen';
}) {
  if (compact) {
    return (
      <div className="db-melding db-melding-setup">
        <p className="db-melding-titel">Koppel je inbox</p>
        <MailboxSnelKoppelen startEmail={email} />
      </div>
    );
  }
  return (
    <div className="ml-setup">
      <p className="db-label">Nog niet gekoppeld</p>
      <h2>Koppel je inbox</h2>
      <p className="ml-setup-tekst">
        Mail is persoonlijk: je ziet alleen je eigen mailbox. Je wachtwoord wordt na een geslaagde test versleuteld op de
        server bewaard en komt nooit terug in de browser.
      </p>
      <MailboxSnelKoppelen startEmail={email} />
      {reden === 'instellen' && (
        <details className="ac-geavanceerd ml-setup-klein">
          <summary>Of: de standaard-mailbox via de serverinstellingen</summary>
          <p className="ml-setup-tekst ml-setup-klein">
            Als eigenaar kun je ook de standaard-mailbox van Studio Levant instellen met omgevingsvariabelen in Vercel (
            <em>Project Settings → Environment Variables</em>) en lokaal in <code className="ml-code">.env.local</code>;
            start de app daarna opnieuw.
          </p>
          <dl className="ml-setup-vars">
            {[...MAIL_ENV_VARS.filter((v) => v.verplicht), ...MAIL_ENV_VARS.filter((v) => !v.verplicht)].map((v) => (
              <div key={v.naam}>
                <dt>
                  <code className="ml-code">{v.naam}</code>
                  {v.verplicht && <span className="ml-setup-verplicht"> verplicht</span>}
                </dt>
                <dd>{v.uitleg}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
