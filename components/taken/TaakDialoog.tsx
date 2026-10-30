'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { agendaApi, ApiFout, useSmal, vindKlant } from '@/lib/agenda/client';
import { dagTekst, maandagVan, plusDagen, vandaag as vandaagNL, weekdagIndex } from '@/lib/agenda/datum';
import { magTaakWijzigen, namenLijst } from '@/lib/agenda/rechten';
import { parseSnelinvoer } from '@/lib/agenda/snelinvoer';
import type { Prioriteit, Subtaak, Taak, TaakDetail, TaakInvoer } from '@/lib/agenda/types';
import { KlantKiezer } from '@/components/agenda/KlantKiezer';
import { useToast } from '@/components/agenda/Toast';
import { Persoon } from '@/components/team/Persoon';
import { useTeam } from '@/components/team/TeamProvider';
import { ProjectKiezer, type ProjectKeuze } from './ProjectKiezer';
import { SubtakenLijst, type SubtaakRegel } from './SubtakenLijst';
import type { TaakGebeurtenis } from './TakenProvider';
import { VoorWieKiezer } from './VoorWieKiezer';

/** Voorinvulling voor een nieuwe taak (vanuit de agenda, een project of een klant). */
export interface TaakStandaard {
  datum?: string | null;
  tijd?: string | null;
  voorWie?: string[];
  klant?: { id: string; naam: string } | null;
  project?: ProjectKeuze | null;
}

const DUREN: [string, string][] = [
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

const URGENTIE: [Prioriteit, string][] = [
  [3, 'Laag'],
  [2, 'Normaal'],
  [1, 'Hoog']
];

const FOCUSBAAR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * De taak-popup: nieuwe taak (voor één of meer teamleden, met deadline, urgentie, klant,
 * project en subtaken) of een bestaande taak bekijken/bewerken. Toegankelijk: role=dialog,
 * focus blijft binnen het venster en gaat bij sluiten terug naar waar je was. Op mobiel
 * een scherm-vullend blad.
 */
export function TaakDialoog({
  modus,
  taakId,
  standaard,
  onSluit,
  onGebeurtenis,
  onOpen
}: {
  modus: 'nieuw' | 'bewerk';
  taakId: string | null;
  standaard?: TaakStandaard;
  onSluit: () => void;
  onGebeurtenis: (e: TaakGebeurtenis) => void;
  onOpen: (id: string) => void;
}) {
  const doos = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<{ taak: TaakDetail } | { fout: string } | null>(null);
  const [poging, setPoging] = useState(0);

  // Bestaande taak laden.
  useEffect(() => {
    if (modus !== 'bewerk' || !taakId) return;
    let weg = false;
    agendaApi
      .taak(taakId)
      .then((r) => !weg && setDetail({ taak: r.task }))
      .catch((e) => !weg && setDetail({ fout: e instanceof ApiFout && e.status === 404 ? 'Deze taak bestaat niet (meer).' : e instanceof Error ? e.message : 'Laden mislukt.' }));
    return () => {
      weg = true;
    };
  }, [modus, taakId, poging]);

  // Focus terug naar waar je was; achtergrond niet laten scrollen.
  useEffect(() => {
    const vorige = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Zonder autofocus (bestaande taak op de telefoon) toch de focus in het venster.
    const raf = requestAnimationFrame(() => {
      if (doos.current && !doos.current.contains(document.activeElement)) doos.current.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = overflow;
      if (vorige && document.contains(vorige)) vorige.focus({ preventScroll: true });
    };
  }, []);

  function toets(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      onSluit();
      return;
    }
    if (e.key !== 'Tab' || !doos.current) return;
    // Focus binnen het venster houden.
    const els = [...doos.current.querySelectorAll<HTMLElement>(FOCUSBAAR)].filter((el) => el.offsetParent !== null);
    if (!els.length) return;
    const eerste = els[0];
    const laatste = els[els.length - 1];
    if (e.shiftKey && document.activeElement === eerste) {
      e.preventDefault();
      laatste.focus();
    } else if (!e.shiftKey && document.activeElement === laatste) {
      e.preventDefault();
      eerste.focus();
    }
  }

  const geladen = modus === 'nieuw' || (detail && 'taak' in detail);
  return (
    <div className="tk-laag" onKeyDown={toets}>
      <div className="tk-achter" aria-hidden="true" onClick={geladen ? undefined : onSluit} />
      <div
        ref={doos}
        className="tk-dialoog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tk-dialoog-titel"
      >
        {modus === 'nieuw' ? (
          <TaakFormulier standaard={standaard} onSluit={onSluit} onGebeurtenis={onGebeurtenis} onOpen={onOpen} />
        ) : detail && 'taak' in detail ? (
          <TaakFormulier taak={detail.taak} onSluit={onSluit} onGebeurtenis={onGebeurtenis} onOpen={onOpen} />
        ) : (
          <>
            <Kop titel="Taak" onSluit={onSluit} />
            <div className="tk-inhoud">
              {detail && 'fout' in detail ? (
                <div className="db-melding db-melding-fout" role="alert">
                  <p className="db-melding-titel">Taak niet geladen</p>
                  <p className="db-melding-tekst">{detail.fout}</p>
                  <div className="db-melding-actie">
                    <button
                      type="button"
                      className="db-knop"
                      onClick={() => {
                        setDetail(null);
                        setPoging((p) => p + 1);
                      }}
                    >
                      Opnieuw
                    </button>
                  </div>
                </div>
              ) : (
                <div className="tk-skelet" aria-busy="true" aria-label="Taak laden">
                  <div className="db-skelet" style={{ width: '70%', height: 22 }} />
                  <div className="db-skelet" style={{ width: '40%' }} />
                  <div className="db-skelet" style={{ width: '55%' }} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Kop({ titel, onSluit, children }: { titel: string; onSluit: () => void; children?: React.ReactNode }) {
  return (
    <header className="tk-kop">
      <h2 className="tk-kop-titel" id="tk-dialoog-titel">
        {titel}
      </h2>
      <span className="tk-kop-acties">
        {children}
        <button type="button" className="ag-icoonknop" aria-label="Sluiten (Esc)" title="Sluiten (Esc)" onClick={onSluit}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    </header>
  );
}

function datumKort(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' });
}

function startKlant(taak: TaakDetail | undefined, standaard: TaakStandaard | undefined): { id: string; naam: string } | null {
  if (taak) return taak.klantId ? { id: taak.klantId, naam: taak.klantNaam ?? 'Klant' } : null;
  if (standaard?.klant) return standaard.klant;
  const p = standaard?.project;
  return p?.klantId ? { id: p.klantId, naam: p.klantNaam ?? 'Klant' } : null;
}

interface Stand {
  titel: string;
  notitie: string;
  voorWie: string[];
  datum: string;
  tijd: string;
  duur: string;
  prio: Prioriteit;
  klant: string | null;
  project: string | null;
  subs: string[];
}

/** Vergelijkbare momentopname van het formulier (voor "Wijzigingen weggooien?"). */
function momentopname(v: Stand): string {
  return JSON.stringify({
    ...v,
    titel: v.titel.trim(),
    voorWie: [...v.voorWie].sort(),
    tijd: v.datum ? v.tijd : '',
    duur: v.datum && v.tijd ? v.duur : ''
  });
}

let regelTeller = 0;
const nieuweSleutel = () => `n${++regelTeller}`;

function regelsUit(subs: Subtaak[]): (SubtaakRegel & { id: string; volgorde: number })[] {
  return subs.map((s) => ({ sleutel: s.id, id: s.id, titel: s.titel, klaar: s.klaar, klaarDoor: s.klaarDoor, volgorde: s.volgorde }));
}

function TaakFormulier({
  taak: start,
  standaard,
  onSluit,
  onGebeurtenis,
  onOpen
}: {
  taak?: TaakDetail;
  standaard?: TaakStandaard;
  onSluit: () => void;
  onGebeurtenis: (e: TaakGebeurtenis) => void;
  onOpen: (id: string) => void;
}) {
  const toast = useToast();
  const { mijnId, overgang, perId } = useTeam();
  const nieuw = !start;
  // Op de telefoon een bestaande taak openen zonder meteen het toetsenbord over de helft van
  // het scherm; een nieuwe taak begint wel direct in het titelveld.
  const smal = useSmal();
  const vandaag = useMemo(() => vandaagNL(), []);
  const titelRef = useRef<HTMLInputElement>(null);

  const [taak, setTaak] = useState<TaakDetail | undefined>(start);
  const mag = !taak || magTaakWijzigen(taak, mijnId, overgang);

  // ---------- velden ----------
  const [titel, setTitel] = useState(start?.titel ?? '');
  const [notitie, setNotitie] = useState(start?.notitie ?? '');
  const [toonNotitie, setToonNotitie] = useState(!!start?.notitie);
  const [voorWie, setVoorWie] = useState<string[]>(() =>
    start ? (start.toegewezen.length ? start.toegewezen : []) : standaard?.voorWie?.length ? standaard.voorWie : [mijnId]
  );
  const [datum, setDatum] = useState(start?.datum ?? standaard?.datum ?? '');
  const [tijd, setTijd] = useState(start?.tijd ?? standaard?.tijd ?? '');
  const [duur, setDuur] = useState(start?.duur ? String(start.duur) : '30');
  const [prio, setPrio] = useState<Prioriteit>(start?.prioriteit ?? 2);
  const [klant, setKlant] = useState<{ id: string; naam: string } | null>(() => startKlant(start, standaard));
  const [project, setProject] = useState<ProjectKeuze | null>(
    start?.projectId
      ? { id: start.projectId, naam: start.projectNaam ?? 'Project', klantId: start.klantId, klantNaam: start.klantNaam }
      : (standaard?.project ?? null)
  );
  // Nieuwe taak: subtaken lokaal; bestaande: direct opgeslagen.
  const [regels, setRegels] = useState<(SubtaakRegel & { id?: string; volgorde?: number })[]>(() =>
    start ? regelsUit(start.subtakenLijst) : []
  );
  const [subBezig, setSubBezig] = useState(false);

  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const [weggooien, setWeggooien] = useState(false);
  const [verwijderen, setVerwijderen] = useState(false);

  const stand: Stand = {
    titel,
    notitie,
    voorWie,
    datum,
    tijd,
    duur,
    prio,
    klant: klant?.id ?? null,
    project: project?.id ?? null,
    subs: nieuw ? regels.map((r) => r.titel) : []
  };
  const [schoon, setSchoon] = useState<string>(() => momentopname(stand));
  const gewijzigd = momentopname(stand) !== schoon;

  // ---------- slimme titel: herkende datum/tijd/urgentie/klant ----------
  const herkend = useMemo(() => {
    if (!nieuw || !titel.trim()) return null;
    const r = parseSnelinvoer(titel, vandaag);
    const tokens = r.tokens.filter((t) => t.soort !== 'soort');
    return tokens.length && r.titel.trim() ? { ...r, tokens } : null;
  }, [nieuw, titel, vandaag]);

  async function pasHerkendToe() {
    if (!herkend) return;
    setTitel(herkend.titel);
    if (herkend.datum) setDatum(herkend.datum);
    if (herkend.tijd) setTijd(herkend.tijd);
    if (herkend.duur) setDuur(String(Math.min(1440, Math.max(5, herkend.duur))));
    if (herkend.prioriteit) setPrio(herkend.prioriteit);
    titelRef.current?.focus();
    if (herkend.klant && !klant) {
      const k = await vindKlant(herkend.klant);
      if (k) setKlant({ id: k.id, naam: k.company_name });
      else toast(`Geen klant gevonden voor ‘${herkend.klant}’.`, { fout: true });
    }
  }

  // ---------- deadline-snelknoppen ----------
  const snel: [string, string | ''][] = [
    ['Vandaag', vandaag],
    ['Morgen', plusDagen(vandaag, 1)],
    ['Vrijdag', plusDagen(vandaag, (4 - weekdagIndex(vandaag) + 7) % 7)],
    ['Volgende week', plusDagen(maandagVan(vandaag), 7)],
    ['Geen', '']
  ];
  const verleden = !!datum && datum < vandaag && !taak?.afgerond;

  // ---------- klant ↔ project consistent ----------
  function kiesKlant(k: { id: string; naam: string } | null) {
    setKlant(k);
    // Een andere klant: een project van de vorige klant past niet meer.
    if (k && project?.klantId && project.klantId !== k.id) setProject(null);
  }
  function kiesProject(p: ProjectKeuze | null) {
    setProject(p);
    if (p?.klantId && !klant) setKlant({ id: p.klantId, naam: p.klantNaam ?? 'Klant' });
  }

  // ---------- opslaan ----------
  function controleer(): string | null {
    if (!titel.trim()) return 'Geef een omschrijving op.';
    if (titel.trim().length > 300) return 'De omschrijving is te lang (maximaal 300 tekens).';
    if (!overgang && !voorWie.length) return 'Kies minstens één persoon.';
    if (tijd && !datum) return 'Een tijd heeft een datum nodig.';
    if (project?.klantId && klant && project.klantId !== klant.id) return 'Het project hoort bij een andere klant.';
    return null;
  }

  function invoer(): TaakInvoer {
    const b: TaakInvoer = {
      titel: titel.trim(),
      notitie,
      datum: datum || null,
      tijd: datum && tijd ? tijd : null,
      duur: datum && tijd ? Number(duur) : null,
      prioriteit: prio,
      klantId: klant?.id ?? null
    };
    if (!overgang) {
      b.voorWie = voorWie;
      b.projectId = project?.id ?? null;
    }
    return b;
  }

  function namenVan(ids: string[]): string {
    return namenLijst(ids.map((id) => (id === mijnId ? 'jou' : perId.get(id)?.voornaam || perId.get(id)?.naam || 'iemand')));
  }

  async function opslaan(nogEen = false) {
    if (bezig || !mag) return;
    const f = controleer();
    if (f) {
      setFout(f);
      if (!titel.trim()) titelRef.current?.focus();
      return;
    }
    setBezig(true);
    setFout('');
    try {
      if (nieuw) {
        const b = invoer();
        if (!overgang) b.subtaken = regels.map((r) => r.titel);
        const { task } = await agendaApi.maakTaak(b);
        onGebeurtenis({ soort: 'aangemaakt', taak: task });
        const wie = overgang ? '' : ` voor ${namenVan(task.toegewezen.length ? task.toegewezen : voorWie)}`;
        toast(`Taak toegevoegd${wie}`, { actie: { label: 'Openen', onClick: () => onOpen(task.id) } });
        if (nogEen) {
          // Voor wie, klant en project blijven staan.
          setTitel('');
          setNotitie('');
          setToonNotitie(false);
          setDatum(standaard?.datum ?? '');
          setTijd(standaard?.tijd ?? '');
          setDuur('30');
          setPrio(2);
          setRegels([]);
          setSchoon(
            momentopname({
              ...stand,
              titel: '',
              notitie: '',
              datum: standaard?.datum ?? '',
              tijd: standaard?.tijd ?? '',
              duur: '30',
              prio: 2,
              subs: []
            })
          );
          titelRef.current?.focus();
        } else onSluit();
      } else if (taak) {
        const { task } = await agendaApi.bewaarTaak(taak.id, invoer());
        if (task) {
          onGebeurtenis({ soort: 'gewijzigd', taak: task });
          toast('Taak opgeslagen');
        } else {
          // Aan een ander gegeven: staat niet meer in jouw lijsten (wel onder "Uitgezet" als jij de maker bent).
          onGebeurtenis({ soort: 'verwijderd', id: taak.id });
          toast('Taak overgedragen');
        }
        onSluit();
      }
    } catch (e) {
      setFout(
        e instanceof ApiFout && e.nietIngericht
          ? 'De agenda is nog niet (helemaal) ingericht. Voer migratie 0021 uit.'
          : e instanceof Error
            ? e.message
            : 'Opslaan mislukt.'
      );
    } finally {
      setBezig(false);
    }
  }

  async function wisselAfgerond() {
    if (!taak || bezig || !mag) return;
    setBezig(true);
    setFout('');
    try {
      const { task } = await agendaApi.wijzigTaak(taak.id, { afgerond: !taak.afgerond });
      setTaak({ ...taak, ...task, subtakenLijst: taak.subtakenLijst });
      onGebeurtenis({ soort: 'gewijzigd', taak: task });
      toast(task.afgerond ? 'Taak afgerond' : 'Taak weer open');
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Niet gelukt.');
    } finally {
      setBezig(false);
    }
  }

  async function verwijder() {
    if (!taak || bezig) return;
    setBezig(true);
    try {
      await agendaApi.verwijderTaak(taak.id);
      onGebeurtenis({ soort: 'verwijderd', id: taak.id });
      toast('Taak verwijderd');
      onSluit();
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Verwijderen mislukt.');
      setVerwijderen(false);
    } finally {
      setBezig(false);
    }
  }

  // ---------- subtaken ----------
  function meldSubtaken(nieuweRegels: typeof regels) {
    if (!taak) return;
    const t: Taak = { ...taak, subtaken: { totaal: nieuweRegels.length, klaar: nieuweRegels.filter((r) => r.klaar).length } };
    onGebeurtenis({ soort: 'gewijzigd', taak: t });
  }

  async function subToevoegen(t: string): Promise<boolean> {
    if (nieuw) {
      setRegels((r) => [...r, { sleutel: nieuweSleutel(), titel: t, klaar: false }]);
      return true;
    }
    if (!taak) return false;
    setSubBezig(true);
    try {
      const { subtaak } = await agendaApi.maakSubtaak(taak.id, t);
      const volgende = [...regels, ...regelsUit([subtaak])];
      setRegels(volgende);
      meldSubtaken(volgende);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Subtaak toevoegen mislukt.', { fout: true });
      return false;
    } finally {
      setSubBezig(false);
    }
  }

  async function subWeg(i: number) {
    const r = regels[i];
    const volgende = regels.filter((_, j) => j !== i);
    if (nieuw || !taak || !r.id) {
      setRegels(volgende);
      return;
    }
    setSubBezig(true);
    try {
      await agendaApi.verwijderSubtaak(taak.id, r.id);
      setRegels(volgende);
      meldSubtaken(volgende);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Weghalen mislukt.', { fout: true });
    } finally {
      setSubBezig(false);
    }
  }

  async function subVerplaats(i: number, richting: -1 | 1) {
    const j = i + richting;
    if (j < 0 || j >= regels.length) return;
    const volgende = [...regels];
    [volgende[i], volgende[j]] = [volgende[j], volgende[i]];
    setRegels(volgende);
    if (nieuw || !taak) return;
    // Volgorde opnieuw nummeren (alleen wat verandert).
    setSubBezig(true);
    try {
      const wijzig = volgende.map((r, k) => ({ r, k: k + 1 })).filter(({ r, k }) => r.id && r.volgorde !== k);
      await Promise.all(wijzig.map(({ r, k }) => agendaApi.wijzigSubtaak(taak.id, r.id!, { volgorde: k })));
      setRegels(volgende.map((r, k) => ({ ...r, volgorde: k + 1 })));
    } catch (e) {
      setRegels(regels);
      toast(e instanceof Error ? e.message : 'Verplaatsen mislukt.', { fout: true });
    } finally {
      setSubBezig(false);
    }
  }

  async function subVink(i: number) {
    const r = regels[i];
    if (!taak || !r.id) return;
    const klaar = !r.klaar;
    const volgende = regels.map((x, j) => (j === i ? { ...x, klaar, klaarDoor: klaar ? mijnId : null } : x));
    setRegels(volgende);
    try {
      const { subtaak } = await agendaApi.wijzigSubtaak(taak.id, r.id, { klaar });
      const bevestigd = volgende.map((x, j) => (j === i ? { ...x, klaar: subtaak.klaar, klaarDoor: subtaak.klaarDoor } : x));
      setRegels(bevestigd);
      meldSubtaken(bevestigd);
    } catch (e) {
      setRegels(regels);
      toast(e instanceof Error ? e.message : 'Afvinken mislukt.', { fout: true });
    }
  }

  // ---------- toetsenbord ----------
  function toets(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (weggooien || verwijderen) {
        setWeggooien(false);
        setVerwijderen(false);
        if (weggooien) onSluit();
      } else if (gewijzigd && mag) setWeggooien(true);
      else onSluit();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void opslaan(e.shiftKey && nieuw);
      return;
    }
    if (e.altKey && ['Digit1', 'Digit2', 'Digit3'].includes(e.code) && mag) {
      e.preventDefault();
      setPrio(URGENTIE[Number(e.code.slice(-1)) - 1][0]);
    }
  }

  const label = nieuw ? 'Nieuwe taak' : taak?.afgerond ? 'Taak · afgerond' : 'Taak';

  return (
    <form
      className="tk-form"
      noValidate
      onKeyDown={toets}
      onSubmit={(e) => {
        e.preventDefault();
        void opslaan();
      }}
    >
      <Kop titel={label} onSluit={() => (gewijzigd && mag ? setWeggooien(true) : onSluit())}>
        {taak && mag && (
          <button
            type="button"
            className={`db-knop tk-afrond${taak.afgerond ? ' is-af' : ''}`}
            onClick={() => void wisselAfgerond()}
            disabled={bezig}
            aria-pressed={taak.afgerond}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {taak.afgerond ? 'Afgerond' : 'Afronden'}
          </button>
        )}
      </Kop>

      <div className="tk-inhoud">
        {!mag && (
          <p className="tk-melding" role="note">
            Alleen {taak?.aangemaaktDoor ? <Persoon id={taak.aangemaaktDoor} /> : 'de maker'} en wie de taak heeft gekregen,
            kunnen deze taak wijzigen.
          </p>
        )}

        <fieldset className="tk-velden" disabled={!mag}>
          <label className="tk-titelveld">
            <span className="sr-only">Omschrijving</span>
            <input
              ref={titelRef}
              className="tk-titel"
              type="text"
              value={titel}
              maxLength={300}
              placeholder="Wat moet er gebeuren?"
              autoFocus={nieuw || !smal}
              autoComplete="off"
              aria-required="true"
              onChange={(e) => {
                setTitel(e.target.value);
                if (fout) setFout('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                  e.preventDefault();
                  void opslaan();
                }
              }}
            />
          </label>

          {herkend && (
            <div className="tk-herkend">
              <span className="tk-herkend-label">Herkend</span>
              {herkend.tokens.map((t) => (
                <span key={`${t.soort}${t.tekst}`} className={`ag-chip ag-chip-${t.soort === 'klant' ? 'klant' : 'zacht'} ag-chip-mini`}>
                  {t.label}
                </span>
              ))}
              <button type="button" className="ag-link-knop" onClick={() => void pasHerkendToe()}>
                Toepassen
              </button>
            </div>
          )}

          {toonNotitie ? (
            <label className="ag-label">
              Toelichting
              <textarea
                className="ag-veld"
                rows={3}
                value={notitie}
                maxLength={10000}
                placeholder="Details, links, afspraken…"
                autoFocus={!start?.notitie}
                onChange={(e) => setNotitie(e.target.value)}
              />
            </label>
          ) : (
            <button type="button" className="ag-link-knop tk-toelichting" onClick={() => setToonNotitie(true)}>
              + toelichting
            </button>
          )}

          <div className="ag-label">
            <span>{overgang ? 'Voor' : 'Voor wie'}</span>
            <VoorWieKiezer waarde={overgang ? [mijnId] : voorWie} onChange={setVoorWie} uitgeschakeld={overgang || !mag} />
          </div>

          <div className="ag-label">
            <span>Deadline</span>
            <div className="tk-deadline">
              <input
                className="ag-veld"
                type="date"
                aria-label="Datum"
                value={datum}
                onChange={(e) => setDatum(e.target.value)}
              />
              <input
                className="ag-veld"
                type="time"
                step={300}
                aria-label="Tijd (optioneel)"
                title={datum ? 'Tijd (optioneel)' : 'Kies eerst een datum'}
                value={datum ? tijd : ''}
                disabled={!datum}
                onChange={(e) => setTijd(e.target.value)}
              />
              {datum && tijd && (
                <select className="ag-veld" aria-label="Duur" value={duur} onChange={(e) => setDuur(e.target.value)}>
                  {(DUREN.some(([w]) => w === duur) ? DUREN : [...DUREN, [duur, `${duur} min`] as [string, string]]).map(([w, l]) => (
                    <option key={w} value={w}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="tk-snel" role="group" aria-label="Snelkeuze deadline">
              {snel.map(([l, d]) => (
                <button
                  key={l}
                  type="button"
                  className={`tk-snel-knop${datum === d ? ' is-aan' : ''}`}
                  aria-pressed={datum === d}
                  onClick={() => {
                    setDatum(d);
                    if (!d) setTijd('');
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            {datum && <span className={`tk-uitleg${verleden ? ' is-waarschuwing' : ''}`}>{verleden ? `Ligt in het verleden (${dagTekst(datum, vandaag)})` : dagTekst(datum, vandaag)}</span>}
          </div>

          <div className="ag-label" role="group" aria-label="Urgentie">
            <span>
              Urgentie <span className="tk-toets">alt 1·2·3</span>
            </span>
            <div className="ag-segment tk-urgentie">
              {URGENTIE.map(([w, l]) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={prio === w}
                  className={`${prio === w ? 'is-aan' : ''} tk-urgentie-${l.toLowerCase()}`}
                  onClick={() => setPrio(w)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="ag-velden-2">
            <div className="ag-label">
              <span>Klant (optioneel)</span>
              {mag ? (
                <KlantKiezer waarde={klant} onChange={kiesKlant} />
              ) : klant ? (
                <span className="ag-chip ag-chip-klant">{klant.naam}</span>
              ) : (
                <span className="tk-leeg">Geen</span>
              )}
            </div>
            {!overgang && (
              <div className="ag-label">
                <span>Project (optioneel)</span>
                {mag || project ? (
                  <ProjectKiezer waarde={project} klant={klant} onChange={kiesProject} uitgeschakeld={!mag} />
                ) : (
                  <span className="tk-leeg">Geen</span>
                )}
              </div>
            )}
          </div>

          {!overgang && (
            <div className="ag-label">
              <span>Subtaken</span>
              <SubtakenLijst
                regels={regels}
                afvinkbaar={!nieuw}
                uitgeschakeld={!mag}
                bezig={subBezig}
                onToevoegen={subToevoegen}
                onVerwijder={(i) => void subWeg(i)}
                onVerplaats={(i, r) => void subVerplaats(i, r)}
                onVink={(i) => void subVink(i)}
              />
            </div>
          )}
        </fieldset>

        {taak && (
          <p className="tk-meta">
            {taak.aangemaaktDoor ? (
              <>
                Aangemaakt door <Persoon id={taak.aangemaaktDoor} /> · {datumKort(taak.aangemaakt)}
              </>
            ) : (
              <>Aangemaakt {datumKort(taak.aangemaakt)}</>
            )}
            {taak.afgerond && taak.afgerondOp && (
              <>
                <br />
                Afgerond{taak.afgerondDoor ? ' door ' : ' '}
                {taak.afgerondDoor && <Persoon id={taak.afgerondDoor} />} · {datumKort(taak.afgerondOp)}
              </>
            )}
          </p>
        )}

        {fout && (
          <p className="ag-fout" role="alert">
            {fout}
          </p>
        )}
      </div>

      <footer className="tk-voet">
        {weggooien ? (
          <span className="ag-zeker" role="alertdialog" aria-label="Wijzigingen weggooien?">
            <span>Wijzigingen weggooien?</span>
            <button type="button" className="db-knop ag-knop-gevaar" onClick={onSluit} autoFocus>
              Weggooien
            </button>
            <button type="button" className="db-knop" onClick={() => setWeggooien(false)}>
              Verder bewerken
            </button>
          </span>
        ) : verwijderen ? (
          <span className="ag-zeker" role="alertdialog" aria-label="Taak verwijderen?">
            <span>Taak definitief verwijderen{taak && taak.toegewezen.length > 1 ? ' (voor iedereen)' : ''}?</span>
            <button type="button" className="db-knop ag-knop-gevaar" disabled={bezig} onClick={() => void verwijder()} autoFocus>
              Ja, verwijderen
            </button>
            <button type="button" className="db-knop" onClick={() => setVerwijderen(false)}>
              Nee
            </button>
          </span>
        ) : (
          <>
            {taak && mag ? (
              <button type="button" className="ag-link-knop ag-link-gevaar" onClick={() => setVerwijderen(true)}>
                Verwijderen
              </button>
            ) : (
              <span className="tk-toetsen" aria-hidden="true">
                <kbd>⌘</kbd>
                <kbd>↵</kbd> opslaan{nieuw && (
                  <>
                    {' '}· <kbd>⇧</kbd>
                    <kbd>⌘</kbd>
                    <kbd>↵</kbd> en nog een
                  </>
                )}
              </span>
            )}
            <span className="ag-paneel-acties">
              {!mag ? (
                <button type="button" className="db-knop" onClick={onSluit}>
                  Sluiten
                </button>
              ) : (
                <>
                  {nieuw ? (
                    <button type="button" className="db-knop tk-nog-een" disabled={bezig} onClick={() => void opslaan(true)}>
                      Opslaan en nog een
                    </button>
                  ) : (
                    <button type="button" className="db-knop" onClick={onSluit}>
                      Annuleren
                    </button>
                  )}
                  <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
                    {bezig ? 'Bezig…' : nieuw ? 'Taak toevoegen' : 'Opslaan'}
                  </button>
                </>
              )}
            </span>
          </>
        )}
      </footer>
    </form>
  );
}
