'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { KLANT_STATUS_LABEL, type KlantRegel, type KlantStatus } from '@/lib/crm/types';
import { StatusPil } from './StatusPil';

type Filter = 'alle' | KlantStatus;

/** Het klantenoverzicht: zoeken en filteren gebeurt direct in de browser (kleine lijst). */
export function KlantenLijst({ klanten }: { klanten: KlantRegel[] }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('alle');

  const aantal = (f: Filter) => (f === 'alle' ? klanten.length : klanten.filter((k) => k.status === f).length);
  const zichtbaar = useMemo(() => {
    const z = q.trim().toLowerCase();
    return klanten.filter(
      (k) =>
        (filter === 'alle' || k.status === filter) &&
        (!z || k.naam.toLowerCase().includes(z) || k.contactpersoon.toLowerCase().includes(z) || k.email.toLowerCase().includes(z))
    );
  }, [klanten, q, filter]);

  return (
    <>
      <div className="kp-balk">
        <input
          className="ag-veld kp-zoek"
          type="search"
          placeholder="Zoek op naam, contactpersoon of e-mail"
          aria-label="Zoek klanten"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="ag-segment" role="group" aria-label="Status">
          {(['alle', 'lead', 'actief', 'afgerond'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? 'is-aan' : ''} onClick={() => setFilter(f)}>
              {f === 'alle' ? 'Alle' : KLANT_STATUS_LABEL[f]} · {aantal(f)}
            </button>
          ))}
        </div>
      </div>

      {klanten.length === 0 ? (
        <div className="db-melding">
          <p className="db-melding-titel">Nog geen klanten</p>
          <p className="db-melding-tekst">Voeg je eerste klant toe met “+ Klant”. Klanten die je bij een factuur aanmaakt, staan hier ook.</p>
        </div>
      ) : zichtbaar.length === 0 ? (
        <p className="kp-leeg">Geen klanten gevonden.</p>
      ) : (
        <ul className="kp-lijst">
          {zichtbaar.map((k) => (
            <li key={k.id}>
              <Link className="kp-rij" href={`/klanten/${k.id}`}>
                <span className="kp-rij-hoofd">
                  <span className="kp-rij-titel">{k.naam}</span>
                  <span className="kp-rij-sub">{[k.contactpersoon, k.email].filter(Boolean).join(' · ') || '—'}</span>
                </span>
                <span className="kp-rij-meta">
                  {k.lopendeProjecten > 0 && (
                    <span>
                      {k.lopendeProjecten} {k.lopendeProjecten === 1 ? 'project' : 'projecten'}
                    </span>
                  )}
                  <StatusPil status={k.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
