'use client';

import { useState, type CSSProperties } from 'react';
import { initialenUit, KLEUREN, valideerProfiel, type ProfielInvoer } from '@/lib/account/types';
import { MailboxSnelKoppelen } from '@/components/account/MailboxSnelKoppelen';
import { TfaInstellen } from '@/components/beveiliging/TfaInstellen';

// De welkomstflow (app/welkom/page.tsx): stappen op één pagina.
//   0. tweestapsverificatie (2FA) instellen. Verplicht zolang afdwingen aan staat (dan kan
//      er vóór deze stap verder niets: geen profiel opslaan, geen data); anders aangeboden met
//      "Later". Bewust de EERSTE stap: daarna staat de sessie op aal2 en werken alle routes.
//   1. profiel bevestigen (al ingevuld vanuit de uitnodiging; aanpassen mag)
//   2. inbox koppelen met één knop (of "Later doen")
//   3. klaar: de vlag welkom_klaar_op wordt gezet zodra deze stap verschijnt

export interface WelkomTfa {
  /** De stap Beveiliging tonen. */
  toon: boolean;
  /** Al ingesteld (bv. net gedaan en de pagina opnieuw geladen). */
  klaar: boolean;
  /** Verplicht: geen "Later". */
  verplicht: boolean;
}

export interface WelkomMailbox {
  /** Koppelen kan (tabel + sleutel op de server aanwezig). */
  kan: boolean;
  /** Uitleg als koppelen nu niet kan. */
  uitleg: string;
  /** Al gekoppeld adres, of null. */
  gekoppeld: string | null;
}

type Stap = 0 | 1 | 2 | 3;

async function verstuur(url: string, method: string, body?: unknown): Promise<void> {
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
    window.location.href = '/login?next=/welkom';
    throw new Error('Je bent uitgelogd.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error((data && data.error) || 'Er ging iets mis. Probeer het opnieuw.');
  }
}

export function WelkomFlow({
  email,
  profiel,
  mailbox,
  tfa
}: {
  email: string;
  profiel: ProfielInvoer;
  mailbox: WelkomMailbox;
  tfa: WelkomTfa;
}) {
  const [stap, setStap] = useState<Stap>(tfa.toon && !tfa.klaar ? 0 : 1);
  const [p, setP] = useState(profiel);
  const [initialenZelf, setInitialenZelf] = useState(profiel.initialen !== initialenUit(profiel.naam));
  const [gekoppeld, setGekoppeld] = useState(mailbox.gekoppeld);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const [klaar, setKlaar] = useState(false);
  const voornaam = p.naam.split(/\s+/)[0] || '';
  const kleuren = KLEUREN.some((k) => k.kleur === profiel.kleur) ? KLEUREN : [{ kleur: profiel.kleur, naam: 'Huidig' }, ...KLEUREN];

  async function profielBevestigen(e: React.FormEvent) {
    e.preventDefault();
    setFout('');
    const v = valideerProfiel(p);
    if (!v.ok) {
      setFout(v.fout);
      return;
    }
    const gewijzigd = v.waarde.naam !== profiel.naam || v.waarde.initialen !== profiel.initialen || v.waarde.kleur !== profiel.kleur;
    setBezig(true);
    try {
      if (gewijzigd) await verstuur('/api/account/profiel', 'PATCH', v.waarde);
      setP(v.waarde);
      setStap(2);
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan mislukt.');
    } finally {
      setBezig(false);
    }
  }

  // Stap 3: de flow is doorlopen. Meteen vastleggen, ook als je via "Later doen" kwam.
  async function afronden(): Promise<boolean> {
    setFout('');
    setBezig(true);
    try {
      await verstuur('/api/account/welkom', 'POST');
      setKlaar(true);
      return true;
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan mislukt.');
      return false;
    } finally {
      setBezig(false);
    }
  }

  function naarKlaar() {
    setStap(3);
    void afronden();
  }

  async function naarDashboard() {
    if (!klaar && !(await afronden())) return;
    // Volledig laden: de layout leest het profiel opnieuw (geen doorsturen meer naar /welkom).
    window.location.href = '/';
  }

  return (
    <div className="wk">
      <div className="wk-kaart">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="wk-logo" src="/brand/banner-licht.png" alt="Studio Levant" width={800} height={297} />
        <ol className="wk-stappen" aria-label="Stappen">
          {(
            [
              ...(tfa.toon ? [{ naam: 'Beveiliging', nr: 0 as Stap }] : []),
              { naam: 'Profiel', nr: 1 as Stap },
              { naam: 'Inbox', nr: 2 as Stap },
              { naam: 'Klaar', nr: 3 as Stap }
            ] as const
          ).map((s, i) => (
            <li key={s.naam} className={stap === s.nr ? 'is-nu' : stap > s.nr ? 'is-klaar' : ''} aria-current={stap === s.nr ? 'step' : undefined}>
              <span className="wk-stap-nr">{i + 1}</span>
              {s.naam}
            </li>
          ))}
        </ol>

        {stap === 0 && (
          <div className="wk-blok">
            <h1 className="wk-titel">Welkom{voornaam && voornaam !== 'Teamlid' ? `, ${voornaam}` : ''}. Eerst je account beveiligen</h1>
            <p className="wk-tekst">
              In de backoffice staan facturen, klantgegevens en mail. Daarom vragen we naast je wachtwoord een code uit een
              app op je telefoon: tweestapsverificatie. Dat duurt een minuut.
            </p>
            <TfaInstellen
              naam="Telefoon"
              autoStart={tfa.verplicht}
              onKlaar={() => {
                // Opnieuw laden: de sessie staat nu op aal2, de server geeft de rest van de flow vrij.
                window.location.href = '/welkom';
              }}
            />
            {!tfa.verplicht && (
              <div className="ac-acties">
                <button type="button" className="bv-link" onClick={() => setStap(1)}>
                  Later doen
                </button>
              </div>
            )}
          </div>
        )}

        {stap === 1 && (
          <form className="wk-blok" onSubmit={profielBevestigen}>
            <h1 className="wk-titel">Welkom{voornaam && voornaam !== 'Teamlid' ? `, ${voornaam}` : ''}</h1>
            <p className="wk-tekst">Zo zien je teamgenoten je bij taken, uploads en facturen. Klopt dit?</p>
            <div className="ac-voorbeeld" aria-hidden="true">
              <span className="ac-avatar" style={{ '--sl-avatar-kleur': p.kleur } as CSSProperties}>
                {p.initialen || '?'}
              </span>
              <span className="ac-voorbeeld-tekst">
                <strong>{p.naam || 'Je naam'}</strong>
                <span>{email}</span>
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
                  onChange={(e) => {
                    setInitialenZelf(true);
                    setP((x) => ({ ...x, initialen: e.target.value.toUpperCase().replace(/[^\p{L}]/gu, '').slice(0, 3) }));
                  }}
                />
              </label>
            </div>
            <fieldset className="ac-kleuren">
              <legend className="ac-legend">Kleur</legend>
              {kleuren.map((k) => (
                <label key={k.kleur} className="ac-kleur" title={k.naam}>
                  <input
                    type="radio"
                    name="wk-kleur"
                    value={k.kleur}
                    checked={p.kleur === k.kleur}
                    onChange={() => setP((x) => ({ ...x, kleur: k.kleur }))}
                  />
                  <span className="ac-kleur-stip" style={{ background: k.kleur }} aria-hidden="true" />
                  <span className="sr-only">{k.naam}</span>
                </label>
              ))}
            </fieldset>
            <div className="ac-acties">
              <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
                {bezig ? 'Opslaan…' : 'Klopt, verder'}
              </button>
            </div>
          </form>
        )}

        {stap === 2 && (
          <div className="wk-blok">
            <h1 className="wk-titel">Koppel je inbox</h1>
            {gekoppeld ? (
              <>
                <p className="ac-ok" role="status">
                  Gekoppeld: {gekoppeld} ✓
                </p>
                <div className="ac-acties">
                  <button type="button" className="db-knop db-knop-primair" onClick={naarKlaar}>
                    Verder
                  </button>
                </div>
              </>
            ) : mailbox.kan ? (
              <>
                <p className="wk-tekst">Dan zie je je mail op je dashboard en in Mail. Alleen jij ziet je eigen mailbox.</p>
                <MailboxSnelKoppelen
                  startEmail={email}
                  onGekoppeld={(adres) => {
                    setGekoppeld(adres || email);
                    naarKlaar();
                  }}
                  onLater={naarKlaar}
                />
              </>
            ) : (
              <>
                <p className="wk-tekst">{mailbox.uitleg}</p>
                <div className="ac-acties">
                  <button type="button" className="db-knop db-knop-primair" onClick={naarKlaar}>
                    Verder
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {stap === 3 && (
          <div className="wk-blok">
            <h1 className="wk-titel">Alles staat klaar</h1>
            {gekoppeld && <p className="ac-ok">Inbox gekoppeld: {gekoppeld} ✓</p>}
            <p className="wk-tekst">
              Facturen, prijsopgaven, klanten, projecten, bonnetjes en social posts deel je met het team. Taken die iemand
              voor je maakt, staan in jouw agenda en takenlijst.
            </p>
            {!gekoppeld && <p className="wk-tekst wk-klein">Je inbox koppel je later via Mail of Account &amp; mail.</p>}
            <div className="ac-acties">
              <button type="button" className="db-knop db-knop-primair" onClick={naarDashboard} disabled={bezig}>
                {bezig ? 'Even geduld…' : 'Naar mijn dashboard'}
              </button>
            </div>
          </div>
        )}

        {fout && (
          <p className="ag-fout" role="alert">
            {fout}
          </p>
        )}
      </div>
    </div>
  );
}
