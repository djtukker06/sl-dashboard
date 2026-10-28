'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { api, datumTijd } from '@/lib/beveiliging/client';
import { KLEUREN } from '@/lib/account/types';
import { initialenVoorstel, MIN_WACHTWOORD, type Gebruiker, type GebruikerRol } from '@/lib/auth/gebruikers-kern';

// Admin-pagina /gebruikers: gebruikers aanmaken (met tijdelijk wachtwoord, bij de eerste
// login verplicht te vervangen), wijzigen, deactiveren en definitief verwijderen. De routes
// eronder (app/api/beveiliging/gebruikers) eisen zelf ook admin + 2FA-sessie.

interface Formulier {
  naam: string;
  email: string;
  initialen: string;
  kleur: string;
  rol: GebruikerRol;
  boekhouding: boolean;
  wachtwoord: string;
}

const LEEG: Formulier = { naam: '', email: '', initialen: '', kleur: KLEUREN[0].kleur, rol: 'gebruiker', boekhouding: false, wachtwoord: '' };

/** Leesbaar tijdelijk wachtwoord, bv. "kmt7-q2xp-9vhe-wr4a" (19 tekens, ~80 bits). */
function maakWachtwoord(): string {
  const tekens = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = new Uint32Array(16);
  crypto.getRandomValues(r);
  const s = Array.from(r, (n) => tekens[n % tekens.length]).join('');
  return s.match(/.{4}/g)!.join('-');
}

export function GebruikersApp({ aal2 }: { aal2: boolean }) {
  const [lijst, setLijst] = useState<Gebruiker[] | null>(null);
  const [migratie, setMigratie] = useState(true);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [versie, setVersie] = useState(0);
  const [nieuw, setNieuw] = useState(false);
  const [bewerkId, setBewerkId] = useState<string | null>(null);
  const herlaad = useCallback(() => setVersie((v) => v + 1), []);

  useEffect(() => {
    if (!aal2) return;
    let weg = false;
    api<{ gebruikers: Gebruiker[]; migratie: boolean }>('/api/beveiliging/gebruikers')
      .then((r) => {
        if (weg) return;
        setLijst(r.gebruikers);
        setMigratie(r.migratie);
        setFout('');
      })
      .catch((e) => !weg && setFout(e instanceof Error ? e.message : 'Laden mislukt.'));
    return () => {
      weg = true;
    };
  }, [versie, aal2]);

  function klaar(tekst: string) {
    setMelding(tekst);
    setNieuw(false);
    setBewerkId(null);
    herlaad();
  }

  return (
    <div className="ac">
      <ModuleKop label="Account" titel="Gebruikers" />
      <div className="ac-inhoud">
        {!aal2 ? (
          <section className="ac-blok">
            <header className="ac-blok-kop">
              <h2 className="ac-blok-titel">Eerst tweestapsverificatie</h2>
              <p className="ac-blok-uitleg">
                Gebruikers beheren kan alleen met een sessie mét 2FA-code. Stel tweestapsverificatie in via Account en log
                daarna opnieuw in.
              </p>
            </header>
            <div className="ac-acties">
              <a className="db-knop db-knop-primair" href="/account#beveiliging">
                Naar Account › Beveiliging
              </a>
            </div>
          </section>
        ) : (
          <>
            {!migratie && (
              <p className="ac-waarschuwing" role="status">
                Voer in Supabase <code>supabase/UITVOEREN_0028.sql</code> uit: dan werken het vinkje Boekhouding en het verplichte
                nieuwe wachtwoord ook in de database.
              </p>
            )}
            <section className="ac-blok" aria-labelledby="gb-titel">
              <header className="gb-kop">
                <div className="ac-blok-kop">
                  <h2 id="gb-titel" className="ac-blok-titel">
                    Team
                  </h2>
                  <p className="ac-blok-uitleg">
                    Alleen een admin maakt accounts aan. Een nieuwe gebruiker logt in met het tijdelijke wachtwoord dat jij kiest
                    en moet dan meteen een eigen wachtwoord instellen, en daarna tweestapsverificatie.
                  </p>
                </div>
                {!nieuw && (
                  <button
                    type="button"
                    className="db-knop db-knop-primair"
                    onClick={() => {
                      setNieuw(true);
                      setBewerkId(null);
                      setMelding('');
                    }}
                  >
                    + Gebruiker toevoegen
                  </button>
                )}
              </header>
              {melding && (
                <p className="ac-ok" role="status">
                  {melding}
                </p>
              )}
              {fout && (
                <p className="ag-fout" role="alert">
                  {fout}
                </p>
              )}
              {nieuw && <GebruikerFormulier onKlaar={klaar} onAnnuleer={() => setNieuw(false)} />}
              {!lijst && !fout && <p className="ag-uitleg">Laden…</p>}
              {lijst && (
                <ul className="gb-lijst">
                  {lijst.map((g) =>
                    bewerkId === g.userId ? (
                      <li key={g.userId} className="gb-item is-bewerken">
                        <GebruikerFormulier bestaand={g} onKlaar={klaar} onAnnuleer={() => setBewerkId(null)} />
                      </li>
                    ) : (
                      <GebruikerRij
                        key={g.userId}
                        g={g}
                        onBewerk={() => {
                          setBewerkId(g.userId);
                          setNieuw(false);
                          setMelding('');
                        }}
                        onKlaar={klaar}
                      />
                    )
                  )}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function GebruikerRij({ g, onBewerk, onKlaar }: { g: Gebruiker; onBewerk: () => void; onKlaar: (t: string) => void }) {
  const [paneel, setPaneel] = useState<'geen' | 'wachtwoord' | 'verwijderen'>('geen');
  const [wachtwoord, setWachtwoord] = useState('');
  const [bevestig, setBevestig] = useState('');
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');

  async function doe(fn: () => Promise<unknown>, tekst: string) {
    setBezig(true);
    setFout('');
    try {
      await fn();
      setPaneel('geen');
      onKlaar(tekst);
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Er ging iets mis.');
    } finally {
      setBezig(false);
    }
  }

  return (
    <li className={`gb-item${g.actief ? '' : ' is-uit'}`}>
      <div className="gb-rij">
        <span className="gb-avatar" style={{ ['--sl-avatar-kleur' as string]: g.kleur }} aria-hidden="true">
          {g.initialen}
        </span>
        <div className="gb-tekst">
          <strong>
            {g.naam}
            {g.zelf && <span className="gb-zelf"> (jij)</span>}
          </strong>
          <span>{g.email}</span>
          <div className="gb-labels">
            <span className={`gb-label${g.rol === 'admin' ? ' is-admin' : ''}`}>{g.rol === 'admin' ? 'Admin' : 'Gebruiker'}</span>
            <span className="gb-label">{g.boekhouding ? 'Boekhouding' : 'Facturen & bonnetjes'}</span>
            {!g.actief && <span className="gb-label is-waarschuwing">Gedeactiveerd</span>}
            {g.actief && g.wachtwoordWijzigen && <span className="gb-label is-wacht">Moet nog eigen wachtwoord kiezen</span>}
            <span className="gb-label is-zacht">2FA: {g.factoren ? 'aan' : 'nog niet'}</span>
            <span className="gb-label is-zacht">Laatst ingelogd: {datumTijd(g.laatstIngelogd)}</span>
          </div>
        </div>
      </div>
      <div className="gb-acties">
        <button type="button" className="bv-link" onClick={onBewerk} disabled={bezig}>
          Bewerken
        </button>
        {!g.zelf && (
          <>
            <button
              type="button"
              className="bv-link"
              onClick={() => {
                setPaneel(paneel === 'wachtwoord' ? 'geen' : 'wachtwoord');
                setWachtwoord(maakWachtwoord());
              }}
              disabled={bezig}
            >
              Nieuw tijdelijk wachtwoord
            </button>
            <button
              type="button"
              className="bv-link"
              disabled={bezig}
              onClick={() =>
                doe(
                  () => api(`/api/beveiliging/gebruikers/${g.userId}`, 'PATCH', { actief: !g.actief }),
                  g.actief ? `${g.naam} is gedeactiveerd en kan niet meer inloggen.` : `${g.naam} kan weer inloggen.`
                )
              }
            >
              {g.actief ? 'Deactiveren' : 'Activeren'}
            </button>
            <button type="button" className="bv-link is-gevaar" onClick={() => setPaneel(paneel === 'verwijderen' ? 'geen' : 'verwijderen')} disabled={bezig}>
              Verwijderen
            </button>
          </>
        )}
      </div>
      {paneel === 'wachtwoord' && (
        <form
          className="bv-rij-form"
          onSubmit={(e) => {
            e.preventDefault();
            doe(
              () => api(`/api/beveiliging/gebruikers/${g.userId}`, 'PATCH', { wachtwoord }),
              `Nieuw tijdelijk wachtwoord voor ${g.naam} ingesteld. Geef het persoonlijk door; bij de volgende login kiest ${g.naam} een eigen wachtwoord.`
            );
          }}
        >
          <label className="ag-label">
            Tijdelijk wachtwoord
            <input className="ag-veld gb-mono" value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} minLength={MIN_WACHTWOORD} required autoComplete="off" />
          </label>
          <button type="button" className="db-knop" onClick={() => setWachtwoord(maakWachtwoord())} disabled={bezig}>
            Genereer
          </button>
          <button type="submit" className="db-knop db-knop-primair" disabled={bezig || wachtwoord.length < MIN_WACHTWOORD}>
            {bezig ? 'Bezig…' : 'Instellen'}
          </button>
        </form>
      )}
      {paneel === 'verwijderen' && (
        <form
          className="bv-rij-form"
          onSubmit={(e) => {
            e.preventDefault();
            doe(() => api(`/api/beveiliging/gebruikers/${g.userId}`, 'DELETE'), `${g.naam} is definitief verwijderd.`);
          }}
        >
          <p className="gb-gevaar-tekst">
            Definitief verwijderen kan niet ongedaan worden. Bij facturen en taken van {g.naam} blijft de naam leeg. Liever
            tijdelijk? Kies Deactiveren. Typ het e-mailadres om te bevestigen.
          </p>
          <label className="ag-label">
            E-mailadres
            <input className="ag-veld" value={bevestig} onChange={(e) => setBevestig(e.target.value)} placeholder={g.email} autoComplete="off" />
          </label>
          <button type="submit" className="db-knop gb-knop-gevaar" disabled={bezig || bevestig.trim().toLowerCase() !== g.email.toLowerCase()}>
            {bezig ? 'Bezig…' : 'Definitief verwijderen'}
          </button>
          <button type="button" className="db-knop" onClick={() => setPaneel('geen')} disabled={bezig}>
            Annuleren
          </button>
        </form>
      )}
      {fout && (
        <p className="ag-fout" role="alert">
          {fout}
        </p>
      )}
    </li>
  );
}

function GebruikerFormulier({
  bestaand,
  onKlaar,
  onAnnuleer
}: {
  bestaand?: Gebruiker;
  onKlaar: (t: string) => void;
  onAnnuleer: () => void;
}) {
  const [f, setF] = useState<Formulier>(() =>
    bestaand
      ? { naam: bestaand.naam, email: bestaand.email, initialen: bestaand.initialen, kleur: bestaand.kleur, rol: bestaand.rol, boekhouding: bestaand.boekhouding, wachtwoord: '' }
      : { ...LEEG, wachtwoord: maakWachtwoord() }
  );
  const [initialenZelf, setInitialenZelf] = useState(Boolean(bestaand));
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const zet = <K extends keyof Formulier>(k: K, v: Formulier[K]) => setF((o) => ({ ...o, [k]: v }));
  const kleuren = KLEUREN.some((k) => k.kleur === f.kleur) ? KLEUREN : [{ kleur: f.kleur, naam: 'Huidig' }, ...KLEUREN];
  const zelf = bestaand?.zelf === true;

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout('');
    try {
      if (bestaand) {
        const wijziging: Record<string, unknown> = {};
        if (f.naam !== bestaand.naam) wijziging.naam = f.naam;
        if (f.email !== bestaand.email) wijziging.email = f.email;
        if (f.initialen !== bestaand.initialen) wijziging.initialen = f.initialen;
        if (f.kleur !== bestaand.kleur) wijziging.kleur = f.kleur;
        if (f.rol !== bestaand.rol) wijziging.rol = f.rol;
        if (f.boekhouding !== bestaand.boekhouding) wijziging.boekhouding = f.boekhouding;
        if (Object.keys(wijziging).length === 0) {
          onAnnuleer();
          return;
        }
        await api(`/api/beveiliging/gebruikers/${bestaand.userId}`, 'PATCH', wijziging);
        onKlaar(`${f.naam} is bijgewerkt.`);
      } else {
        await api('/api/beveiliging/gebruikers', 'POST', f);
        onKlaar(
          `${f.naam} is aangemaakt. Geef het e-mailadres en het tijdelijke wachtwoord persoonlijk door (niet via dezelfde mail); bij de eerste login kiest ${f.naam.split(' ')[0]} een eigen wachtwoord.`
        );
      }
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan mislukt.');
    } finally {
      setBezig(false);
    }
  }

  return (
    <form className="gb-form" onSubmit={opslaan}>
      <h3 className="ac-sub">{bestaand ? `${bestaand.naam} bewerken` : 'Nieuwe gebruiker'}</h3>
      <div className="ag-velden-2">
        <label className="ag-label">
          Naam
          <input
            className="ag-veld"
            value={f.naam}
            maxLength={80}
            required
            autoFocus
            onChange={(e) => {
              const naam = e.target.value;
              setF((o) => ({ ...o, naam, initialen: initialenZelf ? o.initialen : initialenVoorstel(naam) }));
            }}
          />
        </label>
        <label className="ag-label">
          E-mailadres (om mee in te loggen)
          <input className="ag-veld" type="email" value={f.email} maxLength={320} required onChange={(e) => zet('email', e.target.value)} autoComplete="off" />
        </label>
      </div>
      <div className="gb-rij-velden">
        <label className="ag-label gb-initialen">
          Initialen
          <input
            className="ag-veld"
            value={f.initialen}
            maxLength={3}
            required
            onChange={(e) => {
              setInitialenZelf(true);
              zet('initialen', e.target.value.toUpperCase());
            }}
          />
        </label>
        <fieldset className="ac-kleuren">
          <legend className="ac-legend">Kleur</legend>
          {kleuren.map((k) => (
            <label key={k.kleur} className="ac-kleur" title={k.naam}>
              <input type="radio" name={`kleur-${bestaand?.userId ?? 'nieuw'}`} value={k.kleur} checked={f.kleur === k.kleur} onChange={() => zet('kleur', k.kleur)} />
              <span className="ac-kleur-stip" style={{ background: k.kleur }} />
            </label>
          ))}
        </fieldset>
      </div>
      <div className="ag-velden-2">
        <label className="ag-label">
          Rol
          <select className="ag-veld" value={f.rol} disabled={zelf} onChange={(e) => zet('rol', e.target.value as GebruikerRol)}>
            <option value="gebruiker">Gebruiker</option>
            <option value="admin">Admin (beheert gebruikers, ziet alles)</option>
          </select>
        </label>
        <label className="gb-vink">
          <input
            type="checkbox"
            checked={f.rol === 'admin' || f.boekhouding}
            disabled={f.rol === 'admin'}
            onChange={(e) => zet('boekhouding', e.target.checked)}
          />
          <span>
            <strong>Boekhouding</strong>
            <small>
              {f.rol === 'admin'
                ? 'Een admin ziet altijd de hele boekhouding.'
                : 'Aan: ook boekingen, bank, btw en rapporten. Uit: alleen facturen maken en inzien, klanten en bonnetjes inscannen.'}
            </small>
          </span>
        </label>
      </div>
      {!bestaand && (
        <div className="bv-rij-form">
          <label className="ag-label gb-groei">
            Tijdelijk wachtwoord (minstens {MIN_WACHTWOORD} tekens)
            <input className="ag-veld gb-mono" value={f.wachtwoord} minLength={MIN_WACHTWOORD} required onChange={(e) => zet('wachtwoord', e.target.value)} autoComplete="off" />
          </label>
          <button type="button" className="db-knop" onClick={() => zet('wachtwoord', maakWachtwoord())}>
            Genereer
          </button>
        </div>
      )}
      {fout && (
        <p className="ag-fout" role="alert">
          {fout}
        </p>
      )}
      <div className="ac-acties">
        <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
          {bezig ? 'Bezig…' : bestaand ? 'Opslaan' : 'Gebruiker aanmaken'}
        </button>
        <button type="button" className="db-knop" onClick={onAnnuleer} disabled={bezig}>
          Annuleren
        </button>
      </div>
    </form>
  );
}
