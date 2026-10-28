'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/beveiliging/client';
import type { FeedStatus } from '@/lib/agenda/feed';

// Agenda koppelen (verplicht): één knop voor Apple Agenda (webcal://) en één voor Google
// Agenda (abonneren via URL). Daarna wachten we tot de agenda-app de link echt heeft
// opgehaald; pas dan is het koppelen klaar.

const NAAM: Record<string, string> = { apple: 'Apple Agenda', google: 'Google Agenda', outlook: 'Outlook', overig: 'je agenda-app' };
const UITSTEL_NA_SEC = 90;

export function AgendaKoppelen({ voornaam, start, vervolg }: { voornaam: string; start: FeedStatus; vervolg: string }) {
  const [status, setStatus] = useState(start);
  const [pad, setPad] = useState<string | null>(null);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);
  const [gekozen, setGekozen] = useState<'apple' | 'google' | null>(null);
  const [wachtSec, setWachtSec] = useState(0);
  const [gekopieerd, setGekopieerd] = useState(false);
  // Al gekoppeld en hier vrijwillig: opnieuw koppelen (pas na 'Nieuwe link maken').
  const [opnieuw, setOpnieuw] = useState(start.gekoppeld);

  const url = pad ? `${window.location.origin}${pad}` : '';
  const webcal = url.replace(/^https?:\/\//, 'webcal://');
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  const lokaal = typeof window !== 'undefined' && /^(localhost|127\.)/.test(window.location.hostname);

  async function maakLink() {
    setBezig(true);
    setFout('');
    try {
      const r = await api<{ pad: string }>('/api/account/agenda', 'POST', { actie: 'nieuw' });
      setPad(r.pad);
      setStatus((s) => ({ ...s, heeftLink: true, gekoppeld: false, client: null }));
      setOpnieuw(false);
      return r.pad;
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Link maken mislukt.');
      return null;
    } finally {
      setBezig(false);
    }
  }

  // Zonder bestaande (nog niet gebruikte) link meteen een maken; een gekoppelde agenda laten we staan.
  useEffect(() => {
    if (start.gekoppeld) return;
    const t = setTimeout(() => void maakLink(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Na het kiezen: elke 3 s kijken of de agenda-app de link heeft opgehaald.
  useEffect(() => {
    if (!gekozen || status.gekoppeld) return;
    const t = setInterval(async () => {
      setWachtSec((s) => s + 3);
      try {
        const s = await api<FeedStatus>('/api/account/agenda');
        if (s.gekoppeld) setStatus(s);
      } catch {
        /* volgende ronde */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [gekozen, status.gekoppeld]);

  async function uitstellen() {
    setBezig(true);
    try {
      await api('/api/account/agenda', 'POST', { actie: 'uitstellen' });
      window.location.href = vervolg;
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Uitstellen mislukt.');
      setBezig(false);
    }
  }

  async function kopieer() {
    try {
      await navigator.clipboard.writeText(url);
      setGekopieerd(true);
      setTimeout(() => setGekopieerd(false), 2000);
    } catch {
      /* selecteer handmatig */
    }
  }

  const klaar = status.gekoppeld && !opnieuw;

  return (
    <div className="wk">
      <div className="wk-kaart">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="wk-logo" src="/brand/banner-licht.png" alt="Studio Levant" width={800} height={297} />
        {klaar ? (
          <section className="wk-blok">
            <h1 className="wk-titel">Agenda gekoppeld</h1>
            <p className="wk-tekst">
              Je SL-agenda staat in {NAAM[status.client ?? 'overig']}. Nieuwe taken en afspraken voor jou verschijnen daar vanzelf
              {status.client === 'google' ? ' (Google ververst een paar keer per dag)' : ' (binnen ongeveer 15 minuten)'}.
            </p>
            <div className="ac-acties">
              <a className="db-knop db-knop-primair" href={vervolg}>
                Verder
              </a>
            </div>
          </section>
        ) : (
          <section className="wk-blok">
            <h1 className="wk-titel">{voornaam ? `${voornaam}, koppel je agenda` : 'Koppel je agenda'}</h1>
            <p className="wk-tekst">
              {opnieuw
                ? 'Je agenda is al gekoppeld. Wil je opnieuw koppelen (bv. op een nieuw apparaat of een andere agenda)? Maak dan een nieuwe link; de oude stopt dan.'
                : 'Verplicht voor iedereen: je taken en afspraken uit Studio Levant komen in je eigen agenda te staan. Krijg je een taak van een collega, dan zie je die daar ook. Kies je agenda:'}
            </p>
            {opnieuw && !pad && (
              <div className="ac-acties">
                <button type="button" className="db-knop db-knop-primair" onClick={() => void maakLink()} disabled={bezig}>
                  Nieuwe link maken
                </button>
                <a className="db-knop" href={vervolg}>
                  Terug
                </a>
              </div>
            )}
            {pad && (
              <>
                <div className="ak-keuze">
                  <a className={`ak-optie${gekozen === 'apple' ? ' is-gekozen' : ''}`} href={webcal} onClick={() => setGekozen('apple')}>
                    <strong>Apple Agenda</strong>
                    <span>iPhone, iPad en Mac. Tik en kies &lsquo;Abonneer&rsquo;.</span>
                  </a>
                  <a className={`ak-optie${gekozen === 'google' ? ' is-gekozen' : ''}`} href={google} target="_blank" rel="noopener noreferrer" onClick={() => setGekozen('google')}>
                    <strong>Google Agenda</strong>
                    <span>Opent Google Agenda; klik daar op &lsquo;Toevoegen&rsquo;.</span>
                  </a>
                </div>
                {lokaal && (
                  <p className="ac-waarschuwing">
                    Je werkt lokaal (localhost). Apple Agenda op deze Mac kan de link ophalen, Google niet: Google moet de server
                    via internet kunnen bereiken. Op de echte site werkt Google wel.
                  </p>
                )}
                <details className="ac-geavanceerd">
                  <summary>Andere agenda-app of handmatig toevoegen</summary>
                  <p className="wk-tekst">Voeg deze link toe als &lsquo;agenda-abonnement&rsquo; (deel hem met niemand):</p>
                  <div className="bv-rij-form">
                    <input className="ag-veld gb-mono ak-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" className="db-knop" onClick={() => void kopieer()}>
                      {gekopieerd ? 'Gekopieerd' : 'Kopieer'}
                    </button>
                  </div>
                </details>
                {gekozen && (
                  <p className="ak-wacht" role="status">
                    <span className="ak-spinner" aria-hidden="true" /> Wachten tot {NAAM[gekozen]} de agenda ophaalt…
                  </p>
                )}
                {gekozen && wachtSec >= UITSTEL_NA_SEC && (
                  <p className="wk-tekst">
                    Duurt het lang? Controleer of je het abonnement echt hebt toegevoegd.{' '}
                    <button type="button" className="bv-link" onClick={() => void uitstellen()} disabled={bezig}>
                      Morgen opnieuw controleren
                    </button>
                  </p>
                )}
              </>
            )}
            {fout && (
              <p className="ag-fout" role="alert">
                {fout}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
