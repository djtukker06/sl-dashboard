'use client';

import { useEffect, useRef, useState } from 'react';
import { DAGNAMEN_KORT, dagDelen, inAmsterdam, minutenNaarTijd, plusDagen, weekdagIndex, type Dag } from '@/lib/agenda/datum';
import { afspraakRaakt, blokkenOpDag, indelen, isBalk, tijdvak, type Blok } from '@/lib/agenda/weergave';
import { magAfspraakWijzigen, magTaakWijzigen } from '@/lib/agenda/rechten';
import type { Afspraak, Taak } from '@/lib/agenda/types';
import { useTeam } from '@/components/team/TeamProvider';
import type { Selectie } from './ItemPaneel';
import { Afvinker, Toegewezenen } from './TaakRij';
import { personenVan, wieStijl } from './wieKleur';

const UUR = 48; // px per uur
const STAP = 15; // slepen in stappen van 15 minuten

export type Verplaatsing =
  | { soort: 'taak'; item: Taak; datum: Dag; tijd: string | null }
  | { soort: 'afspraak'; item: Afspraak; datum: Dag; start: string | null };

type Sleep = {
  blok: Blok;
  x0: number;
  y0: number;
  bezig: boolean;
  dagIndex0: number;
  dagDelta: number;
  minDelta: number;
  /** Mag niet verplaatst worden: alleen openen bij loslaten. */
  alleenKlik?: boolean;
};

/** Weekweergave: kolommen per dag, uren 00–24 (scrollt naar 07:00), bovenin hele dag / zonder tijd. */
export function WeekView({
  dagen,
  vandaag,
  nu,
  taken,
  afspraken,
  onOpen,
  onToggle,
  onNieuw,
  onVerplaats,
  onKiesDag,
  teamWeergave = false
}: {
  dagen: Dag[];
  vandaag: Dag;
  nu: number | null;
  taken: Taak[];
  afspraken: Afspraak[];
  onOpen: (s: Selectie) => void;
  onToggle: (t: Taak) => void;
  onNieuw: (dag: Dag, tijd: string | null, x: number, y: number) => void;
  onVerplaats: (v: Verplaatsing) => void;
  onKiesDag?: (dag: Dag) => void;
  /** Taken/afspraken van het team: gekleurde rand per persoon en mini-avatars. */
  teamWeergave?: boolean;
}) {
  const { perId, mijnId, overgang } = useTeam();
  const team = teamWeergave ? ' is-team' : '';
  const scroll = useRef<HTMLDivElement>(null);
  const kolommen = useRef<HTMLDivElement>(null);
  const sleepRef = useRef<Sleep | null>(null);
  const [sleep, setSleep] = useState<Sleep | null>(null);
  const [dropDag, setDropDag] = useState<string | null>(null);

  // Bij openen naar 07:00 scrollen (of naar het huidige uur als dat later is).
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const uur = nu && dagen.includes(vandaag) ? Math.max(7, Math.min(inAmsterdam(nu).minuten / 60 - 2, 15)) : 7;
    el.scrollTop = uur * UUR - 8;
    // Alleen bij het eerste tonen; daarna bepaalt de gebruiker de scrollpositie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nuAms = nu ? inAmsterdam(nu) : null;

  function dagIndexBijX(x: number): number {
    const el = kolommen.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const i = Math.floor(((x - r.left) / r.width) * dagen.length);
    return Math.max(0, Math.min(dagen.length - 1, i));
  }

  function minutenBijY(y: number, kolom: HTMLElement): number {
    const r = kolom.getBoundingClientRect();
    return Math.max(0, Math.min(1439, ((y - r.top) / UUR) * 60));
  }

  // ---------- slepen van blokken (pointer events) ----------
  function startSleep(e: React.PointerEvent, blok: Blok, dagIndex: number) {
    if (e.button !== 0 || (blok.soort === 'taak' && blok.item.afgerond)) return;
    // Alleen slepen wat je mag wijzigen (maker of toegewezen/deelnemer); klikken opent nog wel.
    const mag = blok.soort === 'taak' ? magTaakWijzigen(blok.item, mijnId, overgang) : magAfspraakWijzigen(blok.item, mijnId, overgang);
    if (!mag) {
      sleepRef.current = { blok, x0: e.clientX, y0: e.clientY, bezig: false, dagIndex0: dagIndex, dagDelta: 0, minDelta: 0, alleenKlik: true };
      return;
    }
    sleepRef.current = { blok, x0: e.clientX, y0: e.clientY, bezig: false, dagIndex0: dagIndex, dagDelta: 0, minDelta: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function beweeg(e: React.PointerEvent) {
    const s = sleepRef.current;
    if (!s || s.alleenKlik) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.bezig && Math.hypot(dx, dy) < 5) return;
    s.bezig = true;
    s.minDelta = Math.round((dy / UUR) * (60 / STAP)) * STAP;
    s.dagDelta = dagIndexBijX(e.clientX) - s.dagIndex0;
    // Niet vóór 00:00 of na 24:00 van de dag.
    const start = s.blok.start + s.minDelta;
    if (start < 0) s.minDelta = -s.blok.start;
    if (start > 1440 - STAP) s.minDelta = 1440 - STAP - s.blok.start;
    setSleep({ ...s });
  }

  function eindeSleep(e: React.PointerEvent) {
    const s = sleepRef.current;
    sleepRef.current = null;
    setSleep(null);
    if (!s) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!s.bezig) {
      onOpen(s.blok.soort === 'taak' ? { soort: 'taak', item: s.blok.item } : { soort: 'afspraak', item: s.blok.item });
      return;
    }
    if (!s.dagDelta && !s.minDelta) return;
    const nieuweDag = dagen[Math.max(0, Math.min(dagen.length - 1, s.dagIndex0 + s.dagDelta))];
    if (s.blok.soort === 'taak') {
      onVerplaats({ soort: 'taak', item: s.blok.item, datum: nieuweDag, tijd: minutenNaarTijd(s.blok.start + s.minDelta) });
    } else {
      // Afspraak: verschuif het échte begin (ook als het blok op deze dag is afgekapt).
      const b = inAmsterdam(s.blok.item.start);
      const dagVerschuiving = dagen.indexOf(nieuweDag) - s.dagIndex0;
      const startMin = b.minuten + s.minDelta;
      const extraDagen = Math.floor(startMin / 1440);
      const basisDag = plusDagen(b.dag, dagVerschuiving + extraDagen);
      onVerplaats({ soort: 'afspraak', item: s.blok.item, datum: basisDag, start: minutenNaarTijd(startMin) });
    }
  }

  // ---------- slepen vanuit de takenlijst (HTML5 drag & drop) ----------
  function dropTaak(e: React.DragEvent, dag: Dag, tijd: string | null) {
    const id = e.dataTransfer.getData('application/x-sl-taak');
    setDropDag(null);
    if (!id) return;
    e.preventDefault();
    const t = taken.find((x) => x.id === id);
    if (t) onVerplaats({ soort: 'taak', item: t, datum: dag, tijd });
    else onVerplaats({ soort: 'taak', item: { id } as Taak, datum: dag, tijd });
  }
  const overTaak = (e: React.DragEvent, sleutel: string) => {
    if (!e.dataTransfer.types.includes('application/x-sl-taak')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropDag !== sleutel) setDropDag(sleutel);
  };

  return (
    <div className="ag-week" style={{ '--ag-dagen': dagen.length } as React.CSSProperties}>
      <div className="ag-week-kop">
        <div className="ag-week-gutter" />
        {dagen.map((d) => {
          const { d: dagNr } = dagDelen(d);
          return (
            <button
              key={d}
              type="button"
              className={`ag-week-dag${d === vandaag ? ' is-vandaag' : ''}${weekdagIndex(d) >= 5 ? ' is-weekend' : ''}`}
              onClick={() => onKiesDag?.(d)}
              title="Naar deze dag"
            >
              <span className="ag-week-dagnaam">{DAGNAMEN_KORT[weekdagIndex(d)]}</span>
              <span className="ag-week-dagnr">{dagNr}</span>
            </button>
          );
        })}
      </div>

      <div className="ag-week-heledag">
        <div className="ag-week-gutter ag-week-gutter-label">hele dag</div>
        {dagen.map((d) => {
          const balken = afspraken.filter((a) => isBalk(a) && afspraakRaakt(a, d));
          const losse = taken.filter((t) => t.datum === d && !t.tijd);
          return (
            <div
              key={d}
              className={`ag-week-heledag-cel${dropDag === `h${d}` ? ' is-drop' : ''}`}
              onClick={(e) => {
                if (e.target === e.currentTarget) onNieuw(d, null, e.clientX, e.clientY);
              }}
              onDragOver={(e) => overTaak(e, `h${d}`)}
              onDragLeave={() => setDropDag(null)}
              onDrop={(e) => dropTaak(e, d, null)}
            >
              {balken.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`ag-balk${team}`}
                  style={wieStijl(a, perId, teamWeergave)}
                  onClick={() => onOpen({ soort: 'afspraak', item: a })}
                  title={`${a.titel} · ${tijdvak(a)}`}
                >
                  {a.titel}
                </button>
              ))}
              {losse.map((t) => (
                <div key={t.id} className={`ag-mini-taak${t.afgerond ? ' is-af' : ''}${team}`} style={wieStijl(t, perId, teamWeergave)}>
                  <Afvinker taak={t} onToggle={onToggle} klein />
                  <button type="button" className="ag-mini-taak-titel" onClick={() => onOpen({ soort: 'taak', item: t })}>
                    {t.titel}
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="ag-week-scroll" ref={scroll}>
        <div className="ag-week-raster" style={{ height: 24 * UUR }}>
          <div className="ag-week-gutter ag-week-uren" aria-hidden="true">
            {Array.from({ length: 24 }, (_, u) => (
              <span key={u} style={{ top: u * UUR }}>
                {u === 0 ? '' : `${String(u).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>
          <div className="ag-week-kolommen" ref={kolommen}>
            {dagen.map((d, i) => {
              const blokken = blokkenOpDag(d, taken, afspraken);
              const lanes = indelen(blokken);
              return (
                <div
                  key={d}
                  className={`ag-week-kolom${d === vandaag ? ' is-vandaag' : ''}${dropDag === `k${d}` ? ' is-drop' : ''}`}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const min = Math.floor(minutenBijY(e.clientY, e.currentTarget) / 30) * 30;
                    onNieuw(d, minutenNaarTijd(min), e.clientX, e.clientY);
                  }}
                  onDragOver={(e) => overTaak(e, `k${d}`)}
                  onDragLeave={() => setDropDag(null)}
                  onDrop={(e) => {
                    const min = Math.floor(minutenBijY(e.clientY, e.currentTarget) / STAP) * STAP;
                    dropTaak(e, d, minutenNaarTijd(min));
                  }}
                >
                  {blokken.map((b) => {
                    const lane = lanes.get(`${b.soort}:${b.id}`) ?? { kolom: 0, kolommen: 1 };
                    const sleept = sleep?.bezig && sleep.blok.soort === b.soort && sleep.blok.id === b.id;
                    const start = b.start + (sleept ? sleep.minDelta : 0);
                    const hoogte = Math.max(((b.eind - b.start) / 60) * UUR, 20);
                    const stijl: React.CSSProperties = {
                      ...wieStijl(b.item, perId, teamWeergave),
                      top: (start / 60) * UUR,
                      height: hoogte,
                      left: sleept ? 2 : `calc(${(lane.kolom / lane.kolommen) * 100}% + 2px)`,
                      width: sleept ? 'calc(100% - 4px)' : `calc(${100 / lane.kolommen}% - 4px)`,
                      transform: sleept ? `translateX(${sleep.dagDelta * 100}%)` : undefined
                    };
                    const kort = hoogte < 38;
                    const label =
                      b.soort === 'afspraak'
                        ? `${b.item.titel}, ${tijdvak(b.item)}`
                        : `Taak ${b.item.titel}, ${b.item.tijd}`;
                    return (
                      <div
                        key={`${b.soort}:${b.id}`}
                        className={`ag-blok ag-blok-${b.soort}${b.soort === 'taak' && b.item.afgerond ? ' is-af' : ''}${sleept ? ' is-sleep' : ''}${kort ? ' is-kort' : ''}${team}`}
                        style={stijl}
                        role="button"
                        tabIndex={0}
                        aria-label={label}
                        title={label}
                        onPointerDown={(e) => startSleep(e, b, i)}
                        onPointerMove={beweeg}
                        onPointerUp={eindeSleep}
                        onPointerCancel={() => {
                          sleepRef.current = null;
                          setSleep(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onOpen(b.soort === 'taak' ? { soort: 'taak', item: b.item } : { soort: 'afspraak', item: b.item });
                          }
                        }}
                      >
                        {b.soort === 'taak' && <Afvinker taak={b.item} onToggle={onToggle} klein />}
                        <span className="ag-blok-tekst">
                          <span className="ag-blok-titel">{b.item.titel}</span>
                          <span className="ag-blok-tijd">
                            {sleept
                              ? minutenNaarTijd(start)
                              : b.soort === 'afspraak'
                                ? tijdvak(b.item)
                                : b.item.tijd}
                            {b.soort === 'afspraak' && b.item.locatie ? ` · ${b.item.locatie}` : ''}
                          </span>
                        </span>
                        {teamWeergave && !kort && <Toegewezenen ids={personenVan(b.item)} metMij max={2} />}
                      </div>
                    );
                  })}
                  {nuAms && d === nuAms.dag && (
                    <div className="ag-nu" style={{ top: (nuAms.minuten / 60) * UUR }} aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

