'use client';

import { useState } from 'react';
import { DAGNAMEN_KORT, dagDelen, inAmsterdam, type Dag } from '@/lib/agenda/datum';
import { isBalk, itemsOpDag } from '@/lib/agenda/weergave';
import type { Afspraak, Taak } from '@/lib/agenda/types';
import type { Selectie } from './ItemPaneel';
import type { Verplaatsing } from './WeekView';

const MAX = 3;
const SLEEP_TYPE = 'application/x-sl-item';

/** Maandweergave: 6×7 dagen, maximaal 3 items per dag, daarna "+N". Klik op een dag = week. */
export function MaandView({
  dagen,
  maand,
  vandaag,
  taken,
  afspraken,
  onOpen,
  onKiesDag,
  onVerplaats
}: {
  dagen: Dag[];
  /** Maandnummer (1–12) dat centraal staat; andere dagen worden gedimd. */
  maand: number;
  vandaag: Dag;
  taken: Taak[];
  afspraken: Afspraak[];
  onOpen: (s: Selectie) => void;
  onKiesDag: (d: Dag) => void;
  onVerplaats: (v: Verplaatsing) => void;
}) {
  const [drop, setDrop] = useState<string | null>(null);

  function opDrop(e: React.DragEvent, dag: Dag) {
    setDrop(null);
    const taakId = e.dataTransfer.getData('application/x-sl-taak');
    const item = e.dataTransfer.getData(SLEEP_TYPE);
    e.preventDefault();
    if (taakId) {
      const t = taken.find((x) => x.id === taakId) ?? ({ id: taakId } as Taak);
      onVerplaats({ soort: 'taak', item: t, datum: dag, tijd: t.tijd ?? null });
    } else if (item) {
      const [soort, id] = item.split(':');
      if (soort === 'taak') {
        const t = taken.find((x) => x.id === id);
        if (t && t.datum !== dag) onVerplaats({ soort: 'taak', item: t, datum: dag, tijd: t.tijd });
      } else {
        const a = afspraken.find((x) => x.id === id);
        if (a && inAmsterdam(a.start).dag !== dag) onVerplaats({ soort: 'afspraak', item: a, datum: dag, start: null });
      }
    }
  }

  return (
    <div className="ag-maand">
      <div className="ag-maand-kop" aria-hidden="true">
        {DAGNAMEN_KORT.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="ag-maand-raster">
        {dagen.map((d) => {
          const items = itemsOpDag(d, taken, afspraken);
          const meer = items.length - MAX;
          const { m, d: nr } = dagDelen(d);
          return (
            <div
              key={d}
              className={`ag-maand-dag${m !== maand ? ' is-buiten' : ''}${d === vandaag ? ' is-vandaag' : ''}${drop === d ? ' is-drop' : ''}`}
              onClick={(e) => {
                if (e.target === e.currentTarget) onKiesDag(d);
              }}
              onDragOver={(e) => {
                const t = e.dataTransfer.types;
                if (!t.includes('application/x-sl-taak') && !t.includes(SLEEP_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (drop !== d) setDrop(d);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
              }}
              onDrop={(e) => opDrop(e, d)}
            >
              <button type="button" className="ag-maand-nr" onClick={() => onKiesDag(d)} aria-label={`Week van ${d} tonen`}>
                {nr}
              </button>
              <ul className="ag-maand-items">
                {items.slice(0, meer > 0 ? MAX - 1 : MAX).map((x) => {
                  const af = x.soort === 'taak' && x.item.afgerond;
                  const tijd =
                    x.soort === 'afspraak'
                      ? isBalk(x.item)
                        ? ''
                        : inAmsterdam(x.item.start).dag === d
                          ? inAmsterdam(x.item.start).tijd
                          : ''
                      : (x.item.tijd ?? '');
                  return (
                    <li key={`${x.soort}:${x.item.id}`}>
                      <button
                        type="button"
                        draggable={!af}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(SLEEP_TYPE, `${x.soort}:${x.item.id}`);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        className={`ag-maand-item ag-maand-${x.soort}${af ? ' is-af' : ''}${x.soort === 'afspraak' && isBalk(x.item) ? ' is-balk' : ''}`}
                        onClick={() =>
                          onOpen(x.soort === 'taak' ? { soort: 'taak', item: x.item } : { soort: 'afspraak', item: x.item })
                        }
                        title={x.item.titel}
                      >
                        {tijd && <span className="ag-maand-tijd">{tijd}</span>}
                        <span className="ag-maand-titel">{x.item.titel}</span>
                      </button>
                    </li>
                  );
                })}
                {meer > 0 && (
                  <li>
                    <button type="button" className="ag-maand-meer" onClick={() => onKiesDag(d)}>
                      +{meer + 1} meer
                    </button>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
