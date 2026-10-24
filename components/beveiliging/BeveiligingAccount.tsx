'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, datumTijd } from '@/lib/beveiliging/client';
import { TfaInstellen } from './TfaInstellen';

// Account › Beveiliging: status van tweestapsverificatie, apparaten (max. 2), wachtwoord
// wijzigen en uitloggen.

export interface BeveiligingAccountData {
  factoren: { id: string; naam: string; aangemaakt: string }[];
  /** 2FA verplicht (MFA_AFDWINGEN aan én migratie 0026 uitgevoerd). */
  verplicht: boolean;
  /** Migratie 0026 uitgevoerd. */
  migratie: boolean;
  max: number;
}

export function BeveiligingAccount({ data }: { data: BeveiligingAccountData }) {
  const router = useRouter();
  const [toevoegen, setToevoegen] = useState(false);
  const [verwijderId, setVerwijderId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);
  const aan = data.factoren.length > 0;

  async function verwijder(e: React.FormEvent) {
    e.preventDefault();
    if (!verwijderId) return;
    setBezig(true);
    setMelding(null);
    try {
      await api('/api/beveiliging/2fa/verwijderen', 'POST', { factorId: verwijderId, code });
      setVerwijderId(null);
      setCode('');
      setMelding({ soort: 'ok', tekst: 'Apparaat verwijderd.' });
      router.refresh();
    } catch (err) {
      setMelding({ soort: 'fout', tekst: err instanceof Error ? err.message : 'Verwijderen mislukt.' });
    } finally {
      setBezig(false);
    }
  }

  return (
    <section className="ac-blok" aria-labelledby="ac-beveiliging" id="beveiliging">
      <header className="ac-blok-kop">
        <h2 id="ac-beveiliging" className="ac-blok-titel">Beveiliging</h2>
        <p className="ac-blok-uitleg">
          Tweestapsverificatie: naast je wachtwoord een code uit een app op je telefoon. Zo kan niemand met alleen je
          wachtwoord bij facturen, klanten of mail. Accounts maakt de eigenaar aan; zelf registreren kan niet.
        </p>
      </header>

      <p className="bv-status" role="status">
        <span className={`bv-stip ${aan ? 'is-aan' : 'is-uit'}`} aria-hidden="true" />
        {aan
          ? `Tweestapsverificatie staat aan (${data.factoren.length} ${data.factoren.length === 1 ? 'apparaat' : 'apparaten'}).`
          : data.verplicht
            ? 'Tweestapsverificatie staat nog uit.'
            : 'Tweestapsverificatie staat uit (aangeraden).'}
      </p>

      {aan && (
        <ul className="bv-apparaten">
          {data.factoren.map((f) => (
            <li key={f.id} className="bv-apparaat">
              <div className="bv-apparaat-kop">
                <span>
                  <span className="bv-apparaat-naam">{f.naam}</span>
                  <span className="bv-apparaat-sub"> · toegevoegd {datumTijd(f.aangemaakt)}</span>
                </span>
                {verwijderId !== f.id && (
                  <button
                    type="button"
                    className="bv-link"
                    onClick={() => {
                      setVerwijderId(f.id);
                      setCode('');
                      setMelding(null);
                    }}
                  >
                    Verwijderen
                  </button>
                )}
              </div>
              {verwijderId === f.id && (
                <form className="bv-rij-form" onSubmit={verwijder}>
                  <label className="ag-label">
                    Code van dít apparaat
                    <input
                      className="ag-veld bv-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={7}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
                      autoFocus
                      required
                    />
                  </label>
                  <button type="submit" className="db-knop" disabled={bezig || code.replace(/\s/g, '').length !== 6}>
                    {bezig ? 'Bezig…' : 'Verwijderen bevestigen'}
                  </button>
                  <button type="button" className="db-knop" onClick={() => setVerwijderId(null)} disabled={bezig}>
                    Annuleren
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {toevoegen ? (
        <TfaInstellen
          naam={aan ? 'Tweede apparaat' : 'Telefoon'}
          onAnnuleren={() => setToevoegen(false)}
          onKlaar={() => {
            setToevoegen(false);
            setMelding({ soort: 'ok', tekst: aan ? 'Tweede apparaat toegevoegd.' : 'Tweestapsverificatie staat aan.' });
            router.refresh();
          }}
        />
      ) : (
        data.factoren.length < data.max && (
          <div className="ac-acties">
            <button type="button" className={`db-knop${aan ? '' : ' db-knop-primair'}`} onClick={() => setToevoegen(true)}>
              {aan ? 'Tweede apparaat toevoegen' : 'Tweestapsverificatie instellen'}
            </button>
            {aan && data.factoren.length === 1 && (
              <span className="ag-uitleg">Aangeraden: bv. je wachtwoordmanager, voor als je telefoon kwijt is.</span>
            )}
          </div>
        )
      )}

      {melding && (
        <p className={melding.soort === 'fout' ? 'ag-fout' : 'ac-ok'} role={melding.soort === 'fout' ? 'alert' : 'status'}>
          {melding.tekst}
        </p>
      )}

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
      <p className="ag-uitleg">Na 12 uur zonder activiteit (en sowieso na 14 dagen) log je automatisch uit.</p>
    </section>
  );
}
