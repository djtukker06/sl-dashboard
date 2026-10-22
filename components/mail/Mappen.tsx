'use client';

import { useState } from 'react';
import type { MailApiFout } from '@/lib/mail/client';
import type { MailMap, MapRol } from '@/lib/mail/types';
import { Icoon, type MailIcoonNaam } from './Iconen';

const ICOON: Record<MapRol, MailIcoonNaam> = {
  inbox: 'inbox',
  verzonden: 'verzonden',
  concepten: 'concepten',
  archief: 'archief',
  spam: 'spam',
  prullenbak: 'prullenbak',
  overig: 'map'
};

// Mappenlijst: speciale mappen bovenaan, eigen mappen ingeklapt eronder.
export function Mappen({
  mappen,
  fout,
  actief,
  onKies,
  onOpnieuw
}: {
  mappen: MailMap[] | null;
  fout: MailApiFout | null;
  actief: string;
  onKies: (pad: string) => void;
  onOpnieuw: () => void;
}) {
  const overige = (mappen ?? []).filter((m) => m.rol === 'overig');
  const [overigOpen, setOverigOpen] = useState(() => overige.some((m) => m.pad === actief));

  if (!mappen) {
    if (fout) {
      return (
        <div className="ml-mappen-fout" role="alert">
          <p>{fout.message}</p>
          <button type="button" className="db-knop" onClick={onOpnieuw}>
            Opnieuw
          </button>
        </div>
      );
    }
    return (
      <ul className="ml-mappen-lijst" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="ml-map ml-map-skelet">
            <div className="db-skelet" style={{ width: `${70 - i * 6}%` }} />
          </li>
        ))}
      </ul>
    );
  }

  const speciaal = mappen.filter((m) => m.rol !== 'overig');
  const knop = (m: MailMap) => (
    <li key={m.pad}>
      <button
        type="button"
        className="ml-map"
        aria-current={m.pad === actief ? 'true' : undefined}
        style={m.rol === 'overig' && m.niveau ? { paddingLeft: 12 + m.niveau * 14 } : undefined}
        onClick={() => onKies(m.pad)}
      >
        <Icoon naam={ICOON[m.rol]} grootte={17} />
        <span className="ml-map-naam">{m.naam}</span>
        {m.ongelezen > 0 && m.rol !== 'verzonden' && m.rol !== 'prullenbak' && (
          <span className={`ml-map-aantal${m.rol === 'inbox' ? ' ml-map-aantal-sterk' : ''}`}>
            {m.ongelezen > 999 ? '999+' : m.ongelezen}
            <span className="sr-only"> ongelezen</span>
          </span>
        )}
      </button>
    </li>
  );

  return (
    <nav aria-label="Mappen">
      <ul className="ml-mappen-lijst">{speciaal.map(knop)}</ul>
      {overige.length > 0 && (
        <>
          <button
            type="button"
            className="ml-mappen-sectie"
            aria-expanded={overigOpen}
            onClick={() => setOverigOpen((o) => !o)}
          >
            <span>Mappen</span>
            <Icoon naam="pijlOmlaag" grootte={14} className={`ml-icoon ml-draai${overigOpen ? ' ml-open' : ''}`} />
          </button>
          {overigOpen && <ul className="ml-mappen-lijst">{overige.map(knop)}</ul>}
        </>
      )}
    </nav>
  );
}
