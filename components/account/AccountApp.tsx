'use client';

import { useId, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleKop } from '@/components/shell/ModuleKop';
import {
  IMAP_POORTEN,
  initialenUit,
  KLEUREN,
  SMTP_POORTEN,
  STANDAARD_MAILSERVER,
  valideerMailbox,
  valideerProfiel,
  type MailboxStatus,
  type ProfielInvoer
} from '@/lib/account/types';

type Melding = { soort: 'ok' | 'fout'; tekst: string } | null;

async function verstuur<T>(url: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
  } catch {
    throw new Error('Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  if (res.status === 401) {
    window.location.href = '/login?next=/account';
    throw new Error('Je bent uitgelogd.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Er ging iets mis.');
  return data as T;
}

const datumTijd = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }).format(new Date(iso))
    : '';

export function AccountApp({
  email,
  rol,
  overgang,
  profiel,
  mailbox
}: {
  email: string;
  rol: 'eigenaar' | 'lid';
  overgang: boolean;
  profiel: ProfielInvoer;
  mailbox: MailboxStatus | null;
}) {
  return (
    <div className="ac">
      <ModuleKop label="Account" titel="Account & mail" />
      <div className="ac-inhoud">
        <ProfielBlok email={email} rol={rol} overgang={overgang} start={profiel} />
        <MailboxBlok start={mailbox} />
        <section className="ac-blok" aria-labelledby="ac-beveiliging">
          <header className="ac-blok-kop">
            <h2 id="ac-beveiliging" className="ac-blok-titel">Beveiliging</h2>
            <p className="ac-blok-uitleg">
              Accounts maakt de eigenaar aan; zelf registreren kan niet. Alleen actieve teamleden kunnen inloggen en
              facturen, bonnetjes en klanten zien.
            </p>
          </header>
          <div className="ac-acties">
            <a className="db-knop" href="/nieuw-wachtwoord">
              Wachtwoord wijzigen
            </a>
            <form method="post" action="/auth/uitloggen">
              <button type="submit" className="db-knop">
                Uitloggen
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Profiel
// ---------------------------------------------------------------------------------
function ProfielBlok({ email, rol, overgang, start }: { email: string; rol: string; overgang: boolean; start: ProfielInvoer }) {
  const router = useRouter();
  const id = useId();
  const [p, setP] = useState(start);
  const [opgeslagen, setOpgeslagen] = useState(start);
  const [initialenZelf, setInitialenZelf] = useState(start.initialen !== initialenUit(start.naam));
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<Melding>(null);
  const gewijzigd = p.naam !== opgeslagen.naam || p.initialen !== opgeslagen.initialen || p.kleur !== opgeslagen.kleur;
  const kleuren = KLEUREN.some((k) => k.kleur === start.kleur) ? KLEUREN : [{ kleur: start.kleur, naam: 'Huidig' }, ...KLEUREN];

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    const v = valideerProfiel(p);
    if (!v.ok) {
      setMelding({ soort: 'fout', tekst: v.fout });
      return;
    }
    setBezig(true);
    setMelding(null);
    try {
      await verstuur('/api/account/profiel', 'PATCH', v.waarde);
      setP(v.waarde);
      setOpgeslagen(v.waarde);
      setMelding({ soort: 'ok', tekst: 'Profiel opgeslagen.' });
      router.refresh(); // rail en begroeting bijwerken
    } catch (err) {
      setMelding({ soort: 'fout', tekst: err instanceof Error ? err.message : 'Opslaan mislukt.' });
    } finally {
      setBezig(false);
    }
  }

  return (
    <section className="ac-blok" aria-labelledby={`${id}-titel`}>
      <header className="ac-blok-kop">
        <h2 id={`${id}-titel`} className="ac-blok-titel">Profiel</h2>
        <p className="ac-blok-uitleg">Zo zien je teamgenoten je bij taken, uploads en facturen.</p>
      </header>
      <form className="ac-profiel" onSubmit={opslaan}>
        <div className="ac-voorbeeld" aria-hidden="true">
          <span className="ac-avatar" style={{ '--sl-avatar-kleur': p.kleur } as CSSProperties}>
            {p.initialen || '?'}
          </span>
          <span className="ac-voorbeeld-tekst">
            <strong>{p.naam || 'Je naam'}</strong>
            <span>
              {email} · {rol === 'eigenaar' ? 'eigenaar' : 'teamlid'}
            </span>
          </span>
        </div>
        <div className="ac-velden">
          <label className="ag-label">
            Naam
            <input
              className="ag-veld"
              value={p.naam}
              maxLength={80}
              autoComplete="name"
              disabled={overgang}
              onChange={(e) => {
                const naam = e.target.value;
                setP((x) => ({ ...x, naam, initialen: initialenZelf ? x.initialen : initialenUit(naam).slice(0, 3) }));
              }}
            />
          </label>
          <label className="ag-label ac-smal">
            Initialen
            <input
              className="ag-veld"
              value={p.initialen}
              maxLength={3}
              autoCapitalize="characters"
              disabled={overgang}
              onChange={(e) => {
                setInitialenZelf(true);
                setP((x) => ({ ...x, initialen: e.target.value.toUpperCase().replace(/[^\p{L}]/gu, '').slice(0, 3) }));
              }}
            />
          </label>
        </div>
        <fieldset className="ac-kleuren" disabled={overgang}>
          <legend className="ac-legend">Kleur</legend>
          {kleuren.map((k) => (
            <label key={k.kleur} className="ac-kleur" title={k.naam}>
              <input
                type="radio"
                name={`${id}-kleur`}
                value={k.kleur}
                checked={p.kleur === k.kleur}
                onChange={() => setP((x) => ({ ...x, kleur: k.kleur }))}
              />
              <span className="ac-kleur-stip" style={{ background: k.kleur }} aria-hidden="true" />
              <span className="sr-only">{k.naam}</span>
            </label>
          ))}
        </fieldset>
        {overgang ? (
          <p className="ag-uitleg">Je profiel aanpassen kan zodra de teambeveiliging actief is (migratie 0021).</p>
        ) : (
          <div className="ac-acties">
            <button type="submit" className="db-knop db-knop-primair" disabled={bezig || !gewijzigd}>
              {bezig ? 'Opslaan…' : 'Profiel opslaan'}
            </button>
            <MeldingTekst melding={melding} />
          </div>
        )}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------------
// Mailbox
// ---------------------------------------------------------------------------------
type MailForm = {
  email: string;
  wachtwoord: string;
  fromName: string;
  handtekening: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
};

function naarForm(s: MailboxStatus | null): MailForm {
  const e = s?.eigen;
  return {
    email: e?.email ?? '',
    wachtwoord: '',
    fromName: e?.fromName ?? '',
    handtekening: e?.handtekening ?? '',
    imapHost: e?.imapHost ?? STANDAARD_MAILSERVER,
    imapPort: e?.imapPort ?? 993,
    smtpHost: e?.smtpHost ?? STANDAARD_MAILSERVER,
    smtpPort: e?.smtpPort ?? 465
  };
}

function MailboxBlok({ start }: { start: MailboxStatus | null }) {
  const router = useRouter();
  const [status, setStatus] = useState(start);
  const [f, setF] = useState<MailForm>(() => naarForm(start));
  const [bezig, setBezig] = useState<'' | 'opslaan' | 'ontkoppelen'>('');
  const [zeker, setZeker] = useState(false);
  const [melding, setMelding] = useState<Melding>(null);
  const zet = <K extends keyof MailForm>(k: K, v: MailForm[K]) => setF((x) => ({ ...x, [k]: v }));

  const eigen = status?.eigen ?? null;
  const uit = !status ? 'Je mailboxinstellingen konden niet worden geladen. Ververs de pagina.' : !status.ingericht
    ? 'Een eigen mailbox koppelen kan zodra de teambeveiliging actief is (voer supabase/UITVOEREN_0021_TEAM.sql uit).'
    : !status.sleutel
      ? 'Koppelen staat nog uit: de server mist MAIL_ENCRYPTION_KEY (zie README, "Mail per gebruiker").'
      : '';
  // Het opgeslagen wachtwoord geldt alleen voor precies dezelfde verbinding (adres, servers,
  // poorten); wijzig je daar iets, dan moet je het opnieuw invullen (de server eist dat ook).
  const gelijk = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();
  const zelfdeVerbinding = Boolean(
    eigen &&
      gelijk(eigen.email, f.email) &&
      gelijk(eigen.imapHost, f.imapHost) &&
      eigen.imapPort === f.imapPort &&
      gelijk(eigen.smtpHost, f.smtpHost) &&
      eigen.smtpPort === f.smtpPort
  );
  const wachtwoordBewaard = Boolean(eigen?.heeftWachtwoord && eigen.leesbaar && zelfdeVerbinding);
  const wachtwoordOpnieuw = Boolean(eigen?.heeftWachtwoord && eigen.leesbaar && !zelfdeVerbinding);

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    setMelding(null);
    const v = valideerMailbox(f);
    if (!v.ok) {
      setMelding({ soort: 'fout', tekst: v.fout });
      return;
    }
    if (!v.waarde.wachtwoord && !wachtwoordBewaard) {
      setMelding({
        soort: 'fout',
        tekst: wachtwoordOpnieuw ? 'Je wijzigt de server of het adres: vul je wachtwoord opnieuw in.' : 'Vul je wachtwoord in.'
      });
      return;
    }
    setBezig('opslaan');
    try {
      const s = await verstuur<MailboxStatus>('/api/account/mailbox', 'POST', v.waarde);
      setStatus(s);
      setF(naarForm(s));
      setMelding({ soort: 'ok', tekst: 'Verbinding gelukt. Je mailbox is gekoppeld.' });
      clearMailCache();
      router.refresh();
    } catch (err) {
      setMelding({ soort: 'fout', tekst: err instanceof Error ? err.message : 'Koppelen mislukt.' });
    } finally {
      setBezig('');
    }
  }

  async function ontkoppel() {
    setBezig('ontkoppelen');
    setMelding(null);
    try {
      const s = await verstuur<MailboxStatus>('/api/account/mailbox', 'DELETE');
      setStatus(s);
      setF(naarForm(s));
      setZeker(false);
      setMelding({ soort: 'ok', tekst: 'Je mailbox is ontkoppeld en het wachtwoord is verwijderd.' });
      clearMailCache();
      router.refresh();
    } catch (err) {
      setMelding({ soort: 'fout', tekst: err instanceof Error ? err.message : 'Ontkoppelen mislukt.' });
    } finally {
      setBezig('');
    }
  }

  return (
    <section className="ac-blok" id="mailbox" aria-labelledby="ac-mail-titel">
      <header className="ac-blok-kop">
        <h2 id="ac-mail-titel" className="ac-blok-titel">Mailbox</h2>
        <p className="ac-blok-uitleg">
          Mail is persoonlijk: Mail en de inbox op je dashboard tonen alleen je eigen mailbox. Je wachtwoord wordt na een
          geslaagde test versleuteld op de server bewaard en komt nooit terug in de browser.
        </p>
      </header>

      <div className={`ac-status is-${status?.bron ?? 'geen'}`} role="status">
        <span className="ac-status-stip" aria-hidden="true" />
        {status?.bron === 'eigen' && eigen ? (
          <span>
            Gekoppeld: <strong>{eigen.email}</strong>
            {eigen.geverifieerdOp ? ` · getest op ${datumTijd(eigen.geverifieerdOp)}` : ''}
          </span>
        ) : status?.bron === 'standaard' ? (
          <span>
            Je gebruikt de standaard-mailbox <strong>{status.standaardAdres}</strong> (uit de serverinstellingen). Koppel hieronder
            een eigen mailbox om die te vervangen.
          </span>
        ) : (
          <span>Nog geen mailbox gekoppeld.</span>
        )}
      </div>
      {eigen && !eigen.leesbaar && (
        <p className="ac-waarschuwing" role="alert">
          Je opgeslagen wachtwoord kan niet meer worden gelezen (de sleutel op de server is veranderd). Vul het opnieuw in.
        </p>
      )}

      {uit ? (
        <p className="ag-uitleg">{uit}</p>
      ) : (
        <form className="ac-mailform" onSubmit={opslaan} autoComplete="off">
          <div className="ag-velden-2">
            <label className="ag-label">
              E-mailadres
              <input
                className="ag-veld"
                type="email"
                inputMode="email"
                value={f.email}
                maxLength={320}
                placeholder="naam@studio-levant.nl"
                autoComplete="off"
                required
                onChange={(e) => zet('email', e.target.value)}
              />
            </label>
            <label className="ag-label">
              Wachtwoord
              <input
                className="ag-veld"
                type="password"
                value={f.wachtwoord}
                maxLength={500}
                required={!wachtwoordBewaard}
                placeholder={
                  wachtwoordBewaard
                    ? '•••••••• (opgeslagen)'
                    : wachtwoordOpnieuw
                      ? 'Opnieuw invullen (server of adres gewijzigd)'
                      : 'Wachtwoord van je mailbox'
                }
                autoComplete="new-password"
                onChange={(e) => zet('wachtwoord', e.target.value)}
              />
            </label>
          </div>
          <label className="ag-label">
            Afzendernaam
            <input
              className="ag-veld"
              value={f.fromName}
              maxLength={120}
              placeholder="Bijv. Mark · Studio Levant"
              onChange={(e) => zet('fromName', e.target.value)}
            />
          </label>
          <label className="ag-label">
            Handtekening (optioneel)
            <textarea className="ag-veld" rows={3} value={f.handtekening} maxLength={5000} onChange={(e) => zet('handtekening', e.target.value)} />
          </label>
          <details className="ac-geavanceerd">
            <summary>Geavanceerd: servers en poorten</summary>
            <p className="ag-uitleg">Voor Namecheap Private Email hoef je hier niets te veranderen.</p>
            <div className="ag-velden-2">
              <label className="ag-label">
                IMAP-server (ontvangen)
                <input className="ag-veld" value={f.imapHost} maxLength={253} onChange={(e) => zet('imapHost', e.target.value)} />
              </label>
              <label className="ag-label">
                IMAP-poort
                <select className="ag-veld" value={f.imapPort} onChange={(e) => zet('imapPort', Number(e.target.value))}>
                  {IMAP_POORTEN.map((p) => (
                    <option key={p} value={p}>
                      {p === 993 ? '993 (SSL)' : '143 (STARTTLS)'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ag-label">
                SMTP-server (verzenden)
                <input className="ag-veld" value={f.smtpHost} maxLength={253} onChange={(e) => zet('smtpHost', e.target.value)} />
              </label>
              <label className="ag-label">
                SMTP-poort
                <select className="ag-veld" value={f.smtpPort} onChange={(e) => zet('smtpPort', Number(e.target.value))}>
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
            <button type="submit" className="db-knop db-knop-primair" disabled={!!bezig}>
              {bezig === 'opslaan' ? 'Verbinding testen…' : 'Verbinding testen en opslaan'}
            </button>
            {eigen &&
              (zeker ? (
                <span className="ag-zeker">
                  <span>Mailbox ontkoppelen?</span>
                  <button type="button" className="db-knop ag-knop-gevaar" disabled={!!bezig} onClick={ontkoppel}>
                    {bezig === 'ontkoppelen' ? 'Bezig…' : 'Ja, ontkoppelen'}
                  </button>
                  <button type="button" className="db-knop" onClick={() => setZeker(false)}>
                    Nee
                  </button>
                </span>
              ) : (
                <button type="button" className="ag-link-knop ag-link-gevaar" onClick={() => setZeker(true)}>
                  Ontkoppelen
                </button>
              ))}
          </div>
          <MeldingTekst melding={melding} />
        </form>
      )}
    </section>
  );
}

/** Na koppelen/ontkoppelen: de mailcache van deze tab (badge, inbox-widget) weggooien. */
function clearMailCache() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('sl-mail-')) sessionStorage.removeItem(k);
  } catch {
    /* geen opslag */
  }
}

function MeldingTekst({ melding }: { melding: Melding }) {
  if (!melding) return <span aria-live="polite" />;
  return (
    <p className={melding.soort === 'fout' ? 'ag-fout' : 'ac-ok'} role={melding.soort === 'fout' ? 'alert' : 'status'}>
      {melding.tekst}
    </p>
  );
}
