'use client';

import { useEffect, useRef, useState } from 'react';
import { agendaApi, ApiFout } from '@/lib/agenda/client';
import { inAmsterdam, langeDag, plusDagen } from '@/lib/agenda/datum';
import { dagenVanAfspraak } from '@/lib/agenda/weergave';
import type { Afspraak, Taak } from '@/lib/agenda/types';
import { KlantKiezer } from './KlantKiezer';
import { useToast } from './Toast';

export type Selectie = { soort: 'taak'; item: Taak } | { soort: 'afspraak'; item: Afspraak };

const DUREN = [
  ['', 'Geen'],
  ['15', '15 min'],
  ['30', '30 min'],
  ['45', '45 min'],
  ['60', '1 uur'],
  ['90', '1,5 uur'],
  ['120', '2 uur'],
  ['180', '3 uur'],
  ['240', '4 uur'],
  ['480', 'Hele werkdag']
];

/** Paneel rechts om een taak of afspraak te bekijken en te bewerken. */
export function ItemPaneel({
  selectie,
  onSluit,
  onOpgeslagen,
  onVerwijderd
}: {
  selectie: Selectie;
  onSluit: () => void;
  onOpgeslagen: (s: Selectie) => void;
  onVerwijderd: (s: Selectie) => void;
}) {
  const paneel = useRef<HTMLElement>(null);

  // Esc sluit; focus terug naar waar je was.
  useEffect(() => {
    const vorige = document.activeElement as HTMLElement | null;
    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onSluit();
      }
    }
    document.addEventListener('keydown', toets);
    return () => {
      document.removeEventListener('keydown', toets);
      if (vorige && document.contains(vorige)) vorige.focus({ preventScroll: true });
    };
  }, [onSluit]);

  return (
    <>
      <div className="ag-paneel-achter" onClick={onSluit} aria-hidden="true" />
      <aside
        ref={paneel}
        className="ag-paneel"
        role="dialog"
        aria-label={selectie.soort === 'taak' ? 'Taak bewerken' : 'Afspraak bewerken'}
      >
        {selectie.soort === 'taak' ? (
          <TaakFormulier
            key={selectie.item.id}
            taak={selectie.item}
            onSluit={onSluit}
            onOpgeslagen={(t) => onOpgeslagen({ soort: 'taak', item: t })}
            onVerwijderd={() => onVerwijderd(selectie)}
          />
        ) : (
          <AfspraakFormulier
            key={selectie.item.id}
            afspraak={selectie.item}
            onSluit={onSluit}
            onOpgeslagen={(a) => onOpgeslagen({ soort: 'afspraak', item: a })}
            onVerwijderd={() => onVerwijderd(selectie)}
          />
        )}
      </aside>
    </>
  );
}

function Kop({ label, onSluit }: { label: string; onSluit: () => void }) {
  return (
    <header className="ag-paneel-kop">
      <p className="db-label">{label}</p>
      <button type="button" className="ag-icoonknop" aria-label="Sluiten (Esc)" title="Sluiten (Esc)" onClick={onSluit}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}

function Voet({
  bezig,
  onVerwijder,
  onSluit
}: {
  bezig: boolean;
  onVerwijder: () => void;
  onSluit: () => void;
}) {
  const [zeker, setZeker] = useState(false);
  return (
    <footer className="ag-paneel-voet">
      {zeker ? (
        <span className="ag-zeker">
          <span>Definitief verwijderen?</span>
          <button type="button" className="db-knop ag-knop-gevaar" disabled={bezig} onClick={onVerwijder}>
            Ja, verwijderen
          </button>
          <button type="button" className="db-knop" onClick={() => setZeker(false)}>
            Nee
          </button>
        </span>
      ) : (
        <button type="button" className="ag-link-knop ag-link-gevaar" onClick={() => setZeker(true)}>
          Verwijderen
        </button>
      )}
      {!zeker && (
        <span className="ag-paneel-acties">
          <button type="button" className="db-knop" onClick={onSluit}>
            Annuleren
          </button>
          <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
            {bezig ? 'Bezig…' : 'Opslaan'}
          </button>
        </span>
      )}
    </footer>
  );
}

function useOpslaan() {
  const toast = useToast();
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  async function doe<T>(fn: () => Promise<T>, melding: string): Promise<T | null> {
    setBezig(true);
    setFout('');
    try {
      const r = await fn();
      toast(melding);
      return r;
    } catch (e) {
      setFout(
        e instanceof ApiFout && e.nietIngericht
          ? 'De agenda is nog niet ingericht.'
          : e instanceof Error
            ? e.message
            : 'Opslaan mislukt.'
      );
      return null;
    } finally {
      setBezig(false);
    }
  }
  return { bezig, fout, doe };
}

function TaakFormulier({
  taak,
  onSluit,
  onOpgeslagen,
  onVerwijderd
}: {
  taak: Taak;
  onSluit: () => void;
  onOpgeslagen: (t: Taak) => void;
  onVerwijderd: () => void;
}) {
  const [titel, setTitel] = useState(taak.titel);
  const [notitie, setNotitie] = useState(taak.notitie);
  const [datum, setDatum] = useState(taak.datum ?? '');
  const [tijd, setTijd] = useState(taak.tijd ?? '');
  const [duur, setDuur] = useState(taak.duur ? String(taak.duur) : '');
  const [prio, setPrio] = useState(taak.prioriteit);
  const [afgerond, setAfgerond] = useState(taak.afgerond);
  const [klant, setKlant] = useState(taak.klantId ? { id: taak.klantId, naam: taak.klantNaam ?? 'Klant' } : null);
  const { bezig, fout, doe } = useOpslaan();
  const duurOpties = DUREN.some(([w]) => w === duur) ? DUREN : [...DUREN, [duur, `${duur} min`]];

  async function opslaan(e?: React.FormEvent) {
    e?.preventDefault();
    const r = await doe(
      () =>
        agendaApi.wijzigTaak(taak.id, {
          titel,
          notitie,
          datum: datum || null,
          tijd: datum && tijd ? tijd : null,
          duur: duur ? Number(duur) : null,
          prioriteit: prio,
          klantId: klant?.id ?? null,
          afgerond
        }),
      'Taak opgeslagen'
    );
    if (r) onOpgeslagen(r.task);
  }

  async function verwijder() {
    const r = await doe(() => agendaApi.verwijderTaak(taak.id), 'Taak verwijderd');
    if (r) onVerwijderd();
  }

  return (
    <form
      className="ag-paneel-form"
      onSubmit={opslaan}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void opslaan();
      }}
    >
      <Kop label="Taak" onSluit={onSluit} />
      <div className="ag-paneel-inhoud">
        <label className="ag-titelveld">
          <span className="sr-only">Titel</span>
          <textarea
            className="ag-veld ag-veld-titel"
            value={titel}
            rows={2}
            maxLength={300}
            autoFocus
            onChange={(e) => setTitel(e.target.value.replace(/\n/g, ' '))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault();
            }}
          />
        </label>

        <label className="ag-schakel">
          <input type="checkbox" checked={afgerond} onChange={(e) => setAfgerond(e.target.checked)} />
          <span>Afgerond</span>
        </label>

        <div className="ag-velden-2">
          <label className="ag-label">
            Datum
            <input className="ag-veld" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
          </label>
          <label className="ag-label">
            Tijd
            <input
              className="ag-veld"
              type="time"
              step={300}
              value={tijd}
              disabled={!datum}
              onChange={(e) => setTijd(e.target.value)}
            />
          </label>
        </div>
        {!datum && <p className="ag-uitleg">Zonder datum staat de taak onder ‘Ooit’.</p>}

        <div className="ag-velden-2">
          <label className="ag-label">
            Duur
            <select className="ag-veld" value={duur} onChange={(e) => setDuur(e.target.value)}>
              {duurOpties.map(([w, l]) => (
                <option key={w} value={w}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="ag-label" role="group" aria-label="Prioriteit">
            Prioriteit
            <div className="ag-segment">
              {(
                [
                  [1, 'Hoog'],
                  [2, 'Normaal'],
                  [3, 'Laag']
                ] as const
              ).map(([w, l]) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={prio === w}
                  className={prio === w ? 'is-aan' : ''}
                  onClick={() => setPrio(w)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ag-label">
          Klant
          <KlantKiezer waarde={klant} onChange={setKlant} />
        </div>

        <label className="ag-label">
          Notitie
          <textarea
            className="ag-veld"
            rows={5}
            value={notitie}
            maxLength={10000}
            placeholder="Details, links, afspraken…"
            onChange={(e) => setNotitie(e.target.value)}
          />
        </label>
        {fout && (
          <p className="ag-fout" role="alert">
            {fout}
          </p>
        )}
      </div>
      <Voet bezig={bezig} onVerwijder={verwijder} onSluit={onSluit} />
    </form>
  );
}

function AfspraakFormulier({
  afspraak,
  onSluit,
  onOpgeslagen,
  onVerwijderd
}: {
  afspraak: Afspraak;
  onSluit: () => void;
  onOpgeslagen: (a: Afspraak) => void;
  onVerwijderd: () => void;
}) {
  const s = inAmsterdam(afspraak.start);
  const e = inAmsterdam(afspraak.eind);
  const { laatste } = dagenVanAfspraak(afspraak);
  const [titel, setTitel] = useState(afspraak.titel);
  const [notitie, setNotitie] = useState(afspraak.notitie);
  const [locatie, setLocatie] = useState(afspraak.locatie);
  const [heleDag, setHeleDag] = useState(afspraak.heleDag);
  const [datum, setDatum] = useState(s.dag);
  const [eindDatum, setEindDatum] = useState(afspraak.heleDag ? laatste : s.dag);
  const [start, setStart] = useState(afspraak.heleDag ? '09:00' : s.tijd);
  const [eind, setEind] = useState(afspraak.heleDag ? '10:00' : e.tijd);
  const [klant, setKlant] = useState(afspraak.klantId ? { id: afspraak.klantId, naam: afspraak.klantNaam ?? 'Klant' } : null);
  const { bezig, fout, doe } = useOpslaan();
  const overMiddernacht = !heleDag && start && eind && eind <= start;

  async function opslaan(ev?: React.FormEvent) {
    ev?.preventDefault();
    const r = await doe(
      () =>
        agendaApi.wijzigAfspraak(
          afspraak.id,
          heleDag
            ? { titel, notitie, locatie, klantId: klant?.id ?? null, heleDag: true, datum, eindDatum: eindDatum || datum }
            : { titel, notitie, locatie, klantId: klant?.id ?? null, heleDag: false, datum, start, eind }
        ),
      'Afspraak opgeslagen'
    );
    if (r) onOpgeslagen(r.event);
  }

  async function verwijder() {
    const r = await doe(() => agendaApi.verwijderAfspraak(afspraak.id), 'Afspraak verwijderd');
    if (r) onVerwijderd();
  }

  return (
    <form
      className="ag-paneel-form"
      onSubmit={opslaan}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) void opslaan();
      }}
    >
      <Kop label="Afspraak" onSluit={onSluit} />
      <div className="ag-paneel-inhoud">
        <label className="ag-titelveld">
          <span className="sr-only">Titel</span>
          <textarea
            className="ag-veld ag-veld-titel"
            value={titel}
            rows={2}
            maxLength={300}
            autoFocus
            onChange={(ev) => setTitel(ev.target.value.replace(/\n/g, ' '))}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && !ev.metaKey && !ev.ctrlKey) ev.preventDefault();
            }}
          />
        </label>
        <p className="ag-uitleg ag-uitleg-dag">{langeDag(datum)}</p>

        <label className="ag-schakel">
          <input type="checkbox" checked={heleDag} onChange={(ev) => setHeleDag(ev.target.checked)} />
          <span>Hele dag</span>
        </label>

        {heleDag ? (
          <div className="ag-velden-2">
            <label className="ag-label">
              Van
              <input
                className="ag-veld"
                type="date"
                required
                value={datum}
                onChange={(ev) => {
                  setDatum(ev.target.value);
                  if (eindDatum < ev.target.value) setEindDatum(ev.target.value);
                }}
              />
            </label>
            <label className="ag-label">
              t/m
              <input
                className="ag-veld"
                type="date"
                min={datum}
                value={eindDatum}
                onChange={(ev) => setEindDatum(ev.target.value)}
              />
            </label>
          </div>
        ) : (
          <>
            <label className="ag-label">
              Datum
              <input className="ag-veld" type="date" required value={datum} onChange={(ev) => setDatum(ev.target.value)} />
            </label>
            <div className="ag-velden-2">
              <label className="ag-label">
                Begin
                <input className="ag-veld" type="time" step={300} required value={start} onChange={(ev) => setStart(ev.target.value)} />
              </label>
              <label className="ag-label">
                Eind
                <input className="ag-veld" type="time" step={300} required value={eind} onChange={(ev) => setEind(ev.target.value)} />
              </label>
            </div>
            {overMiddernacht && <p className="ag-uitleg">Eindigt de volgende dag ({langeDag(plusDagen(datum || s.dag, 1))}).</p>}
          </>
        )}

        <label className="ag-label">
          Locatie
          <input
            className="ag-veld"
            type="text"
            value={locatie}
            maxLength={300}
            placeholder="Adres, ‘Studio’ of een videolink"
            onChange={(ev) => setLocatie(ev.target.value)}
          />
        </label>

        <div className="ag-label">
          Klant
          <KlantKiezer waarde={klant} onChange={setKlant} />
        </div>

        <label className="ag-label">
          Notitie
          <textarea
            className="ag-veld"
            rows={5}
            value={notitie}
            maxLength={10000}
            placeholder="Agenda, voorbereiding, links…"
            onChange={(ev) => setNotitie(ev.target.value)}
          />
        </label>
        {fout && (
          <p className="ag-fout" role="alert">
            {fout}
          </p>
        )}
      </div>
      <Voet bezig={bezig} onVerwijder={verwijder} onSluit={onSluit} />
    </form>
  );
}
