'use client';

import { useState } from 'react';
import { Persoon } from '@/components/team/Persoon';

export interface SubtaakRegel {
  /** Vaste sleutel in de lijst (ook voor nog niet opgeslagen regels). */
  sleutel: string;
  titel: string;
  klaar: boolean;
  klaarDoor?: string | null;
}

export const MAX_SUBTAKEN = 50;

/**
 * Afvinkbare subtaken: toevoegen met Enter, weghalen, omhoog/omlaag. Bij een nieuwe taak
 * is afvinken niet nodig (vinkjes verborgen); bij een bestaande taak slaat de ouder elke
 * wijziging direct op.
 */
export function SubtakenLijst({
  regels,
  afvinkbaar,
  uitgeschakeld = false,
  bezig = false,
  onToevoegen,
  onVerwijder,
  onVerplaats,
  onVink
}: {
  regels: SubtaakRegel[];
  afvinkbaar: boolean;
  uitgeschakeld?: boolean;
  bezig?: boolean;
  onToevoegen: (titel: string) => void | Promise<boolean | void>;
  onVerwijder: (i: number) => void;
  onVerplaats: (i: number, richting: -1 | 1) => void;
  onVink?: (i: number) => void;
}) {
  const [tekst, setTekst] = useState('');
  const [fout, setFout] = useState('');
  const klaar = regels.filter((r) => r.klaar).length;
  const vol = regels.length >= MAX_SUBTAKEN;

  async function voegToe() {
    const t = tekst.replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (t.length > 200) {
      setFout('Een subtaak is maximaal 200 tekens.');
      return;
    }
    if (vol) {
      setFout(`Maximaal ${MAX_SUBTAKEN} subtaken.`);
      return;
    }
    setFout('');
    const r = await onToevoegen(t);
    if (r !== false) setTekst('');
  }

  return (
    <div className="tk-sub">
      {regels.length > 0 && (
        <>
          {afvinkbaar && (
            <div className="tk-sub-voortgang" aria-label={`${klaar} van ${regels.length} subtaken klaar`}>
              <span className="tk-sub-balk">
                <span style={{ width: `${(klaar / regels.length) * 100}%` }} />
              </span>
              <span className="tk-sub-teller">
                {klaar}/{regels.length}
              </span>
            </div>
          )}
          <ul className="tk-sub-lijst">
            {regels.map((r, i) => (
              <li key={r.sleutel} className={`tk-sub-regel${r.klaar ? ' is-klaar' : ''}`}>
                {afvinkbaar ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={r.klaar}
                    aria-label={r.klaar ? `‘${r.titel}’ weer openzetten` : `‘${r.titel}’ afvinken`}
                    className="ag-vink ag-vink-klein"
                    disabled={uitgeschakeld}
                    onClick={() => onVink?.(i)}
                  >
                    <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : (
                  <span className="tk-sub-punt" aria-hidden="true" />
                )}
                <span className="tk-sub-titel">{r.titel}</span>
                {r.klaar && r.klaarDoor && <Persoon id={r.klaarDoor} compact voorvoegsel="afgevinkt door" />}
                {!uitgeschakeld && (
                  <span className="tk-sub-acties">
                    <button type="button" className="tk-mini" aria-label={`‘${r.titel}’ omhoog`} disabled={i === 0 || bezig} onClick={() => onVerplaats(i, -1)}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="tk-mini"
                      aria-label={`‘${r.titel}’ omlaag`}
                      disabled={i === regels.length - 1 || bezig}
                      onClick={() => onVerplaats(i, 1)}
                    >
                      ↓
                    </button>
                    <button type="button" className="tk-mini tk-mini-weg" aria-label={`‘${r.titel}’ weghalen`} disabled={bezig} onClick={() => onVerwijder(i)}>
                      ×
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {!uitgeschakeld && (
        <div className="tk-sub-nieuw">
          <span className="tk-sub-plus" aria-hidden="true">
            +
          </span>
          <input
            type="text"
            className="tk-sub-veld"
            placeholder={vol ? `Maximaal ${MAX_SUBTAKEN} subtaken` : 'Subtaak toevoegen (Enter)'}
            aria-label="Subtaak toevoegen"
            value={tekst}
            maxLength={200}
            disabled={vol || bezig}
            onChange={(e) => {
              setTekst(e.target.value);
              setFout('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                void voegToe();
              }
            }}
          />
          {tekst.trim() && (
            <button type="button" className="ag-link-knop" onClick={() => void voegToe()}>
              Toevoegen
            </button>
          )}
        </div>
      )}
      {fout && (
        <p className="ag-fout" role="alert">
          {fout}
        </p>
      )}
    </div>
  );
}
