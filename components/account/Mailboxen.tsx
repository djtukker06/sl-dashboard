'use client';

import { useId, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { EigenInbox, MailboxenOverzicht } from '@/lib/mail/beheer';
import { MAILBOX_KLEUREN, volgendeKleur } from '@/lib/mail/zichtbaarheid';
import { leegMailCache, MailboxSnelKoppelen } from './MailboxSnelKoppelen';

// Account & mail › Inboxen: al je gekoppelde inboxen onder elkaar (kleur, naam, adres),
// per inbox "Alleen ik / Hele team", volgorde, bewerken en ontkoppelen. Met één knop een
// extra inbox koppelen (e-mailadres + wachtwoord). Inboxen die een ander met het team deelt
// staan er alleen-lezen bij. Wachtwoorden komen nooit in de browser.

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
    ? new Intl.DateTimeFormat('nl-NL', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Amsterdam'
      }).format(new Date(iso))
    : '';

export function Mailboxen({ start, email }: { start: MailboxenOverzicht | null; email: string }) {
  const router = useRouter();
  const [o, setO] = useState(start);
  const [koppelen, setKoppelen] = useState(false);
  const [melding, setMelding] = useState<Melding>(null);
  const [bezig, setBezig] = useState<string | null>(null);

  const ververs = async () => {
    try {
      setO(await verstuur<MailboxenOverzicht>('/api/account/mailboxen', 'GET'));
    } catch {
      /* laat de oude stand staan */
    }
  };

  const bijgewerkt = (nieuw: MailboxenOverzicht, tekst?: string) => {
    setO(nieuw);
    leegMailCache();
    if (tekst) setMelding({ soort: 'ok', tekst });
    router.refresh();
  };

  const uit = !o
    ? 'Je inboxen konden niet worden geladen. Ververs de pagina.'
    : o.opslag === 'geen'
      ? 'Een eigen inbox koppelen kan zodra de teambeveiliging actief is (voer supabase/UITVOEREN_0021_TEAM.sql uit).'
      : !o.sleutel
        ? 'Koppelen staat nog uit: de server mist MAIL_ENCRYPTION_KEY (zie README, "Mail per gebruiker").'
        : '';
  const nieuw = o?.opslag === 'nieuw';
  const vol = o ? o.eigen.length >= o.max && nieuw : false;

  async function zichtbaarheid(i: EigenInbox, team: boolean) {
    setBezig(i.id);
    setMelding(null);
    try {
      bijgewerkt(
        await verstuur<MailboxenOverzicht>(`/api/account/mailboxen/${i.id}`, 'PATCH', { zichtbaarheid: team ? 'team' : 'prive' }),
        team ? `${i.label} is nu zichtbaar voor het hele team.` : `${i.label} is nu alleen voor jou.`
      );
    } catch (e) {
      setMelding({ soort: 'fout', tekst: e instanceof Error ? e.message : 'Opslaan mislukt.' });
    } finally {
      setBezig(null);
    }
  }

  async function verschuif(index: number, richting: -1 | 1) {
    if (!o) return;
    const ids = o.eigen.map((i) => i.id);
    const doel = index + richting;
    if (doel < 0 || doel >= ids.length) return;
    [ids[index], ids[doel]] = [ids[doel], ids[index]];
    setBezig('volgorde');
    try {
      bijgewerkt(await verstuur<MailboxenOverzicht>('/api/account/mailboxen', 'PATCH', { volgorde: ids }));
    } catch (e) {
      setMelding({ soort: 'fout', tekst: e instanceof Error ? e.message : 'Opslaan mislukt.' });
    } finally {
      setBezig(null);
    }
  }

  return (
    <section className="ac-blok" id="mailbox" aria-labelledby="ac-mail-titel">
      <header className="ac-blok-kop">
        <h2 id="ac-mail-titel" className="ac-blok-titel">
          Inboxen
        </h2>
        <p className="ac-blok-uitleg">
          Koppel één of meer inboxen; ze staan in Mail onder elkaar, elk met een eigen kleur. Een inbox op{' '}
          <strong>Hele team</strong> (bijvoorbeeld info@) zien alle actieve teamleden. Je wachtwoord wordt na een geslaagde
          test versleuteld op de server bewaard en komt nooit terug in de browser.
        </p>
      </header>

      {uit ? (
        <p className="ag-uitleg">{uit}</p>
      ) : (
        o && (
          <>
            {o.opslag === 'oud' && (
              <p className="ac-waarschuwing ac-waarschuwing-zacht">
                Meerdere inboxen en delen met het team kan zodra migratie 0026 is uitgevoerd (supabase/UITVOEREN_0026.sql). Tot
                die tijd werkt je ene inbox gewoon zoals je gewend bent.
              </p>
            )}

            {o.eigen.length === 0 && !o.standaard && <p className="ag-uitleg">Nog geen inbox gekoppeld.</p>}

            {o.eigen.length > 0 && (
              <ul className="ac-inboxen" aria-label="Jouw inboxen">
                {o.eigen.map((i, idx) => (
                  <InboxKaart
                    key={`${i.id}|${i.geverifieerdOp ?? ''}`}
                    inbox={i}
                    email={email}
                    nieuw={nieuw}
                    bezig={bezig}
                    eerste={idx === 0}
                    laatste={idx === o.eigen.length - 1}
                    onZichtbaarheid={(team) => zichtbaarheid(i, team)}
                    onOmhoog={() => verschuif(idx, -1)}
                    onOmlaag={() => verschuif(idx, 1)}
                    onBijgewerkt={(nieuwO, tekst) => bijgewerkt(nieuwO, tekst)}
                    onVervers={ververs}
                    onFout={(tekst) => setMelding({ soort: 'fout', tekst })}
                  />
                ))}
              </ul>
            )}

            {o.standaard && (
              <div className="ac-status is-standaard" role="status">
                <span className="ac-status-stip" aria-hidden="true" />
                <span>
                  Standaard-mailbox uit de serverinstellingen: <strong>{o.standaard.email}</strong> (alleen voor jou zichtbaar).
                </span>
              </div>
            )}

            {koppelen ? (
              <div className="ac-koppelen">
                <h3 className="ac-sub">Inbox koppelen</h3>
                <MailboxSnelKoppelen
                  startEmail={o.eigen.length || o.standaard ? '' : email}
                  uitgebreid
                  inbox={{ standaardKleur: volgendeKleur(o.eigen.map((i) => i.kleur)), magDelen: nieuw }}
                  knopTekst="Verbinding testen en koppelen"
                  onGekoppeld={(adres, data) => {
                    const ov = (data as { overzicht?: MailboxenOverzicht }).overzicht;
                    setKoppelen(false);
                    if (ov) bijgewerkt(ov, `Gekoppeld: ${adres} ✓`);
                    else {
                      void ververs();
                      setMelding({ soort: 'ok', tekst: `Gekoppeld: ${adres} ✓` });
                      router.refresh();
                    }
                  }}
                />
                <div className="ac-acties">
                  <button type="button" className="ag-link-knop" onClick={() => setKoppelen(false)}>
                    Annuleren
                  </button>
                </div>
              </div>
            ) : (
              <div className="ac-acties">
                {!vol && (nieuw || o.eigen.length === 0) && (
                  <button
                    type="button"
                    className="db-knop db-knop-primair"
                    onClick={() => {
                      setKoppelen(true);
                      setMelding(null);
                    }}
                  >
                    + Inbox koppelen
                  </button>
                )}
                {vol && <p className="ag-uitleg">Je hebt het maximum van {o.max} inboxen bereikt.</p>}
              </div>
            )}

            {o.gedeeld.length > 0 && (
              <div className="ac-gedeeld">
                <h3 className="ac-sub">Gedeeld met het team</h3>
                <ul className="ac-inboxen" aria-label="Inboxen van anderen, gedeeld met het team">
                  {o.gedeeld.map((i) => (
                    <li key={i.id} className="ac-inbox ac-inbox-gedeeld" style={{ '--ml-inbox-kleur': i.kleur } as CSSProperties}>
                      <div className="ac-inbox-kop">
                        <span className="ac-inbox-stip" aria-hidden="true" />
                        <span className="ac-inbox-tekst">
                          <strong>{i.label}</strong>
                          <span>{i.email}</span>
                        </span>
                        <span className="ac-inbox-tag">door {i.eigenaarNaam}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )
      )}
      <MeldingTekst melding={melding} />
    </section>
  );
}

function InboxKaart({
  inbox: i,
  email,
  nieuw,
  bezig,
  eerste,
  laatste,
  onZichtbaarheid,
  onOmhoog,
  onOmlaag,
  onBijgewerkt,
  onVervers,
  onFout
}: {
  inbox: EigenInbox;
  email: string;
  nieuw: boolean;
  bezig: string | null;
  eerste: boolean;
  laatste: boolean;
  onZichtbaarheid: (team: boolean) => void;
  onOmhoog: () => void;
  onOmlaag: () => void;
  onBijgewerkt: (o: MailboxenOverzicht, tekst?: string) => void;
  onVervers: () => Promise<void>;
  onFout: (tekst: string) => void;
}) {
  const id = useId();
  const [modus, setModus] = useState<'' | 'bewerken' | 'wachtwoord' | 'ontkoppelen'>(i.leesbaar ? '' : 'wachtwoord');
  const [label, setLabel] = useState(i.label);
  const [kleur, setKleur] = useState(i.kleur);
  const [fromName, setFromName] = useState(i.fromName);
  const [handtekening, setHandtekening] = useState(i.handtekening);
  const [bezigHier, setBezigHier] = useState(false);
  const team = i.zichtbaarheid === 'team';

  async function bewaar(e: React.FormEvent) {
    e.preventDefault();
    setBezigHier(true);
    try {
      onBijgewerkt(
        await verstuur<MailboxenOverzicht>(`/api/account/mailboxen/${i.id}`, 'PATCH', { label, kleur, fromName, handtekening }),
        `${label} is bijgewerkt.`
      );
      setModus('');
    } catch (err) {
      onFout(err instanceof Error ? err.message : 'Opslaan mislukt.');
    } finally {
      setBezigHier(false);
    }
  }

  async function ontkoppel() {
    setBezigHier(true);
    try {
      onBijgewerkt(
        await verstuur<MailboxenOverzicht>(`/api/account/mailboxen/${i.id}`, 'DELETE'),
        `${i.label} is ontkoppeld en het wachtwoord is verwijderd.`
      );
    } catch (err) {
      onFout(err instanceof Error ? err.message : 'Ontkoppelen mislukt.');
      setBezigHier(false);
    }
  }

  return (
    <li className="ac-inbox" style={{ '--ml-inbox-kleur': i.kleur } as CSSProperties}>
      <div className="ac-inbox-kop">
        <span className="ac-inbox-stip" aria-hidden="true" />
        <span className="ac-inbox-tekst">
          <strong>{i.label}</strong>
          <span>
            {i.email}
            {i.geverifieerdOp ? ` · getest op ${datumTijd(i.geverifieerdOp)}` : ''}
          </span>
        </span>
        {nieuw && (
          <span className="ac-inbox-volgorde">
            <button type="button" className="ac-pijl" aria-label={`${i.label} omhoog`} disabled={eerste || bezig !== null} onClick={onOmhoog}>
              ↑
            </button>
            <button type="button" className="ac-pijl" aria-label={`${i.label} omlaag`} disabled={laatste || bezig !== null} onClick={onOmlaag}>
              ↓
            </button>
          </span>
        )}
      </div>

      {!i.leesbaar && (
        <p className="ac-waarschuwing" role="alert">
          Het opgeslagen wachtwoord van deze inbox kan niet meer worden gelezen (de sleutel op de server is veranderd). Vul
          het opnieuw in.
        </p>
      )}

      <div className="ac-inbox-balk">
        {nieuw ? (
          <div className="ac-zicht-keuze" role="radiogroup" aria-label={`Wie ziet ${i.label}?`}>
            <label className={`ac-zicht-optie${!team ? ' is-aan' : ''}`}>
              <input type="radio" name={`${id}-zicht`} checked={!team} disabled={bezig !== null} onChange={() => onZichtbaarheid(false)} />
              Alleen ik
            </label>
            <label className={`ac-zicht-optie${team ? ' is-aan' : ''}`}>
              <input type="radio" name={`${id}-zicht`} checked={team} disabled={bezig !== null} onChange={() => onZichtbaarheid(true)} />
              Hele team
            </label>
          </div>
        ) : (
          <span className="ac-inbox-tag">Alleen jij</span>
        )}
        <span className="ac-inbox-knoppen">
          {nieuw && (
            <button type="button" className="ag-link-knop" onClick={() => setModus(modus === 'bewerken' ? '' : 'bewerken')}>
              Bewerken
            </button>
          )}
          <button type="button" className="ag-link-knop" onClick={() => setModus(modus === 'wachtwoord' ? '' : 'wachtwoord')}>
            Wachtwoord vernieuwen
          </button>
          <button type="button" className="ag-link-knop ag-link-gevaar" onClick={() => setModus(modus === 'ontkoppelen' ? '' : 'ontkoppelen')}>
            Ontkoppelen
          </button>
        </span>
      </div>

      {modus === 'bewerken' && (
        <form className="ac-mailform ac-inbox-form" onSubmit={bewaar}>
          <label className="ag-label">
            Naam in Mail
            <input className="ag-veld" value={label} maxLength={40} required onChange={(e) => setLabel(e.target.value)} />
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
          <label className="ag-label">
            Afzendernaam
            <input className="ag-veld" value={fromName} maxLength={120} placeholder="Bijvoorbeeld Studio Levant" onChange={(e) => setFromName(e.target.value)} />
          </label>
          <label className="ag-label">
            Handtekening (optioneel)
            <textarea className="ag-veld" rows={3} value={handtekening} maxLength={5000} onChange={(e) => setHandtekening(e.target.value)} />
          </label>
          <div className="ac-acties">
            <button type="submit" className="db-knop db-knop-primair" disabled={bezigHier}>
              {bezigHier ? 'Opslaan…' : 'Opslaan'}
            </button>
            <button type="button" className="ag-link-knop" onClick={() => setModus('')}>
              Annuleren
            </button>
          </div>
        </form>
      )}

      {modus === 'wachtwoord' && (
        <div className="ac-inbox-form">
          <MailboxSnelKoppelen
            startEmail={i.email || email}
            vastEmail
            inbox={nieuw ? { standaardKleur: i.kleur, magDelen: false } : null}
            knopTekst="Verbinding testen en opslaan"
            onGekoppeld={(_adres, data) => {
              const ov = (data as { overzicht?: MailboxenOverzicht }).overzicht;
              setModus('');
              if (ov) onBijgewerkt(ov, `Wachtwoord van ${i.label} bijgewerkt ✓`);
              else void onVervers();
            }}
          />
        </div>
      )}

      {modus === 'ontkoppelen' && (
        <div className="ac-acties ac-inbox-form">
          <span className="ag-zeker">
            <span>{i.label} ontkoppelen?</span>
            <button type="button" className="db-knop ag-knop-gevaar" disabled={bezigHier} onClick={ontkoppel}>
              {bezigHier ? 'Bezig…' : 'Ja, ontkoppelen'}
            </button>
            <button type="button" className="db-knop" onClick={() => setModus('')}>
              Nee
            </button>
          </span>
        </div>
      )}
    </li>
  );
}

function MeldingTekst({ melding }: { melding: Melding }) {
  if (!melding) return <span aria-live="polite" />;
  return (
    <p className={melding.soort === 'fout' ? 'ag-fout' : 'ac-ok'} role={melding.soort === 'fout' ? 'alert' : 'status'}>
      {melding.tekst}
    </p>
  );
}
