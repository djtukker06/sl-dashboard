'use client';

import { useEffect, useRef, useState } from 'react';
import { agendaApi, ApiFout } from '@/lib/agenda/client';
import { amsterdamNaarMoment, inAmsterdam, langeDag, minutenNaarTijd, plusDagen, tijdNaarMinuten, type Dag } from '@/lib/agenda/datum';
import { magAfspraakWijzigen, namenLijst } from '@/lib/agenda/rechten';
import { dagenVanAfspraak } from '@/lib/agenda/weergave';
import type { Afspraak, Taak } from '@/lib/agenda/types';
import { Persoon } from '@/components/team/Persoon';
import { useTeam } from '@/components/team/TeamProvider';
import { VoorWieKiezer } from '@/components/taken/VoorWieKiezer';
import { KlantKiezer } from './KlantKiezer';
import { useToast } from './Toast';

// Taken openen in de taak-popup (components/taken/TaakDialoog); dit paneel is voor afspraken.
export type Selectie = { soort: 'taak'; item: Taak } | { soort: 'afspraak'; item: Afspraak; nieuw?: boolean };

/** Een nog niet opgeslagen afspraak (1 uur, vanaf `start`) als startpunt voor het paneel. */
export function nieuweAfspraak(dag: Dag, start: string, mijnId: string): Afspraak {
  const eindMin = Math.min(tijdNaarMinuten(start) + 60, 23 * 60 + 55);
  return {
    id: '',
    titel: '',
    notitie: '',
    locatie: '',
    start: amsterdamNaarMoment(dag, start).toISOString(),
    eind: amsterdamNaarMoment(dag, minutenNaarTijd(eindMin)).toISOString(),
    heleDag: false,
    klantId: null,
    klantNaam: null,
    deelnemers: [mijnId],
    aangemaaktDoor: mijnId
  };
}

/** Paneel rechts om een afspraak te maken, te bekijken en te bewerken. */
export function ItemPaneel({
  selectie,
  onSluit,
  onOpgeslagen,
  onVerwijderd
}: {
  selectie: Extract<Selectie, { soort: 'afspraak' }>;
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
        aria-modal="true"
        aria-label={selectie.nieuw ? 'Nieuwe afspraak' : 'Afspraak'}
      >
        <AfspraakFormulier
          key={selectie.item.id || 'nieuw'}
          afspraak={selectie.item}
          nieuw={!!selectie.nieuw}
          onSluit={onSluit}
          onOpgeslagen={(a) => onOpgeslagen({ soort: 'afspraak', item: a })}
          onVerwijderd={() => onVerwijderd(selectie)}
        />
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
  nieuw,
  mag,
  onVerwijder,
  onSluit
}: {
  bezig: boolean;
  nieuw: boolean;
  mag: boolean;
  onVerwijder: () => void;
  onSluit: () => void;
}) {
  const [zeker, setZeker] = useState(false);
  if (!mag) {
    return (
      <footer className="ag-paneel-voet">
        <span />
        <span className="ag-paneel-acties">
          <button type="button" className="db-knop" onClick={onSluit}>
            Sluiten
          </button>
        </span>
      </footer>
    );
  }
  return (
    <footer className="ag-paneel-voet">
      {nieuw ? (
        <span />
      ) : zeker ? (
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
            {bezig ? 'Bezig…' : nieuw ? 'Afspraak toevoegen' : 'Opslaan'}
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

function AfspraakFormulier({
  afspraak,
  nieuw,
  onSluit,
  onOpgeslagen,
  onVerwijderd
}: {
  afspraak: Afspraak;
  nieuw: boolean;
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
  const { mijnId, overgang, perId } = useTeam();
  const [deelnemers, setDeelnemers] = useState<string[]>(afspraak.deelnemers.length ? afspraak.deelnemers : [mijnId]);
  const mag = nieuw || magAfspraakWijzigen(afspraak, mijnId, overgang);
  const { bezig, fout, doe } = useOpslaan();
  const overMiddernacht = !heleDag && start && eind && eind <= start;

  async function opslaan(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (!mag) return;
    const b = heleDag
      ? { titel, notitie, locatie, klantId: klant?.id ?? null, heleDag: true, datum, eindDatum: eindDatum || datum }
      : { titel, notitie, locatie, klantId: klant?.id ?? null, heleDag: false, datum, start, eind };
    const metWie = overgang ? b : { ...b, deelnemers };
    // Een afspraak zonder jou erop staat alleen in de agenda van de anderen: zeg dat erbij.
    const voorAnder = !overgang && !deelnemers.includes(mijnId);
    const namen = namenLijst(deelnemers.map((id) => perId.get(id)?.voornaam || perId.get(id)?.naam || 'iemand'));
    const r = await doe(
      () => (nieuw ? agendaApi.maakAfspraak(metWie) : agendaApi.wijzigAfspraak(afspraak.id, metWie)),
      nieuw
        ? voorAnder
          ? `Afspraak toegevoegd voor ${namen} (staat in hun agenda)`
          : 'Afspraak toegevoegd'
        : voorAnder
          ? `Afspraak opgeslagen voor ${namen} (staat niet meer in jouw agenda)`
          : 'Afspraak opgeslagen'
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
      <Kop label={nieuw ? 'Nieuwe afspraak' : 'Afspraak'} onSluit={onSluit} />
      <div className="ag-paneel-inhoud">
        {!mag && (
          <p className="tk-melding" role="note">
            Alleen {afspraak.aangemaaktDoor ? <Persoon id={afspraak.aangemaaktDoor} /> : 'de maker'} en de deelnemers kunnen deze
            afspraak wijzigen.
          </p>
        )}
        <fieldset className="tk-velden" disabled={!mag}>
        <label className="ag-titelveld">
          <span className="sr-only">Titel</span>
          <textarea
            className="ag-veld ag-veld-titel"
            value={titel}
            rows={2}
            maxLength={300}
            autoFocus
            placeholder="Titel van de afspraak"
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

        {!overgang && (
          <div className="ag-label">
            <span>Wie</span>
            <VoorWieKiezer waarde={deelnemers} onChange={setDeelnemers} uitgeschakeld={!mag} label="Wie" />
            {mag && !deelnemers.includes(mijnId) && (
              <p className="ag-uitleg">Je ziet deze afspraak dan zelf niet meer in je agenda.</p>
            )}
          </div>
        )}

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
        </fieldset>
        {!nieuw && afspraak.aangemaaktDoor && (
          <p className="tk-meta">
            Ingepland door <Persoon id={afspraak.aangemaaktDoor} />
          </p>
        )}
        {fout && (
          <p className="ag-fout" role="alert">
            {fout}
          </p>
        )}
      </div>
      <Voet bezig={bezig} nieuw={nieuw} mag={mag} onVerwijder={verwijder} onSluit={onSluit} />
    </form>
  );
}
