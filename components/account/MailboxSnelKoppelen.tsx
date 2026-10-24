'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IMAP_POORTEN,
  SMTP_POORTEN,
  STANDAARD_MAILSERVER,
  valideerMailbox,
  type MailboxStatus
} from '@/lib/account/types';
import { vasteInstellingen } from '@/lib/mail/providers';
import { MAILBOX_KLEUREN, standaardLabel } from '@/lib/mail/zichtbaarheid';

// Mailbox koppelen met één knop: e-mailadres + wachtwoord, de server bepaalt servers en
// poorten (lib/mail/providers.ts), test de verbinding en slaat versleuteld op. Eén component
// voor de welkomstflow, de lege staat van /mail, de dashboard-inbox en /account.
//   uitgebreid  /account: ook afzendernaam, handtekening en servers (ingeklapt)
//   inbox       /account (meerdere inboxen): ook naam, kleur en "Alleen ik / Hele team";
//               stuurt naar /api/account/mailboxen (een extra inbox i.p.v. de eerste)
//   vastEmail   het adres staat vast (wachtwoord vernieuwen van een bestaande inbox)
//   onGekoppeld na succes (bv. de welkomstflow gaat door naar de volgende stap)
//   onLater     toont de link "Later doen"

type Eigen = NonNullable<MailboxStatus['eigen']>;
type Servers = { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number };

class KoppelFout extends Error {
  code: string;
  constructor(message: string, code = '') {
    super(message);
    this.code = code;
  }
}

type KoppelAntwoord = { eigen?: { email?: string } | null; email?: string };

async function stuur(url: string, body: unknown): Promise<KoppelAntwoord> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    });
  } catch {
    throw new KoppelFout('Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new KoppelFout('Je bent uitgelogd.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new KoppelFout((data && data.error) || 'Koppelen is niet gelukt. Probeer het opnieuw.', data?.code ?? '');
  return (data ?? {}) as KoppelAntwoord;
}

/** Na koppelen: de mailcache van deze tab (rail-badge, inbox-widget) weggooien. */
export function leegMailCache() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('sl-mail-')) sessionStorage.removeItem(k);
  } catch {
    /* geen opslag */
  }
}

const gelijk = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();

export function MailboxSnelKoppelen({
  startEmail,
  eigen = null,
  uitgebreid = false,
  inbox = null,
  vastEmail = false,
  knopTekst = 'Koppelen',
  onGekoppeld,
  onLater
}: {
  startEmail: string;
  eigen?: Eigen | null;
  uitgebreid?: boolean;
  /** Meerdere inboxen: naam, kleur en zichtbaarheid kiezen (standaardkleur, delen mogelijk?). */
  inbox?: { standaardKleur: string; magDelen: boolean } | null;
  vastEmail?: boolean;
  knopTekst?: string;
  onGekoppeld?: (adres: string, data: unknown) => void;
  onLater?: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [email, setEmail] = useState(eigen?.email ?? startEmail);
  const [wachtwoord, setWachtwoord] = useState('');
  const [fromName, setFromName] = useState(eigen?.fromName ?? '');
  const [handtekening, setHandtekening] = useState(eigen?.handtekening ?? '');
  const [servers, setServers] = useState<Servers>(() => ({
    imapHost: eigen?.imapHost ?? STANDAARD_MAILSERVER,
    imapPort: eigen?.imapPort ?? 993,
    smtpHost: eigen?.smtpHost ?? STANDAARD_MAILSERVER,
    smtpPort: eigen?.smtpPort ?? 465
  }));
  // Zelf servers invullen: alleen als de gebruiker dat openklapt, of als de server de
  // provider niet herkent. Anders bepaalt de server ze uit het adres.
  const [handmatig, setHandmatig] = useState(false);
  const [label, setLabel] = useState('');
  const [kleur, setKleur] = useState(inbox?.standaardKleur ?? MAILBOX_KLEUREN[0].kleur);
  const [team, setTeam] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const [gelukt, setGelukt] = useState('');

  // Ongewijzigd adres van een bestaande koppeling: dezelfde servers meesturen, zodat een
  // leeg wachtwoord het bewaarde wachtwoord houdt (de server eist dezelfde verbinding).
  const zelfdeAdres = Boolean(eigen && gelijk(eigen.email, email));
  const stuurServers = handmatig || zelfdeAdres;
  const wachtwoordBewaard = Boolean(
    eigen?.heeftWachtwoord &&
      eigen.leesbaar &&
      zelfdeAdres &&
      gelijk(eigen.imapHost, servers.imapHost) &&
      eigen.imapPort === servers.imapPort &&
      gelijk(eigen.smtpHost, servers.smtpHost) &&
      eigen.smtpPort === servers.smtpPort
  );

  const provider = vasteInstellingen(email);
  const providerHint =
    provider.soort === 'microsoft'
      ? 'Outlook en Hotmail laten koppelen met alleen een wachtwoord niet meer toe.'
      : provider.soort === 'bekend' && provider.provider === 'gmail'
        ? 'Gmail: gebruik een app-wachtwoord (Google-account → Beveiliging → App-wachtwoorden).'
        : provider.soort === 'bekend' && provider.provider === 'icloud'
          ? 'iCloud: gebruik een app-specifiek wachtwoord (Apple ID → Inloggen en beveiliging).'
          : '';

  async function koppel(e: React.FormEvent) {
    e.preventDefault();
    setFout('');
    setGelukt('');
    const body: Record<string, unknown> = { email, wachtwoord };
    if (stuurServers) Object.assign(body, servers);
    if (uitgebreid) Object.assign(body, { fromName, handtekening });
    if (inbox && !vastEmail) Object.assign(body, { label: label.trim() || standaardLabel(email.trim()), kleur, zichtbaarheid: team ? 'team' : 'prive' });
    const v = valideerMailbox(body);
    if (!v.ok) {
      setFout(v.fout);
      return;
    }
    if (!wachtwoord && !wachtwoordBewaard) {
      setFout('Vul het wachtwoord van je mailbox in.');
      return;
    }
    setBezig(true);
    try {
      const s = await stuur(inbox ? '/api/account/mailboxen' : '/api/account/mailbox', body);
      setWachtwoord('');
      setHandmatig(false);
      const eigenNa = (s as { eigen?: Eigen | null }).eigen;
      if (eigenNa) {
        setEmail(eigenNa.email);
        setServers({ imapHost: eigenNa.imapHost, imapPort: eigenNa.imapPort, smtpHost: eigenNa.smtpHost, smtpPort: eigenNa.smtpPort });
      }
      const adres = eigenNa?.email ?? s.email ?? v.waarde.email;
      setGelukt(`Gekoppeld: ${adres} ✓`);
      leegMailCache();
      if (onGekoppeld) onGekoppeld(adres, s);
      else router.refresh();
    } catch (err) {
      const f = err instanceof KoppelFout ? err : new KoppelFout('Koppelen is niet gelukt. Probeer het opnieuw.');
      if (f.code === 'provider_onbekend') setHandmatig(true);
      setFout(f.message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <form className="ac-mailform ac-snel" onSubmit={koppel} autoComplete="off">
      <div className="ag-velden-2 ac-snel-velden">
        <label className="ag-label">
          E-mailadres
          <input
            className="ag-veld"
            type="email"
            inputMode="email"
            value={email}
            maxLength={320}
            placeholder="naam@studio-levant.nl"
            autoComplete="off"
            required
            readOnly={vastEmail}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="ag-label">
          Wachtwoord van je mailbox
          <input
            className="ag-veld"
            type="password"
            value={wachtwoord}
            maxLength={500}
            required={!wachtwoordBewaard}
            placeholder={wachtwoordBewaard ? '•••••••• (opgeslagen)' : 'Wachtwoord van je mailbox'}
            autoComplete="new-password"
            aria-describedby={`${id}-uitleg`}
            onChange={(e) => setWachtwoord(e.target.value)}
          />
        </label>
      </div>
      <p className="ac-snel-uitleg" id={`${id}-uitleg`}>
        Het wachtwoord van je mailbox, niet van dit dashboard.{providerHint ? ` ${providerHint}` : ''}
      </p>

      {inbox && !vastEmail && (
        <div className="ac-inbox-instellingen">
          <label className="ag-label">
            Naam in Mail
            <input
              className="ag-veld"
              value={label}
              maxLength={40}
              placeholder={email.includes('@') ? standaardLabel(email.trim()) : 'Bijvoorbeeld Info of Daniel'}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <fieldset className="ac-kleuren-veld">
            <legend className="ag-label">Kleur</legend>
            <div className="ac-kleuren ac-kleuren-klein">
              {MAILBOX_KLEUREN.map((k) => (
                <label key={k.kleur} className="ac-kleur" title={k.naam}>
                  <input type="radio" name={`${id}-kleur`} value={k.kleur} checked={kleur === k.kleur} onChange={() => setKleur(k.kleur)} />
                  <span className="ac-kleur-stip" style={{ background: k.kleur }} />
                  <span className="sr-only">{k.naam}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {inbox.magDelen && (
            <fieldset className="ac-zicht">
              <legend className="ag-label">Wie ziet deze inbox?</legend>
              <div className="ac-zicht-keuze" role="radiogroup">
                <label className={`ac-zicht-optie${!team ? ' is-aan' : ''}`}>
                  <input type="radio" name={`${id}-zicht`} checked={!team} onChange={() => setTeam(false)} />
                  Alleen ik
                </label>
                <label className={`ac-zicht-optie${team ? ' is-aan' : ''}`}>
                  <input type="radio" name={`${id}-zicht`} checked={team} onChange={() => setTeam(true)} />
                  Hele team
                </label>
              </div>
              <p className="ac-snel-uitleg">
                {team
                  ? 'Alle actieve teamleden zien deze inbox in Mail en kunnen er vanaf mailen. Het wachtwoord blijft versleuteld op de server.'
                  : 'Alleen jij ziet deze inbox.'}
              </p>
            </fieldset>
          )}
        </div>
      )}

      {uitgebreid && (
        <details className="ac-geavanceerd">
          <summary>Afzendernaam en handtekening</summary>
          <div className="ac-mailform">
            <label className="ag-label">
              Afzendernaam
              <input
                className="ag-veld"
                value={fromName}
                maxLength={120}
                placeholder="Standaard je naam"
                onChange={(e) => setFromName(e.target.value)}
              />
            </label>
            <label className="ag-label">
              Handtekening (optioneel)
              <textarea
                className="ag-veld"
                rows={3}
                value={handtekening}
                maxLength={5000}
                onChange={(e) => setHandtekening(e.target.value)}
              />
            </label>
          </div>
        </details>
      )}

      <details
        className="ac-geavanceerd"
        open={handmatig}
        onToggle={(e) => setHandmatig((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>Andere provider? Vul servers in</summary>
        <div className="ag-velden-2">
          <label className="ag-label">
            IMAP-server (ontvangen)
            <input
              className="ag-veld"
              value={servers.imapHost}
              maxLength={253}
              onChange={(e) => setServers((s) => ({ ...s, imapHost: e.target.value }))}
            />
          </label>
          <label className="ag-label">
            IMAP-poort
            <select
              className="ag-veld"
              value={servers.imapPort}
              onChange={(e) => setServers((s) => ({ ...s, imapPort: Number(e.target.value) }))}
            >
              {IMAP_POORTEN.map((p) => (
                <option key={p} value={p}>
                  {p === 993 ? '993 (SSL)' : '143 (STARTTLS)'}
                </option>
              ))}
            </select>
          </label>
          <label className="ag-label">
            SMTP-server (verzenden)
            <input
              className="ag-veld"
              value={servers.smtpHost}
              maxLength={253}
              onChange={(e) => setServers((s) => ({ ...s, smtpHost: e.target.value }))}
            />
          </label>
          <label className="ag-label">
            SMTP-poort
            <select
              className="ag-veld"
              value={servers.smtpPort}
              onChange={(e) => setServers((s) => ({ ...s, smtpPort: Number(e.target.value) }))}
            >
              {SMTP_POORTEN.map((p) => (
                <option key={p} value={p}>
                  {p === 465 ? '465 (SSL)' : '587 (STARTTLS)'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <div className="ac-acties">
        <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
          {bezig ? 'Verbinding testen…' : knopTekst}
        </button>
        {onLater && (
          <button type="button" className="ag-link-knop" onClick={onLater} disabled={bezig}>
            Later doen
          </button>
        )}
      </div>
      {fout && (
        <p className="ag-fout" role="alert">
          {fout}
        </p>
      )}
      {gelukt && !fout && (
        <p className="ac-ok" role="status">
          {gelukt}
        </p>
      )}
    </form>
  );
}
