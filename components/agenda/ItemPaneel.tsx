'use client';

import { useEffect, useRef, useState } from 'react';
import { agendaApi, ApiFout, useSmal } from '@/lib/agenda/client';
import { amsterdamNaarMoment, inAmsterdam, langeDag, minutenNaarTijd, plusDagen, tijdNaarMinuten, type Dag } from '@/lib/agenda/datum';
import { magAfspraakWijzigen, namenLijst } from '@/lib/agenda/rechten';
import { HERHALINGEN, isHerhaling, type Herhaling } from '@/lib/agenda/herhaling';
import { dagenVanAfspraak } from '@/lib/agenda/weergave';
import type { Afspraak, Taak } from '@/lib/agenda/types';
import { googleApi } from '@/lib/google-agenda/client';
import type { GoogleAgenda } from '@/lib/google-agenda/types';
import { perGebruiker } from '@/lib/mail/client';
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
    aangemaaktDoor: mijnId,
    herhaling: null,
    herhaalTot: null,
    reeksId: null,
    voorkomen: null
  };
}

/** Paneel rechts om een afspraak te maken, te bekijken en te bewerken. */
export function ItemPaneel({
  selectie,
  onSluit,
  onOpgeslagen,
  onVerwijderd,
  herhalingKlaar = true,
  googleAgendas = []
}: {
  selectie: Extract<Selectie, { soort: 'afspraak' }>;
  onSluit: () => void;
  onOpgeslagen: (s: Selectie) => void;
  onVerwijderd: (s: Selectie) => void;
  /** false zolang migratie 0034 (herhalen) niet is uitgevoerd: dan staat "Herhalen" uit. */
  herhalingKlaar?: boolean;
  /** Je gekoppelde Google-agenda's (0035): kiezen waar een nieuwe afspraak komt. */
  googleAgendas?: GoogleAgenda[];
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
          herhalingKlaar={herhalingKlaar}
          googleAgendas={googleAgendas}
          onSluit={onSluit}
          onOpgeslagen={(a) => onOpgeslagen({ soort: 'afspraak', item: a })}
          onVerwijderd={() => onVerwijderd(selectie)}
        />
      </aside>
    </>
  );
}

function Kop({ label, kleur, onSluit }: { label: string; kleur?: string; onSluit: () => void }) {
  return (
    <header className="ag-paneel-kop">
      <p className="db-label ag-paneel-label">
        {kleur && <span className="ag-kal-stip" style={{ '--ag-kleur': kleur } as React.CSSProperties} aria-hidden="true" />}
        {label}
      </p>
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
  magVerwijderen = mag,
  reeks,
  vraagOpslaan,
  onKiesOpslaan,
  onVerwijder,
  onSluit
}: {
  bezig: boolean;
  nieuw: boolean;
  mag: boolean;
  /** Verwijderen mag ook als wijzigen niet mag (een Google-afspraak waar je gast bent). */
  magVerwijderen?: boolean;
  /** Een voorkomen van een herhalende afspraak: dan "alleen deze" of "hele reeks". */
  reeks: boolean;
  /** Vraag bij opslaan op welke voorkomens de wijziging slaat (null = niet vragen). */
  vraagOpslaan: boolean;
  onKiesOpslaan: (toepassen: 'deze' | 'reeks' | null) => void;
  onVerwijder: (toepassen?: 'deze' | 'reeks') => void;
  onSluit: () => void;
}) {
  const [zeker, setZeker] = useState(false);
  if (!mag && !magVerwijderen) {
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
  if (vraagOpslaan) {
    return (
      <footer className="ag-paneel-voet">
        <span className="ag-zeker">
          <span>Wijziging opslaan voor</span>
          <button type="button" className="db-knop" disabled={bezig} onClick={() => onKiesOpslaan('deze')}>
            Alleen deze
          </button>
          <button type="button" className="db-knop db-knop-primair" disabled={bezig} onClick={() => onKiesOpslaan('reeks')}>
            Hele reeks
          </button>
          <button type="button" className="ag-link-knop" onClick={() => onKiesOpslaan(null)}>
            Terug
          </button>
        </span>
      </footer>
    );
  }
  return (
    <footer className="ag-paneel-voet">
      {nieuw ? (
        <span />
      ) : zeker && reeks ? (
        <span className="ag-zeker">
          <span>Verwijderen:</span>
          <button type="button" className="db-knop ag-knop-gevaar" disabled={bezig} onClick={() => onVerwijder('deze')}>
            Alleen deze
          </button>
          <button type="button" className="db-knop ag-knop-gevaar" disabled={bezig} onClick={() => onVerwijder('reeks')}>
            Hele reeks
          </button>
          <button type="button" className="db-knop" onClick={() => setZeker(false)}>
            Nee
          </button>
        </span>
      ) : zeker ? (
        <span className="ag-zeker">
          <span>Definitief verwijderen?</span>
          <button type="button" className="db-knop ag-knop-gevaar" disabled={bezig} onClick={() => onVerwijder()}>
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
            {mag ? 'Annuleren' : 'Sluiten'}
          </button>
          {mag && (
            <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
              {bezig ? 'Bezig…' : nieuw ? 'Afspraak toevoegen' : 'Opslaan'}
            </button>
          )}
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

/** Laatst gekozen agenda voor een nieuwe afspraak ('' = Studio Levant), per gebruiker. */
const BRON_SLEUTEL = 'sl-agenda-nieuw-in';

function leesBron(agendas: GoogleAgenda[]): string {
  try {
    const id = localStorage.getItem(perGebruiker(BRON_SLEUTEL)) ?? '';
    return agendas.some((a) => a.id === id && a.schrijfbaar) ? id : '';
  } catch {
    return '';
  }
}

function bewaarBron(id: string) {
  try {
    localStorage.setItem(perGebruiker(BRON_SLEUTEL), id);
  } catch {
    /* geen opslag */
  }
}

const GAST_STATUS: Record<string, string> = { accepted: 'komt', declined: 'komt niet', tentative: 'misschien', needsAction: 'nog geen antwoord' };

/** Tekst met klikbare http(s)-links (een beschrijving uit Google die je niet mag wijzigen). */
function MetLinks({ tekst }: { tekst: string }) {
  const delen = tekst.split(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g);
  return (
    <p className="ag-beschrijving">
      {delen.map((d, i) =>
        i % 2 ? (
          <a key={i} href={d} target="_blank" rel="noopener noreferrer">
            {d}
          </a>
        ) : (
          d
        )
      )}
    </p>
  );
}

function AfspraakFormulier({
  afspraak,
  nieuw,
  herhalingKlaar,
  googleAgendas,
  onSluit,
  onOpgeslagen,
  onVerwijderd
}: {
  afspraak: Afspraak;
  nieuw: boolean;
  herhalingKlaar: boolean;
  googleAgendas: GoogleAgenda[];
  onSluit: () => void;
  onOpgeslagen: (a: Afspraak) => void;
  onVerwijderd: () => void;
}) {
  const g = afspraak.google;
  const schrijfbareAgendas = googleAgendas.filter((a) => a.schrijfbaar);
  // Waar de afspraak staat: '' = Studio Levant (dashboard), anders het id van de Google-agenda.
  const [bron, setBron] = useState(() => g?.agendaId ?? (nieuw ? leesBron(schrijfbareAgendas) : ''));
  const inGoogle = bron !== '';
  const bronAgenda = googleAgendas.find((a) => a.id === bron);
  const [meet, setMeet] = useState(false);
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
  const [herhaling, setHerhaling] = useState<Herhaling | ''>(afspraak.herhaling ?? '');
  const [herhaalTot, setHerhaalTot] = useState(afspraak.herhaalTot ?? '');
  // Een voorkomen van een reeks: bij opslaan en verwijderen vragen "alleen deze of de hele reeks".
  const reeks = !nieuw && !!afspraak.reeksId;
  const [vraagOpslaan, setVraagOpslaan] = useState(false);
  const { mijnId, overgang, perId } = useTeam();
  const [deelnemers, setDeelnemers] = useState<string[]>(afspraak.deelnemers.length ? afspraak.deelnemers : [mijnId]);
  const mag = nieuw || (g ? g.schrijfbaar : magAfspraakWijzigen(afspraak, mijnId, overgang));
  const magVerwijderen = g ? g.verwijderbaar : mag;
  // De herhaling van een reeks uit Google pas je in Google zelf aan.
  const herhaaltInGoogle = !!g?.herhaalt;
  const { bezig, fout, doe } = useOpslaan();
  // Telefoon: een bestaande afspraak openen zonder dat het toetsenbord meteen opent.
  const smal = useSmal();
  const overMiddernacht = !heleDag && start && eind && eind <= start;

  // Herhaalregel gewijzigd: dat gaat altijd over de hele reeks (niet vragen).
  const regelGewijzigd = herhaling !== (afspraak.herhaling ?? '') || (herhaling !== '' && herhaalTot !== (afspraak.herhaalTot ?? ''));

  async function opslaan(ev?: React.FormEvent, toepassen?: 'deze' | 'reeks') {
    ev?.preventDefault();
    if (!mag) return;
    if (reeks && !toepassen && !regelGewijzigd) {
      setVraagOpslaan(true);
      return;
    }
    setVraagOpslaan(false);
    const basis = heleDag
      ? { titel, notitie, locatie, klantId: klant?.id ?? null, heleDag: true, datum, eindDatum: eindDatum || datum }
      : { titel, notitie, locatie, klantId: klant?.id ?? null, heleDag: false, datum, start, eind };
    // Herhalen alleen meesturen als de database het kent (migratie 0034) of als er iets gekozen is.
    const b =
      herhalingKlaar || herhaling
        ? { ...basis, herhaling: herhaling || null, herhaalTot: herhaling ? herhaalTot || null : null, toepassen }
        : { ...basis, toepassen };
    if (inGoogle) {
      // Naar Google: geen klant of deelnemers (die kent Google niet); de herhaling van een
      // bestaande reeks blijft zoals hij in Google staat.
      const tijd = heleDag ? { heleDag: true, datum, eindDatum: eindDatum || datum } : { heleDag: false, datum, start, eind };
      const gb = {
        titel,
        notitie,
        locatie,
        ...tijd,
        toepassen,
        ...(herhaaltInGoogle ? {} : { herhaling: herhaling || null, herhaalTot: herhaling ? herhaalTot || null : null })
      };
      const naam = bronAgenda?.naam ?? 'Google Agenda';
      const r = await doe(
        () => (nieuw ? googleApi.maak(bron, { ...gb, meet }) : googleApi.wijzig(afspraak.id, { ...gb, meet })),
        nieuw ? `Afspraak toegevoegd aan ${naam}` : toepassen === 'deze' ? 'Alleen deze afspraak opgeslagen' : reeks ? 'Reeks opgeslagen' : 'Opgeslagen in Google'
      );
      if (r) {
        if (nieuw) bewaarBron(bron);
        onOpgeslagen(r.event);
      }
      return;
    }
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
          : toepassen === 'deze'
            ? 'Alleen deze afspraak opgeslagen'
            : reeks || herhaling
              ? 'Reeks opgeslagen'
              : 'Afspraak opgeslagen'
    );
    if (r) {
      if (nieuw) bewaarBron('');
      onOpgeslagen(r.event);
    }
  }

  async function verwijder(toepassen?: 'deze' | 'reeks') {
    const r = await doe(
      () => (g ? googleApi.verwijder(afspraak.id, toepassen) : agendaApi.verwijderAfspraak(afspraak.id, toepassen)),
      toepassen === 'deze' ? 'Deze afspraak verwijderd (de reeks blijft)' : toepassen === 'reeks' ? 'Reeks verwijderd' : 'Afspraak verwijderd'
    );
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
      <Kop
        label={g ? g.agendaNaam : nieuw ? 'Nieuwe afspraak' : 'Afspraak'}
        kleur={g?.kleur ?? (nieuw && bronAgenda ? bronAgenda.kleur : undefined)}
        onSluit={onSluit}
      />
      <div className="ag-paneel-inhoud">
        {!mag && g && (
          <p className="tk-melding" role="note">
            {g.organisator
              ? `${g.organisator} organiseert deze afspraak; alleen die kan hem wijzigen.`
              : 'Deze Google-agenda kun je alleen bekijken.'}
            {magVerwijderen ? ' Verwijderen uit je agenda kan wel.' : ''}
          </p>
        )}
        {!mag && !g && (
          <p className="tk-melding" role="note">
            Alleen {afspraak.aangemaaktDoor ? <Persoon id={afspraak.aangemaaktDoor} /> : 'de maker'} en de deelnemers kunnen deze
            afspraak wijzigen.
          </p>
        )}
        {nieuw && schrijfbareAgendas.length > 0 && (
          <label className="ag-label ag-bron">
            Agenda
            <select
              className="ag-veld"
              value={bron}
              onChange={(ev) => {
                setBron(ev.target.value);
                if (!ev.target.value) setMeet(false);
              }}
            >
              <option value="">Studio Levant (dashboard)</option>
              {schrijfbareAgendas.map((a) => (
                <option key={a.id} value={a.id}>
                  Google · {a.naam}
                </option>
              ))}
            </select>
          </label>
        )}
        {g?.meetLink && (
          <div className="ag-meet">
            <a className="db-knop db-knop-primair ag-meet-knop" href={g.meetLink} target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <rect x="3" y="6.5" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="m15 10.5 5-3v9l-5-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
              Deelnemen{g.vergaderDienst ? ` met ${g.vergaderDienst}` : ''}
            </a>
            <span className="ag-meet-link">{g.meetLink.replace(/^https?:\/\//, '')}</span>
          </div>
        )}
        <fieldset className="tk-velden" disabled={!mag}>
        <label className="ag-titelveld">
          <span className="sr-only">Titel</span>
          <textarea
            className="ag-veld ag-veld-titel"
            value={titel}
            rows={2}
            maxLength={300}
            autoFocus={nieuw || !smal}
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

        {!overgang && !inGoogle && (
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

        {herhaaltInGoogle ? (
          <p className="ag-uitleg">Herhalende afspraak uit Google. De herhaling zelf pas je aan in Google Agenda; bij opslaan en verwijderen kies je: alleen deze of de hele reeks.</p>
        ) : (
        <>
        <div className="ag-velden-2">
          <label className="ag-label">
            Herhalen
            <select
              className="ag-veld"
              value={herhaling}
              disabled={!herhalingKlaar && !herhaling}
              onChange={(ev) => setHerhaling(isHerhaling(ev.target.value) ? ev.target.value : '')}
            >
              <option value="">Niet</option>
              {HERHALINGEN.map((h) => (
                <option key={h.waarde} value={h.waarde}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
          {herhaling && (
            <label className="ag-label">
              Tot en met
              <input
                className="ag-veld"
                type="date"
                min={datum}
                value={herhaalTot}
                aria-describedby="ag-herhaal-uitleg"
                onChange={(ev) => setHerhaalTot(ev.target.value)}
              />
            </label>
          )}
        </div>
        {!herhalingKlaar ? (
          <p className="ag-uitleg">Herhalen kan zodra migratie 0034 is uitgevoerd (supabase/UITVOEREN_0034.sql).</p>
        ) : herhaling ? (
          <p className="ag-uitleg" id="ag-herhaal-uitleg">
            {herhaalTot ? `Laatste keer op ${langeDag(herhaalTot)}.` : 'Zonder einddatum: herhaalt tot je de reeks stopt.'}
            {herhaling === 'maandelijks' && Number(datum.slice(8)) > 28 ? ' In kortere maanden op de laatste dag.' : ''}
            {reeks && !regelGewijzigd ? ' Bij opslaan kies je: alleen deze of de hele reeks.' : ''}
          </p>
        ) : null}
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

        {inGoogle && !g?.meetLink && mag && (
          <label className="ag-schakel">
            <input type="checkbox" checked={meet} onChange={(ev) => setMeet(ev.target.checked)} />
            <span>Google Meet-link toevoegen</span>
          </label>
        )}

        {!inGoogle && (
          <div className="ag-label">
            Klant
            <KlantKiezer waarde={klant} onChange={setKlant} />
          </div>
        )}

        {!mag && g ? (
          notitie.trim() ? (
            <div className="ag-label">
              Beschrijving
              <MetLinks tekst={notitie} />
            </div>
          ) : null
        ) : (
        <label className="ag-label">
          {inGoogle ? 'Beschrijving' : 'Notitie'}
          <textarea
            className="ag-veld"
            rows={5}
            value={notitie}
            maxLength={10000}
            placeholder="Agenda, voorbereiding, links…"
            onChange={(ev) => setNotitie(ev.target.value)}
          />
        </label>
        )}
        </fieldset>
        {g && g.gasten.length > 0 && (
          <div className="ag-label">
            Gasten ({g.gasten.length})
            <ul className="ag-gasten">
              {g.gasten.map((gast) => (
                <li key={gast.email} className={`ag-gast is-${gast.status}`}>
                  <span className="ag-gast-naam" title={gast.email}>
                    {gast.naam || gast.email}
                    {gast.ik ? ' (jij)' : ''}
                  </span>
                  <span className="ag-gast-status">{GAST_STATUS[gast.status]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {g && (
          <p className="tk-meta">
            {g.organisator ? <>Georganiseerd door {g.organisator} · </> : null}
            {g.link ? (
              <a href={g.link} target="_blank" rel="noopener noreferrer">
                Openen in Google Agenda
              </a>
            ) : (
              'Uit Google Agenda'
            )}
          </p>
        )}
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
      <Voet
        bezig={bezig}
        nieuw={nieuw}
        mag={mag}
        magVerwijderen={magVerwijderen}
        reeks={reeks}
        vraagOpslaan={vraagOpslaan}
        onKiesOpslaan={(t) => (t ? void opslaan(undefined, t) : setVraagOpslaan(false))}
        onVerwijder={(t) => void verwijder(t)}
        onSluit={onSluit}
      />
    </form>
  );
}
