'use client';

import { useState } from 'react';
import type { DiagnoseResultaat, DriveStatus } from '@/lib/drive/types';
import { BevestigDialoog } from './Dialogen';
import { driveApi } from './driveApi';

interface Bulk {
  gekopieerd: number;
  overgeslagen: number;
  mislukt: number;
  resterend: number;
  klaar: boolean;
}

/** Instellingenblok onderaan Bestanden: met welk account; voor de eigenaar kopiëren en ontkoppelen. */
export function DriveInstellingen({ status }: { status: DriveStatus }) {
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [ontkoppelVraag, setOntkoppelVraag] = useState(false);
  const [diagnose, setDiagnose] = useState<DiagnoseResultaat | null>(null);

  /** "Test Drive-koppeling": controleert koppeling en vaste mappen zonder een factuur te maken. */
  async function test() {
    setBezig(true);
    setMelding('Drive-koppeling testen…');
    setDiagnose(null);
    try {
      const r = await driveApi<DiagnoseResultaat>('/api/drive/diagnose', 'POST');
      setDiagnose(r);
      setMelding(r.ok ? `Alles in orde (${(r.duurMs / 1000).toFixed(1)} s). Nieuwe facturen gaan automatisch naar Drive.` : 'Er ging iets mis; zie hieronder.');
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Testen is mislukt.');
    } finally {
      setBezig(false);
    }
  }

  async function kopieer() {
    setBezig(true);
    setMelding('Bezig met kopiëren…');
    let totaal = { gekopieerd: 0, mislukt: 0, overgeslagen: 0 };
    try {
      // Rondes van ±40 s tot alles er staat (of een ronde niets meer opschiet).
      for (let ronde = 0; ronde < 50; ronde++) {
        const r = await driveApi<Bulk>('/api/drive/kopieer-bestaande', 'POST');
        totaal = { gekopieerd: totaal.gekopieerd + r.gekopieerd, mislukt: totaal.mislukt + r.mislukt, overgeslagen: ronde === 0 ? r.overgeslagen : totaal.overgeslagen };
        if (r.klaar || r.gekopieerd + r.mislukt === 0) break;
        setMelding(`Bezig… ${totaal.gekopieerd} gekopieerd, nog ${r.resterend} te gaan.`);
      }
      setMelding(
        `Klaar: ${totaal.gekopieerd} gekopieerd, ${totaal.overgeslagen} stonden er al${totaal.mislukt ? `, ${totaal.mislukt} mislukt (probeer het later nog eens)` : ''}.`
      );
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Kopiëren is mislukt.');
    } finally {
      setBezig(false);
    }
  }

  async function ontkoppel() {
    setBezig(true);
    try {
      await driveApi('/api/drive/ontkoppelen', 'POST');
      window.location.href = '/bestanden';
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Ontkoppelen is mislukt.');
      setBezig(false);
    }
  }

  return (
    <section className="db-kaart bs-instellingen" aria-labelledby="bs-instellingen">
      <header className="db-kaart-kop">
        <h2 id="bs-instellingen" className="db-label">
          Google Drive
        </h2>
      </header>
      <div className="db-kaart-inhoud">
        <p className="bs-uitleg">
          Gekoppeld met <strong>{status.email || 'het Google-account van Studio Levant'}</strong>. Alles staat in de map &ldquo;Studio Levant&rdquo;: Boekhouding
          (facturen in de map Factuur, prijsopgaven en bonnetjes per jaar, automatisch), Klanten (per klant en project) en Algemeen.
        </p>
        {status.eigenaar ? (
          <div className="bs-instellingen-acties">
            <button type="button" className="db-knop" disabled={bezig} onClick={() => void test()} title="Controleert de koppeling en de vaste mappen (maakt ontbrekende aan); er wordt niets geüpload">
              Test Drive-koppeling
            </button>
            <button type="button" className="db-knop" disabled={bezig} onClick={() => void kopieer()}>
              Bestaande facturen, prijsopgaven en bonnetjes naar Drive kopiëren
            </button>
            <button type="button" className="db-knop bs-gevaar" disabled={bezig} onClick={() => setOntkoppelVraag(true)}>
              Ontkoppelen
            </button>
          </div>
        ) : (
          <p className="bs-uitleg">Alleen de eigenaar kan de koppeling wijzigen.</p>
        )}
        {melding && (
          <p className="bs-uitleg" role="status">
            {melding}
          </p>
        )}
        {diagnose && (
          <ul className="bs-diagnose" aria-label="Uitkomst van de test">
            {diagnose.stappen.map((s, i) => (
              <li key={i} className={`bs-diagnose-stap is-${s.uitkomst}`}>
                <span className="bs-diagnose-teken" aria-hidden="true">
                  {s.uitkomst === 'ok' ? '✓' : s.uitkomst === 'fout' ? '✕' : 'i'}
                </span>
                <span className="bs-diagnose-naam">
                  {s.link ? (
                    <a href={s.link} target="_blank" rel="noopener noreferrer">
                      {s.naam}
                    </a>
                  ) : (
                    s.naam
                  )}
                  <span className="sr-only">{s.uitkomst === 'ok' ? ' (OK)' : s.uitkomst === 'fout' ? ' (fout)' : ''}</span>
                </span>
                <span className="bs-diagnose-tekst">{s.tekst}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {ontkoppelVraag && (
        <BevestigDialoog
          titel="Google Drive ontkoppelen?"
          tekst="Het dashboard kan daarna niet meer bij de bestanden, en nieuwe facturen en bonnetjes gaan niet meer naar Drive. De bestanden in Drive blijven staan; opnieuw koppelen kan altijd."
          knop="Ontkoppelen"
          gevaar
          onJa={() => {
            setOntkoppelVraag(false);
            void ontkoppel();
          }}
          onNee={() => setOntkoppelVraag(false)}
        />
      )}
    </section>
  );
}
