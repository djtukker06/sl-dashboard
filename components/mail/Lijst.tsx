'use client';

import { useEffect, useRef } from 'react';
import { adresNaam, lijstDatum, type MailApiFout } from '@/lib/mail/client';
import type { Envelop, MapRol } from '@/lib/mail/types';
import { Icoon } from './Iconen';

// Middelste kolom: zoekveld en de berichten van de gekozen map (nieuwste eerst).
export function Lijst({
  mapNaam,
  rol,
  berichten,
  totaal,
  geselecteerd,
  laden,
  fout,
  meer,
  meerLaden,
  zoekInvoer,
  zoek,
  zoekRef,
  mappenKnop,
  onZoekInvoer,
  onZoek,
  onKies,
  onMeer,
  onOpnieuw,
  onVlag
}: {
  mapNaam: string;
  rol: MapRol;
  berichten: Envelop[] | null;
  totaal: number;
  geselecteerd: number | null;
  laden: boolean;
  fout: MailApiFout | null;
  meer: boolean;
  meerLaden: boolean;
  zoekInvoer: string;
  zoek: string;
  zoekRef: React.RefObject<HTMLInputElement | null>;
  mappenKnop: React.ReactNode;
  onZoekInvoer: (v: string) => void;
  onZoek: (v: string) => void;
  onKies: (uid: number) => void;
  onMeer: () => void;
  onOpnieuw: () => void;
  onVlag: (e: Envelop) => void;
}) {
  const lijstRef = useRef<HTMLUListElement>(null);

  // Houd de geselecteerde regel in beeld (j/k).
  useEffect(() => {
    if (geselecteerd == null) return;
    const el = lijstRef.current?.querySelector<HTMLElement>(`[data-uid="${geselecteerd}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [geselecteerd]);

  // In Verzonden/Concepten is de ontvanger interessanter dan de afzender.
  const toonAan = rol === 'verzonden' || rol === 'concepten';

  return (
    <section className="ml-lijst" aria-label={`Berichten in ${mapNaam}`}>
      <div className="ml-lijst-kop">
        {mappenKnop}
        <form
          className="ml-zoek"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            onZoek(zoekInvoer.trim());
          }}
        >
          <Icoon naam="zoek" grootte={16} />
          <input
            ref={zoekRef}
            type="search"
            className="ml-zoek-veld"
            placeholder={`Zoeken in ${mapNaam.toLowerCase()}`}
            aria-label={`Zoeken in ${mapNaam}`}
            value={zoekInvoer}
            onChange={(e) => {
              onZoekInvoer(e.target.value);
              if (!e.target.value) onZoek('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onZoekInvoer('');
                onZoek('');
                e.currentTarget.blur();
              }
            }}
          />
        </form>
      </div>

      {zoek && (
        <p className="ml-lijst-info" aria-live="polite">
          {laden && !berichten ? 'Zoeken…' : `${totaal} resultaat${totaal === 1 ? '' : 'en'} voor “${zoek}”`}
        </p>
      )}

      <div className="ml-lijst-scroll">
        {fout && !berichten ? (
          <div className="ml-leeg" role="alert">
            <p className="ml-leeg-titel ml-fout">{fout.message}</p>
            <button type="button" className="db-knop" onClick={onOpnieuw}>
              Opnieuw
            </button>
          </div>
        ) : !berichten ? (
          <ul className="ml-rijen" aria-busy="true" aria-label="Berichten laden">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="ml-rij-skelet">
                <div className="db-skelet" style={{ width: `${55 - (i % 3) * 10}%` }} />
                <div className="db-skelet" style={{ width: `${85 - (i % 4) * 8}%` }} />
              </li>
            ))}
          </ul>
        ) : berichten.length === 0 ? (
          <div className="ml-leeg">
            <p className="ml-leeg-titel">{zoek ? 'Niets gevonden' : `${mapNaam} is leeg`}</p>
            <p className="ml-leeg-tekst">
              {zoek ? 'Probeer een ander woord, een naam of een mailadres.' : rol === 'inbox' ? 'Alles bijgewerkt. Lekker.' : 'Er staan hier geen berichten.'}
            </p>
          </div>
        ) : (
          <ul className="ml-rijen" ref={lijstRef}>
            {berichten.map((b) => {
              const persoon = toonAan ? (b.aan[0] ? `Aan: ${adresNaam(b.aan[0])}` : '(geen ontvanger)') : adresNaam(b.van);
              return (
                <li key={b.uid} data-uid={b.uid}>
                  <button
                    type="button"
                    className={`ml-rij${b.gelezen ? '' : ' ml-rij-nieuw'}`}
                    aria-current={b.uid === geselecteerd ? 'true' : undefined}
                    onClick={() => onKies(b.uid)}
                  >
                    <span className="ml-rij-stip" aria-hidden="true" />
                    <span className="ml-rij-boven">
                      <span className="ml-rij-van">{persoon}</span>
                      <time className="ml-rij-datum" dateTime={b.datum ?? undefined}>
                        {lijstDatum(b.datum)}
                      </time>
                    </span>
                    <span className="ml-rij-onder">
                      <span className="ml-rij-onderwerp">{b.onderwerp || '(geen onderwerp)'}</span>
                      <span className="ml-rij-tekens">
                        {b.beantwoord && <Icoon naam="antwoord" grootte={13} className="ml-rij-icoon" />}
                        {b.heeftBijlagen && <Icoon naam="clip" grootte={13} className="ml-rij-icoon" />}
                      </span>
                    </span>
                    <span className="sr-only">{b.gelezen ? '' : 'Ongelezen. '}</span>
                  </button>
                  <button
                    type="button"
                    className={`ml-rij-vlag${b.gemarkeerd ? ' ml-aan' : ''}`}
                    aria-label={b.gemarkeerd ? 'Markering weghalen' : 'Markeren'}
                    aria-pressed={b.gemarkeerd}
                    title={b.gemarkeerd ? 'Markering weghalen (s)' : 'Markeren (s)'}
                    onClick={() => onVlag(b)}
                  >
                    <Icoon naam="vlag" grootte={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {berichten && berichten.length > 0 && meer && (
          <div className="ml-meer">
            <button type="button" className="db-knop" onClick={onMeer} disabled={meerLaden}>
              {meerLaden ? 'Laden…' : 'Meer laden'}
            </button>
          </div>
        )}
        {laden && berichten && <div className="ml-laadbalk" aria-hidden="true" />}
      </div>
    </section>
  );
}
