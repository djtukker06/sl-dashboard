'use client';

import Link from 'next/link';
import { dagTekst, duurTekst } from '@/lib/agenda/datum';
import type { Taak } from '@/lib/agenda/types';

/** Ronde afvinkknop in de huisstijl (toetsenbord: spatie/enter). */
export function Afvinker({ taak, onToggle, klein }: { taak: Taak; onToggle: (t: Taak) => void; klein?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={taak.afgerond}
      aria-label={taak.afgerond ? `‘${taak.titel}’ weer openzetten` : `‘${taak.titel}’ afvinken`}
      className={`ag-vink${klein ? ' ag-vink-klein' : ''}${taak.prioriteit === 1 ? ' ag-vink-hoog' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(taak);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function TaakMeta({ taak, vandaag, toonDatum }: { taak: Taak; vandaag: string; toonDatum: boolean }) {
  const delen: string[] = [];
  if (toonDatum && taak.datum) delen.push(dagTekst(taak.datum, vandaag));
  if (taak.tijd) delen.push(taak.tijd);
  if (taak.duur) delen.push(duurTekst(taak.duur));
  if (!delen.length && !taak.klantNaam && !taak.notitie) return null;
  return (
    <span className="ag-taak-meta">
      {delen.length > 0 && <span>{delen.join(' · ')}</span>}
      {taak.klantNaam && <span className="ag-chip ag-chip-klant ag-chip-mini">{taak.klantNaam}</span>}
      {taak.notitie && (
        <svg className="ag-notitie-icoon" viewBox="0 0 16 16" width="12" height="12" aria-label="Heeft een notitie">
          <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

/** Eén taak in een lijst: afvinken, titel, datum/tijd, klant en prioriteit. */
export function TaakRij({
  taak,
  vandaag,
  onToggle,
  onOpen,
  href,
  toonDatum = true,
  versleepbaar = false
}: {
  taak: Taak;
  vandaag: string;
  onToggle: (t: Taak) => void;
  onOpen?: (t: Taak) => void;
  href?: string;
  toonDatum?: boolean;
  versleepbaar?: boolean;
}) {
  const teLaat = !taak.afgerond && !!taak.datum && taak.datum < vandaag;
  const klasse = `ag-taak${taak.afgerond ? ' is-af' : ''}${teLaat ? ' is-telaat' : ''}`;
  const inhoud = (
    <>
      <span className="ag-taak-titel">{taak.titel}</span>
      <TaakMeta taak={taak} vandaag={vandaag} toonDatum={toonDatum} />
    </>
  );
  return (
    <li
      className={klasse}
      draggable={versleepbaar && !taak.afgerond}
      onDragStart={
        versleepbaar
          ? (e) => {
              e.dataTransfer.setData('application/x-sl-taak', taak.id);
              e.dataTransfer.effectAllowed = 'move';
            }
          : undefined
      }
    >
      <Afvinker taak={taak} onToggle={onToggle} />
      {href ? (
        <Link className="ag-taak-hoofd" href={href}>
          {inhoud}
        </Link>
      ) : (
        <button type="button" className="ag-taak-hoofd" onClick={() => onOpen?.(taak)}>
          {inhoud}
        </button>
      )}
      {taak.prioriteit !== 2 && (
        <span
          className={`ag-prio ag-prio-${taak.prioriteit === 1 ? 'hoog' : 'laag'}`}
          title={taak.prioriteit === 1 ? 'Hoge prioriteit' : 'Lage prioriteit'}
          aria-label={taak.prioriteit === 1 ? 'Hoge prioriteit' : 'Lage prioriteit'}
        />
      )}
    </li>
  );
}
