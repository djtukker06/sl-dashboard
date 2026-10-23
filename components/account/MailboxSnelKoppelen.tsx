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

// Mailbox koppelen met één knop: e-mailadres + wachtwoord, de server bepaalt servers en
// poorten (lib/mail/providers.ts), test de verbinding en slaat versleuteld op. Eén component
// voor de welkomstflow, de lege staat van /mail, de dashboard-inbox en /account.
//   uitgebreid  /account: ook afzendernaam, handtekening en servers (ingeklapt)
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

async function stuur(body: unknown): Promise<MailboxStatus> {
  let res: Response;
  try {
    res = await fetch('/api/account/mailbox', {
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
  return data as MailboxStatus;
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
  knopTekst = 'Koppelen',
  onGekoppeld,
  onLater
}: {
  startEmail: string;
  eigen?: Eigen | null;
  uitgebreid?: boolean;
  knopTekst?: string;
  onGekoppeld?: (s: MailboxStatus) => void;
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
      const s = await stuur(body);
      setWachtwoord('');
      setHandmatig(false);
      if (s.eigen) {
        setEmail(s.eigen.email);
        setServers({ imapHost: s.eigen.imapHost, imapPort: s.eigen.imapPort, smtpHost: s.eigen.smtpHost, smtpPort: s.eigen.smtpPort });
      }
      setGelukt(`Gekoppeld: ${s.eigen?.email ?? v.waarde.email} ✓`);
      leegMailCache();
      if (onGekoppeld) onGekoppeld(s);
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
