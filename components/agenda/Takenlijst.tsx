'use client';

import { dagTekst, inAmsterdam, korteDag } from '@/lib/agenda/datum';
import type { Taak, TakenFilter, Tellingen } from '@/lib/agenda/types';
import { TaakRij } from './TaakRij';

const TABS: { id: TakenFilter; label: string }[] = [
  { id: 'vandaag', label: 'Vandaag' },
  { id: 'telaat', label: 'Te laat' },
  { id: 'gepland', label: 'Gepland' },
  { id: 'ooit', label: 'Ooit' },
  { id: 'afgerond', label: 'Afgerond' }
];

const LEEG: Record<TakenFilter, { titel: string; tekst: string }> = {
  vandaag: { titel: 'Niets meer voor vandaag', tekst: 'Typ hierboven een taak, of plan iets in voor morgen.' },
  telaat: { titel: 'Niets achterstallig', tekst: 'Alle taken met een verlopen datum zijn afgerond.' },
  gepland: { titel: 'Nog niets gepland', tekst: 'Taken met een datum na vandaag verschijnen hier, per dag.' },
  ooit: { titel: 'Geen losse ideeën', tekst: 'Taken zonder datum komen hier. Sleep ze naar een dag in de agenda om ze in te plannen.' },
  afgerond: { titel: 'Nog niets afgerond', tekst: 'Afgevinkte taken verschijnen hier, de nieuwste bovenaan.' }
};

type Groep = { sleutel: string; titel: string; sub?: string; gevaar?: boolean; taken: Taak[] };

function groepeer(filter: TakenFilter, taken: Taak[], vandaag: string): Groep[] {
  const groepen: Groep[] = [];
  const bij = (sleutel: string, maak: () => Omit<Groep, 'taken'>, t: Taak) => {
    let g = groepen.find((x) => x.sleutel === sleutel);
    if (!g) {
      g = { ...maak(), taken: [] };
      groepen.push(g);
    }
    g.taken.push(t);
  };
  for (const t of taken) {
    if (filter === 'ooit') bij('ooit', () => ({ sleutel: 'ooit', titel: 'Zonder datum' }), t);
    else if (filter === 'afgerond') {
      const d = t.afgerondOp ? inAmsterdam(t.afgerondOp).dag : vandaag;
      bij(d, () => ({ sleutel: d, titel: `Afgerond ${dagTekst(d, vandaag)}` }), t);
    } else if (filter === 'vandaag' || filter === 'telaat') {
      // Afgevinkt in deze sessie blijft even staan (met "ongedaan maken"), in zijn groep.
      const laat = !!t.datum && t.datum < vandaag;
      if (laat) bij('telaat', () => ({ sleutel: 'telaat', titel: 'Te laat', gevaar: true }), t);
      else bij('vandaag', () => ({ sleutel: 'vandaag', titel: 'Vandaag', sub: korteDag(vandaag) }), t);
    } else {
      const d = t.datum ?? '';
      bij(d, () => ({ sleutel: d, titel: dagTekst(d, vandaag), sub: korteDag(d) }), t);
    }
  }
  // "Te laat" altijd bovenaan.
  return groepen.sort((a, b) => Number(!!b.gevaar) - Number(!!a.gevaar));
}

export function Takenlijst({
  filter,
  onFilter,
  taken,
  tellingen,
  vandaag,
  laden,
  fout,
  onOpnieuw,
  onToggle,
  onOpen
}: {
  filter: TakenFilter;
  onFilter: (f: TakenFilter) => void;
  taken: Taak[] | null;
  tellingen: Tellingen | null;
  vandaag: string;
  laden: boolean;
  fout: string | null;
  onOpnieuw: () => void;
  onToggle: (t: Taak) => void;
  onOpen: (t: Taak) => void;
}) {
  const groepen = taken ? groepeer(filter, taken, vandaag) : [];
  return (
    <div className="ag-lijst">
      <div className="ag-tabs" role="tablist" aria-label="Takenlijst">
        {TABS.map((t) => {
          const n = tellingen && t.id !== 'afgerond' ? tellingen[t.id] : 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={filter === t.id}
              className={`ag-tab${filter === t.id ? ' is-aan' : ''}`}
              onClick={() => onFilter(t.id)}
            >
              {t.label}
              {n > 0 && <span className={`ag-tab-aantal${t.id === 'telaat' ? ' is-gevaar' : ''}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="ag-lijst-inhoud" role="tabpanel" aria-busy={laden}>
        {fout ? (
          <div className="db-melding db-melding-fout" role="alert">
            <p className="db-melding-titel">Taken konden niet worden geladen</p>
            <p className="db-melding-tekst">{fout}</p>
            <div className="db-melding-actie">
              <button type="button" className="db-knop" onClick={onOpnieuw}>
                Opnieuw
              </button>
            </div>
          </div>
        ) : !taken ? (
          <div className="ag-lijst-skelet" aria-hidden="true">
            {[80, 62, 70, 48].map((w) => (
              <div key={w} className="db-skelet" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : groepen.length === 0 ? (
          <div className="db-melding">
            <p className="db-melding-titel">{LEEG[filter].titel}</p>
            <p className="db-melding-tekst">{LEEG[filter].tekst}</p>
          </div>
        ) : (
          groepen.map((g) => (
            <section key={g.sleutel} className="ag-groep">
              {(groepen.length > 1 || filter === 'gepland' || filter === 'afgerond') && (
                <h3 className={`ag-groep-kop${g.gevaar ? ' is-gevaar' : ''}`}>
                  <span>{g.titel}</span>
                  {g.sub && g.sub !== g.titel && <span className="ag-groep-sub">{g.sub}</span>}
                  <span className="ag-groep-aantal">{g.taken.length}</span>
                </h3>
              )}
              <ul className="ag-taken">
                {g.taken.map((t) => (
                  <TaakRij
                    key={t.id}
                    taak={t}
                    vandaag={vandaag}
                    onToggle={onToggle}
                    onOpen={onOpen}
                    toonDatum={filter === 'telaat' || filter === 'afgerond' || (filter === 'vandaag' && g.gevaar)}
                    versleepbaar={filter !== 'afgerond'}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
