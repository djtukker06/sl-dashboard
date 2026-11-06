'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { agendaApi, ApiFout, typtIn, useNu } from '@/lib/agenda/client';
import {
  dagDelen,
  eersteVanMaand,
  inAmsterdam,
  korteDag,
  langeDag,
  maandagVan,
  MAANDNAMEN,
  minutenNaarTijd,
  plusDagen,
  plusMaanden,
  weeknummer,
  type Dag
} from '@/lib/agenda/datum';
import type { Afspraak, Taak, TakenFilter, Tellingen } from '@/lib/agenda/types';
import { opMijnNaam } from '@/lib/agenda/zichtbaarheid';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { TaakKnop } from '@/components/dashboard/TaakKnop';
import { TakenProvider, useTaakDialoog, useTaakGebeurtenis } from '@/components/taken/TakenProvider';
import { useTeam } from '@/components/team/TeamProvider';
import { googleApi, isGoogleId } from '@/lib/google-agenda/client';
import { KOPPEL_MELDING, type GoogleStatus } from '@/lib/google-agenda/types';
import { perGebruiker } from '@/lib/mail/client';
import { AFSPRAKEN_GEWIJZIGD } from './AfspraakMeldingen';
import { AgendaBeheer, AgendaChips, type AgendaWijziging } from './Agendas';
import { ItemPaneel, nieuweAfspraak, type Selectie } from './ItemPaneel';
import { MaandView } from './MaandView';
import { Takenlijst } from './Takenlijst';
import { ToastProvider, useToast } from './Toast';
import { useAfvinken } from './useAfvinken';
import { WeekView, type Verplaatsing } from './WeekView';

// 'week' = zeven dagen (op de telefoon drie), 'dag' = één kolom. Zonder eigen keuze is de
// standaard 'week' op een groot scherm en 'dag' op de telefoon (≤ 720px).
export type Weergave = 'dag' | 'week' | 'maand';

// Vroeger onthield de agenda de keuze "Mijn agenda / Heel team" per browser. Die teamweergave
// bestaat niet meer (je ziet alleen wat op jouw naam staat); de oude sleutel ruimen we op.
const OUDE_WIE_SLEUTEL = 'sl-agenda-wie';
/** Of de eigen afspraken (Studio Levant) getoond worden; per gebruiker, in deze browser. */
const EIGEN_SLEUTEL = 'sl-agenda-eigen-verborgen';

/** Als useSmal (≤ 720px), maar bij de server-render en hydratie de gok van de server
 *  (telefoon of niet), zodat een telefoon niet eerst kort de weekweergave laat zien. */
function useSmalScherm(telefoon: boolean): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(max-width: 720px)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(max-width: 720px)').matches,
    () => telefoon
  );
}

export function AgendaApp(props: {
  vandaag: Dag;
  telefoon: boolean;
  startDag: Dag;
  startWeergave: Weergave | null;
  startFilter: TakenFilter;
  startProject: string | null;
  openTaak: string | null;
  openAfspraak: string | null;
  googleUitkomst?: string | null;
}) {
  return (
    <ToastProvider>
      <TakenProvider>
        <Agenda {...props} />
      </TakenProvider>
    </ToastProvider>
  );
}

function Agenda({
  vandaag: vandaagServer,
  telefoon,
  startDag,
  startWeergave,
  startFilter,
  startProject,
  openTaak,
  openAfspraak,
  googleUitkomst
}: {
  vandaag: Dag;
  telefoon: boolean;
  startDag: Dag;
  startWeergave: Weergave | null;
  startFilter: TakenFilter;
  startProject: string | null;
  openTaak: string | null;
  openAfspraak: string | null;
  googleUitkomst?: string | null;
}) {
  const toast = useToast();
  const nu = useNu();
  const smal = useSmalScherm(telefoon);
  const { mijnId, overgang } = useTeam();
  const taakDialoog = useTaakDialoog();
  // "Vandaag" schuift mee als het scherm over middernacht open blijft staan.
  const vandaag = nu ? inAmsterdam(nu).dag : vandaagServer;

  // null = de standaard voor dit scherm (zie Weergave); zo opent de telefoon op één dag
  // zonder dat de server de schermbreedte hoeft te kennen.
  const [keuze, setWeergave] = useState<Weergave | null>(startWeergave);
  const standaard: Weergave = smal ? 'dag' : 'week';
  const weergave = keuze ?? standaard;
  const [focus, setFocus] = useState<Dag>(startDag);
  const [filter, setFilter] = useState<TakenFilter>(overgang && startFilter === 'uitgezet' ? 'vandaag' : startFilter);
  const [project, setProject] = useState<{ id: string; naam: string } | null>(
    startProject ? { id: startProject, naam: 'Project' } : null
  );
  const [teller, setTeller] = useState(0);
  const [bereik, setBereik] = useState<{ sleutel: string; taken: Taak[]; afspraken: Afspraak[] } | null>(null);
  // Of migratie 0034 (herhalende afspraken) er is; tot het eerste antwoord: aannemen van wel.
  const [herhalingKlaar, setHerhalingKlaar] = useState(true);
  const [bereikFout, setBereikFout] = useState<{ sleutel: string; fout: ApiFout | Error } | null>(null);
  const [lijst, setLijst] = useState<{ sleutel: string; taken: Taak[]; tellingen: Tellingen } | null>(null);
  const [lijstFout, setLijstFout] = useState<{ sleutel: string; fout: ApiFout | Error } | null>(null);
  const [selectie, setSelectie] = useState<Selectie | null>(null);
  const [nieuw, setNieuw] = useState<{ dag: Dag; tijd: string | null; x: number; y: number } | null>(null);
  const [mobielTab, setMobielTab] = useState<'taken' | 'agenda'>('agenda');
  // Google Agenda (0035): afspraken van het getoonde bereik, de accounts/agenda's (schakelaars)
  // en of je eigen afspraken getoond worden.
  const [google, setGoogle] = useState<{ sleutel: string; events: Afspraak[]; fouten: { accountId: string; melding: string }[] } | null>(null);
  const [gStatus, setGStatus] = useState<GoogleStatus | null>(null);
  const [beheerOpen, setBeheerOpen] = useState(googleUitkomst === 'gekoppeld');
  const [eigenZichtbaar, setEigenZichtbaar] = useState(true);

  useEffect(() => {
    let verborgen = false;
    try {
      localStorage.removeItem(`${OUDE_WIE_SLEUTEL}:${mijnId}`);
      verborgen = localStorage.getItem(perGebruiker(EIGEN_SLEUTEL)) === '1';
    } catch {
      /* geen opslag */
    }
    if (!verborgen) return;
    // Na de eerste render (de server weet dit niet).
    const t = setTimeout(() => setEigenZichtbaar(false), 0);
    return () => clearTimeout(t);
  }, [mijnId]);

  const kiesEigen = useCallback((zichtbaar: boolean) => {
    setEigenZichtbaar(zichtbaar);
    try {
      if (zichtbaar) localStorage.removeItem(perGebruiker(EIGEN_SLEUTEL));
      else localStorage.setItem(perGebruiker(EIGEN_SLEUTEL), '1');
    } catch {
      /* geen opslag */
    }
  }, []);

  // Terug van het koppelen met Google: melding (de URL-effect hieronder haalt ?google= weg).
  useEffect(() => {
    const m = googleUitkomst ? KOPPEL_MELDING[googleUitkomst] : null;
    if (m) toast(m.tekst, m.fout ? { fout: true } : undefined);
  }, [googleUitkomst, toast]);

  // Projectnaam bij ?project=<id>.
  useEffect(() => {
    if (!startProject) return;
    let weg = false;
    agendaApi
      .project(startProject)
      .then((r) => !weg && setProject({ id: r.project.id, naam: r.project.naam }))
      .catch(() => !weg && setProject(null));
    return () => {
      weg = true;
    };
  }, [startProject]);

  // ---------- zichtbare dagen ----------
  const dagen = useMemo(() => {
    if (weergave === 'maand') {
      const start = maandagVan(eersteVanMaand(focus));
      return Array.from({ length: 42 }, (_, i) => plusDagen(start, i));
    }
    if (weergave === 'dag') return [focus];
    const start = smal ? focus : maandagVan(focus);
    return Array.from({ length: smal ? 3 : 7 }, (_, i) => plusDagen(start, i));
  }, [weergave, focus, smal]);
  const van = dagen[0];
  const tot = dagen[dagen.length - 1];
  const sleutel = `${van}|${tot}`;
  const lijstSleutel = `${filter}|${project?.id ?? ''}`;

  // ---------- data ophalen ----------
  useEffect(() => {
    let weg = false;
    const s = `${van}|${tot}`;
    agendaApi
      .bereik(van, tot)
      .then((r) => {
        if (weg) return;
        setBereik({ sleutel: s, taken: r.tasks, afspraken: r.events });
        setHerhalingKlaar(r.herhaling !== false);
        setBereikFout(null);
      })
      .catch((e) => {
        if (!weg) setBereikFout({ sleutel: s, fout: e });
      });
    return () => {
      weg = true;
    };
  }, [van, tot, teller]);

  // Google-afspraken los van de eigen agenda: is Google traag of stuk, dan staat de rest al.
  useEffect(() => {
    let weg = false;
    const s = `${van}|${tot}`;
    googleApi
      .bereik(van, tot)
      .then((r) => {
        if (weg) return;
        setGoogle({ sleutel: s, events: r.events, fouten: r.fouten });
        setGStatus(r.status);
      })
      .catch(() => {
        if (!weg) setGoogle((g) => (g?.sleutel === s ? g : { sleutel: s, events: [], fouten: [] }));
      });
    return () => {
      weg = true;
    };
  }, [van, tot, teller]);

  useEffect(() => {
    let weg = false;
    const s = `${filter}|${project?.id ?? ''}`;
    agendaApi
      .taken(filter, { project: project?.id })
      .then((r) => {
        if (weg) return;
        setLijst({ sleutel: s, taken: r.tasks, tellingen: r.tellingen });
        setLijstFout(null);
      })
      .catch((e) => {
        if (!weg) setLijstFout({ sleutel: s, fout: e });
      });
    return () => {
      weg = true;
    };
  }, [filter, project?.id, teller]);

  // Verversen als je terugkomt naar het tabblad (bv. taak afgevinkt op het dashboard).
  useEffect(() => {
    const opFocus = () => {
      if (document.visibilityState === 'visible') setTeller((t) => t + 1);
    };
    document.addEventListener('visibilitychange', opFocus);
    return () => document.removeEventListener('visibilitychange', opFocus);
  }, []);

  // Link vanaf het dashboard: /agenda?taak=<id> opent de taak-popup, ?afspraak=<id> het paneel.
  useEffect(() => {
    let weg = false;
    if (openTaak) taakDialoog.open(openTaak);
    else if (openAfspraak) {
      (isGoogleId(openAfspraak) ? googleApi.afspraak(openAfspraak) : agendaApi.afspraak(openAfspraak))
        .then((r) => !weg && setSelectie({ soort: 'afspraak', item: r.event }))
        .catch(() => !weg && toast('Deze afspraak bestaat niet meer.', { fout: true }));
    }
    return () => {
      weg = true;
    };
  }, [openTaak, openAfspraak, toast, taakDialoog]);

  // URL bijhouden (verversen of terug-knop houdt je plek), zonder navigatie.
  useEffect(() => {
    const p = new URLSearchParams();
    if (focus !== vandaag) p.set('dag', focus);
    if (keuze && keuze !== standaard) p.set('weergave', keuze);
    if (filter === 'uitgezet') p.set('lijst', 'uitgezet');
    if (project) p.set('project', project.id);
    const qs = p.toString();
    const url = `/agenda${qs ? `?${qs}` : ''}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url);
  }, [focus, keuze, standaard, vandaag, filter, project]);

  const herlaad = useCallback(() => {
    setTeller((t) => t + 1);
    // De meldingen vooraf (AfspraakMeldingen in de shell) halen de afspraken opnieuw op.
    window.dispatchEvent(new Event(AFSPRAKEN_GEWIJZIGD));
  }, []);

  // ---------- lokale bewerkingen (optimistisch) ----------
  // De laatst getoonde lijsten. Afvinken roept pasTaakAan twee keer aan (direct, en met het
  // antwoord van de server) via de versie van het klikmoment; met de staat van toen zou de
  // teller op de tab dan twee keer verspringen. Daarom de vorige stand altijd hier vandaan.
  const getoond = useRef({ lijst, bereik });
  useEffect(() => {
    getoond.current = { lijst, bereik };
  }, [lijst, bereik]);
  const pasTaakAan = useCallback(
    (t: Taak) => {
      const { lijst: l0, bereik: b0 } = getoond.current;
      const oud = l0?.taken.find((x) => x.id === t.id) ?? b0?.taken.find((x) => x.id === t.id);
      setBereik((b) => (b ? { ...b, taken: b.taken.map((x) => (x.id === t.id ? { ...x, ...t } : x)) } : b));
      setLijst((l) => {
        if (!l) return l;
        const tellingen = { ...l.tellingen };
        // Tellers op de tabs direct bijwerken bij afvinken / heropenen.
        if (oud && oud.afgerond !== t.afgerond) {
          const d = t.afgerond ? -1 : 1;
          const datum = t.datum ?? oud.datum;
          if (!opMijnNaam(t.toegewezen.length ? t : oud, mijnId, overgang)) tellingen.uitgezet = Math.max(0, tellingen.uitgezet + d);
          else if (!datum) tellingen.ooit = Math.max(0, tellingen.ooit + d);
          else if (datum > vandaag) tellingen.gepland = Math.max(0, tellingen.gepland + d);
          else {
            tellingen.vandaag = Math.max(0, tellingen.vandaag + d);
            if (datum < vandaag) tellingen.telaat = Math.max(0, tellingen.telaat + d);
          }
        }
        return { ...l, tellingen, taken: l.taken.map((x) => (x.id === t.id ? { ...x, ...t } : x)) };
      });
    },
    [vandaag, overgang, mijnId]
  );
  const toggle = useAfvinken(pasTaakAan);

  // Taak-popup: na opslaan of verwijderen de lijsten bijwerken en opnieuw ophalen.
  useTaakGebeurtenis((e) => {
    if (e.soort === 'gewijzigd') pasTaakAan(e.taak);
    else if (e.soort === 'verwijderd') {
      setBereik((b) => (b ? { ...b, taken: b.taken.filter((x) => x.id !== e.id) } : b));
      setLijst((l) => (l ? { ...l, taken: l.taken.filter((x) => x.id !== e.id) } : l));
    }
    herlaad();
  });

  const pasAfspraakAan = useCallback((a: Afspraak) => {
    if (a.google) setGoogle((g) => (g ? { ...g, events: g.events.map((x) => (x.id === a.id ? a : x)) } : g));
    else setBereik((b) => (b ? { ...b, afspraken: b.afspraken.map((x) => (x.id === a.id ? a : x)) } : b));
  }, []);

  // ---------- Google-agenda's: tonen, kleur, agenda-link (optimistisch) ----------
  const wijzigAgenda = useCallback(
    async (agendaId: string, w: AgendaWijziging) => {
      const vorige = gStatus;
      const pas = (s: GoogleStatus | null) =>
        s && { ...s, accounts: s.accounts.map((acc) => ({ ...acc, agendas: acc.agendas.map((a) => (a.id === agendaId ? { ...a, ...w } : a)) })) };
      setGStatus(pas);
      // Kleur meteen ook op de al geladen afspraken (behalve die met een eigen kleur in Google).
      if (w.kleur) {
        const oud = vorige?.accounts.flatMap((a) => a.agendas).find((a) => a.id === agendaId)?.kleur;
        setGoogle((g) =>
          g && {
            ...g,
            events: g.events.map((e) => (e.google?.agendaId === agendaId && e.google.kleur === oud ? { ...e, google: { ...e.google, kleur: w.kleur! } } : e))
          }
        );
      }
      try {
        setGStatus(await googleApi.agenda(agendaId, w));
        // Aangezet: de afspraken van die agenda nu ophalen.
        if (w.zichtbaar) setTeller((t) => t + 1);
      } catch (e) {
        setGStatus(vorige);
        toast(e instanceof Error ? e.message : 'Opslaan mislukt.', { fout: true });
      }
    },
    [gStatus, toast]
  );
  const vernieuwAccount = useCallback(
    async (accountId: string) => {
      try {
        setGStatus(await googleApi.vernieuw(accountId));
        setTeller((t) => t + 1);
        toast("Agenda's bijgewerkt");
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Vernieuwen mislukt.', { fout: true });
      }
    },
    [toast]
  );
  const ontkoppelAccount = useCallback(
    async (accountId: string) => {
      try {
        setGStatus(await googleApi.ontkoppel(accountId));
        setGoogle((g) => g && { ...g, events: [], fouten: g.fouten.filter((f) => f.accountId !== accountId) });
        setTeller((t) => t + 1);
        toast('Google-account ontkoppeld');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Ontkoppelen mislukt.', { fout: true });
      }
    },
    [toast]
  );

  const openItem = useCallback(
    (s: Selectie) => {
      if (s.soort === 'taak') taakDialoog.open(s.item.id);
      else setSelectie(s);
    },
    [taakDialoog]
  );

  const nieuweAfspraakOp = useCallback(
    (dag: Dag, tijd: string | null) => {
      // Zonder tijd: het eerstvolgende hele uur (vandaag) of 09:00.
      let start = tijd;
      if (!start) {
        const nuMin = nu ? inAmsterdam(nu).minuten : 0;
        start = dag === vandaag && nuMin < 23 * 60 ? minutenNaarTijd(Math.ceil((nuMin + 1) / 60) * 60) : '09:00';
      }
      setSelectie({ soort: 'afspraak', item: nieuweAfspraak(dag, start, mijnId), nieuw: true });
    },
    [nu, vandaag, mijnId]
  );

  async function verplaats(v: Verplaatsing) {
    if (v.soort === 'taak') {
      const oud = bereik?.taken.find((x) => x.id === v.item.id) ?? lijst?.taken.find((x) => x.id === v.item.id);
      if (oud) {
        // Taak uit de lijst die nog niet in de agenda staat: direct tonen.
        const nieuw = { ...oud, datum: v.datum, tijd: v.tijd };
        setBereik((b) =>
          b ? { ...b, taken: b.taken.some((x) => x.id === oud.id) ? b.taken.map((x) => (x.id === oud.id ? nieuw : x)) : [...b.taken, nieuw] } : b
        );
      }
      try {
        await agendaApi.wijzigTaak(v.item.id, { datum: v.datum, tijd: v.tijd });
        toast(`Verplaatst naar ${korteDag(v.datum)}${v.tijd ? ` ${v.tijd}` : ''}`);
      } catch (e) {
        toast(e instanceof Error ? `Verplaatsen mislukt: ${e.message}` : 'Verplaatsen mislukt.', { fout: true });
      }
      herlaad();
    } else {
      const a = v.item;
      if (v.start) {
        // Optimistisch: blok direct op de nieuwe plek.
        const duurMs = Date.parse(a.eind) - Date.parse(a.start);
        const s = inAmsterdam(a.start);
        const delta =
          (Date.UTC(...ymd(v.datum)) - Date.UTC(...ymd(s.dag))) +
          (minuten(v.start) - s.minuten) * 60_000;
        const start = new Date(Date.parse(a.start) + delta).toISOString();
        pasAfspraakAan({ ...a, start, eind: new Date(Date.parse(start) + duurMs).toISOString() });
      }
      try {
        // Een voorkomen van een reeks slepen verplaatst alleen dat voorkomen.
        const toepassen = a.reeksId ? ('deze' as const) : undefined;
        const wijziging = v.start
          ? { datum: v.datum, start: v.start, duur: Math.round((Date.parse(a.eind) - Date.parse(a.start)) / 60000), toepassen }
          : { datum: v.datum, toepassen };
        if (a.google) await googleApi.wijzig(a.id, wijziging);
        else await agendaApi.wijzigAfspraak(a.id, wijziging);
        toast(`Verplaatst naar ${korteDag(v.datum)}${v.start ? ` ${v.start}` : ''}`);
      } catch (e) {
        toast(e instanceof Error ? `Verplaatsen mislukt: ${e.message}` : 'Verplaatsen mislukt.', { fout: true });
      }
      herlaad();
    }
  }

  // ---------- navigatie ----------
  const stap = weergave === 'dag' ? 1 : smal ? 3 : 7;
  const vorige = useCallback(() => {
    setFocus((f) => (weergave === 'maand' ? plusMaanden(f, -1) : plusDagen(f, -stap)));
  }, [weergave, stap]);
  const volgende = useCallback(() => {
    setFocus((f) => (weergave === 'maand' ? plusMaanden(f, 1) : plusDagen(f, stap)));
  }, [weergave, stap]);
  // Klik op een daglabel in de week: die dag als dagweergave. Klik op een dag in de maand:
  // terug naar de standaardweergave rond die dag (groot scherm: week, telefoon: dag).
  const naarDag = useCallback((d: Dag) => {
    setFocus(d);
    setWeergave('dag');
  }, []);
  const uitMaand = useCallback((d: Dag) => {
    setFocus(d);
    setWeergave(null);
  }, []);
  const naarVandaag = useCallback(() => setFocus(vandaag), [vandaag]);

  // Sneltoetsen: n = nieuwe taak (TakenProvider), a = afspraak, t = vandaag, d/w/m = weergave,
  // ←/→ = vorige/volgende.
  useEffect(() => {
    function toets(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || typtIn(e.target) || selectie || nieuw) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'a') {
        e.preventDefault();
        nieuweAfspraakOp(dagen.includes(vandaag) ? vandaag : focus, null);
      } else if (k === 't') naarVandaag();
      else if (k === 'd') setWeergave('dag');
      else if (k === 'w') setWeergave('week');
      else if (k === 'm') setWeergave('maand');
      else if (e.key === 'ArrowLeft') vorige();
      else if (e.key === 'ArrowRight') volgende();
    }
    document.addEventListener('keydown', toets);
    return () => document.removeEventListener('keydown', toets);
  }, [selectie, nieuw, naarVandaag, vorige, volgende, nieuweAfspraakOp, dagen, vandaag, focus]);

  // ---------- afgeleide staat ----------
  const huidigBereik = bereik?.sleutel === sleutel ? bereik : null;
  const toonBereik = huidigBereik ?? bereik; // tijdens laden de vorige week blijven tonen
  // Alle getoonde afspraken: je eigen (als die aan staan) en die van de zichtbare Google-agenda's,
  // met de kleur en naam zoals nu ingesteld (een schakelaar werkt zo meteen, vóór het antwoord).
  const googleAgendas = useMemo(() => gStatus?.accounts.flatMap((a) => a.agendas) ?? [], [gStatus]);
  const afspraken = useMemo(() => {
    const eigen = eigenZichtbaar ? (toonBereik?.afspraken ?? []) : [];
    const perId = new Map(googleAgendas.map((a) => [a.id, a]));
    const uitGoogle = (google?.sleutel === sleutel ? google.events : (google?.events ?? [])).flatMap((e) => {
      const ag = e.google ? perId.get(e.google.agendaId) : undefined;
      return ag?.zichtbaar ? [{ ...e, google: { ...e.google!, agendaNaam: ag.naam } }] : [];
    });
    return uitGoogle.length ? [...eigen, ...uitGoogle] : eigen;
  }, [eigenZichtbaar, toonBereik, google, sleutel, googleAgendas]);
  const bereikLaadt = !huidigBereik && !(bereikFout?.sleutel === sleutel);
  const huidigeLijst = lijst?.sleutel === lijstSleutel ? lijst : null;
  const lijstFoutNu = lijstFout?.sleutel === lijstSleutel ? lijstFout.fout : null;
  const nietIngericht =
    (bereikFout?.fout instanceof ApiFout && bereikFout.fout.nietIngericht) ||
    (lijstFoutNu instanceof ApiFout && lijstFoutNu.nietIngericht);

  const titel = useMemo(() => {
    if (weergave === 'maand') {
      const { j, m } = dagDelen(focus);
      return `${MAANDNAMEN[m - 1]} ${j}`;
    }
    if (weergave === 'dag') return langeDag(focus);
    const a = dagDelen(dagen[0]);
    const b = dagDelen(dagen[dagen.length - 1]);
    if (a.m === b.m) return `${MAANDNAMEN[a.m - 1]} ${a.j}`;
    const kort = (m: number) => MAANDNAMEN[m - 1].slice(0, 3);
    return a.j === b.j ? `${kort(a.m)} – ${kort(b.m)} ${b.j}` : `${kort(a.m)} ${a.j} – ${kort(b.m)} ${b.j}`;
  }, [weergave, focus, dagen]);

  if (nietIngericht) {
    return (
      <>
        <ModuleKop label="Planning" titel="Agenda & taken" />
        <div className="ag-setup">
          <div className="db-melding db-melding-setup">
            <p className="db-melding-titel">Agenda nog niet ingericht</p>
            <p className="db-melding-tekst">
              De tabellen voor taken en afspraken bestaan nog niet in de database. Voer in Supabase (SQL Editor) de
              migratie <code>supabase/migrations/0018_agenda_taken.sql</code> uit — of het verzamelbestand{' '}
              <code>supabase/UITVOEREN_IN_SQL_EDITOR.sql</code> — en ververs daarna deze pagina.
            </p>
            <div className="db-melding-actie">
              <button type="button" className="db-knop" onClick={() => window.location.reload()}>
                Opnieuw controleren
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ModuleKop label={`Planning · week ${weeknummer(vandaag)}`} titel="Agenda & taken">
        <TaakKnop />
        <button type="button" className="db-knop" title="Nieuwe afspraak (a)" aria-keyshortcuts="a" onClick={() => nieuweAfspraakOp(dagen.includes(vandaag) ? vandaag : focus, null)}>
          + Afspraak
        </button>
        <div className="ag-mobiel-tabs" role="tablist" aria-label="Weergave">
          <button type="button" role="tab" aria-selected={mobielTab === 'taken'} onClick={() => setMobielTab('taken')}>
            Taken
          </button>
          <button type="button" role="tab" aria-selected={mobielTab === 'agenda'} onClick={() => setMobielTab('agenda')}>
            Agenda
          </button>
        </div>
      </ModuleKop>

      {!overgang && project && (
        <div className="ag-filterbalk">
          <span className="ag-chip tk-chip-project ag-filter-project">
            Project: {project.naam}
            <button type="button" className="ag-chip-x" aria-label="Projectfilter weghalen" onClick={() => setProject(null)}>
              ×
            </button>
          </span>
        </div>
      )}

      <div className={`ag ag-toon-${mobielTab}`}>
        <section className="ag-links" aria-label="Taken">
          <Takenlijst
            filter={filter}
            onFilter={setFilter}
            taken={huidigeLijst?.taken ?? null}
            tellingen={huidigeLijst?.tellingen ?? lijst?.tellingen ?? null}
            vandaag={vandaag}
            laden={!huidigeLijst && !lijstFoutNu}
            fout={lijstFoutNu ? lijstFoutNu.message : null}
            onOpnieuw={herlaad}
            onToggle={toggle}
            onOpen={(t) => taakDialoog.open(t.id)}
            onNieuw={() =>
              taakDialoog.nieuw({
                project: project ? { id: project.id, naam: project.naam, klantId: null, klantNaam: null } : undefined
              })
            }
            metUitgezet={!overgang}
          />
          <p className="ag-toetsen" aria-hidden="true">
            <kbd>n</kbd> taak · <kbd>a</kbd> afspraak · <kbd>t</kbd> vandaag · <kbd>d</kbd>/<kbd>w</kbd>/<kbd>m</kbd> dag/week/maand · <kbd>←</kbd>
            <kbd>→</kbd> bladeren
          </p>
        </section>

        <section className="ag-rechts" aria-label="Agenda">
          <div className="ag-balk-boven">
            <div className="ag-nav">
              <button type="button" className="db-knop" onClick={naarVandaag} disabled={weergave !== 'maand' && dagen.includes(vandaag)}>
                Vandaag
              </button>
              <button type="button" className="ag-icoonknop" onClick={vorige} aria-label="Vorige" title="Vorige (←)">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button type="button" className="ag-icoonknop" onClick={volgende} aria-label="Volgende" title="Volgende (→)">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <h2 className="ag-titel">
                {titel}
                {weergave !== 'maand' && <span className="ag-titel-week">week {weeknummer(dagen[0])}</span>}
              </h2>
              {bereikLaadt && <span className="ag-laadt" aria-label="Laden" />}
            </div>
            <div className="ag-balk-rechts">
            <AgendaBeheer
              status={gStatus}
              eigenZichtbaar={eigenZichtbaar}
              fouten={google?.fouten ?? []}
              open={beheerOpen}
              onOpen={setBeheerOpen}
              onEigen={kiesEigen}
              onWijzig={(id, w) => void wijzigAgenda(id, w)}
              onVernieuw={vernieuwAccount}
              onOntkoppel={ontkoppelAccount}
            />
            <div className="ag-segment" role="group" aria-label="Weergave">
              <button type="button" aria-pressed={weergave === 'dag'} className={weergave === 'dag' ? 'is-aan' : ''} onClick={() => setWeergave('dag')} title="Dag (d)">
                Dag
              </button>
              <button type="button" aria-pressed={weergave === 'week'} className={weergave === 'week' ? 'is-aan' : ''} onClick={() => setWeergave('week')} title={smal ? 'Drie dagen (w)' : 'Week (w)'}>
                {smal ? '3 dagen' : 'Week'}
              </button>
              <button type="button" aria-pressed={weergave === 'maand'} className={weergave === 'maand' ? 'is-aan' : ''} onClick={() => setWeergave('maand')} title="Maand (m)">
                Maand
              </button>
            </div>
            </div>
          </div>
          {gStatus?.tabellen && (
            <AgendaChips status={gStatus} eigenZichtbaar={eigenZichtbaar} onEigen={kiesEigen} onWijzig={(id, w) => void wijzigAgenda(id, w)} />
          )}

          {bereikFout?.sleutel === sleutel && !huidigBereik ? (
            <div className="ag-setup">
              <div className="db-melding db-melding-fout" role="alert">
                <p className="db-melding-titel">Agenda kon niet worden geladen</p>
                <p className="db-melding-tekst">{bereikFout.fout.message}</p>
                <div className="db-melding-actie">
                  <button type="button" className="db-knop" onClick={herlaad}>
                    Opnieuw
                  </button>
                </div>
              </div>
            </div>
          ) : weergave !== 'maand' ? (
            <WeekView
              dagen={dagen}
              vandaag={vandaag}
              nu={nu}
              taken={toonBereik?.taken ?? []}
              afspraken={afspraken}
              onOpen={openItem}
              onToggle={toggle}
              onNieuw={(dag, tijd, x, y) => setNieuw({ dag, tijd, x, y })}
              onVerplaats={(v) => void verplaats(v)}
              onKiesDag={weergave === 'dag' ? undefined : naarDag}
            />
          ) : (
            <MaandView
              dagen={dagen}
              maand={dagDelen(focus).m}
              vandaag={vandaag}
              taken={toonBereik?.taken ?? []}
              afspraken={afspraken}
              onOpen={openItem}
              onKiesDag={uitMaand}
              onVerplaats={(v) => void verplaats(v)}
            />
          )}
        </section>
      </div>

      {nieuw && (
        <NieuwKeuze
          x={nieuw.x}
          y={nieuw.y}
          titel={`${korteDag(nieuw.dag)}${nieuw.tijd ? ` · ${nieuw.tijd}` : ''}`}
          onSluit={() => setNieuw(null)}
          onAfspraak={() => {
            setNieuw(null);
            nieuweAfspraakOp(nieuw.dag, nieuw.tijd);
          }}
          onTaak={() => {
            setNieuw(null);
            taakDialoog.nieuw({ datum: nieuw.dag, tijd: nieuw.tijd });
          }}
        />
      )}

      {selectie && selectie.soort === 'afspraak' && (
        <ItemPaneel
          selectie={selectie}
          herhalingKlaar={herhalingKlaar}
          googleAgendas={googleAgendas}
          onSluit={() => setSelectie(null)}
          onOpgeslagen={(s) => {
            setSelectie(null);
            if (s.soort === 'afspraak' && s.item.google) {
              const item = s.item;
              if (selectie.nieuw) setGoogle((g) => (g ? { ...g, events: [...g.events, item] } : g));
              else pasAfspraakAan(item);
            } else if (s.soort === 'afspraak') {
              // Alleen lokaal tonen als de afspraak (nog) op jouw naam staat; anders verdwijnt hij bij herladen toch.
              const vanMij = overgang || s.item.deelnemers.includes(mijnId);
              if (selectie.nieuw) {
                if (vanMij) setBereik((b) => (b ? { ...b, afspraken: [...b.afspraken, s.item] } : b));
              } else if (vanMij) pasAfspraakAan(s.item);
              else setBereik((b) => (b ? { ...b, afspraken: b.afspraken.filter((x) => x.id !== s.item.id) } : b));
            }
            herlaad();
          }}
          onVerwijderd={(s) => {
            setSelectie(null);
            if (s.soort === 'afspraak' && s.item.google) setGoogle((g) => (g ? { ...g, events: g.events.filter((x) => x.id !== s.item.id) } : g));
            else setBereik((b) => (b ? { ...b, afspraken: b.afspraken.filter((x) => x.id !== s.item.id) } : b));
            herlaad();
          }}
        />
      )}
    </>
  );
}

function ymd(dag: Dag): [number, number, number] {
  const { j, m, d } = dagDelen(dag);
  return [j, m - 1, d];
}
function minuten(t: string): number {
  const [u, m] = t.split(':').map(Number);
  return u * 60 + m;
}

/** Klein keuzevenster bij een klik op een leeg vak: afspraak of taak op die dag/tijd. */
function NieuwKeuze({
  x,
  y,
  titel,
  onSluit,
  onAfspraak,
  onTaak
}: {
  x: number;
  y: number;
  titel: string;
  onSluit: () => void;
  onAfspraak: () => void;
  onTaak: () => void;
}) {
  const doos = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vorige = document.activeElement as HTMLElement | null;
    doos.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function buiten(e: PointerEvent) {
      if (doos.current && !doos.current.contains(e.target as Node)) onSluit();
    }
    // Pas na deze klik luisteren, anders sluit hij meteen weer.
    const t = setTimeout(() => document.addEventListener('pointerdown', buiten), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', buiten);
      if (vorige && document.contains(vorige)) vorige.focus({ preventScroll: true });
    };
  }, [onSluit]);
  const breedte = 280;
  const stijl: React.CSSProperties = {
    left: `clamp(16px, ${x - breedte / 2}px, calc(100vw - ${breedte + 16}px))`,
    // Niet achter de tabbalk op de telefoon (--sl-onder, app.css).
    top: `clamp(16px, ${y + 12}px, calc(100dvh - var(--sl-onder, 0px) - 160px))`,
    width: `min(${breedte}px, calc(100vw - 32px))`
  };
  return (
    <div
      ref={doos}
      className="ag-popover ag-keuze"
      style={stijl}
      role="dialog"
      aria-label={`Nieuw op ${titel}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onSluit();
        } else if (e.key.toLowerCase() === 'a') {
          e.preventDefault();
          onAfspraak();
        } else if (e.key.toLowerCase() === 't') {
          e.preventDefault();
          onTaak();
        }
      }}
    >
      <p className="db-label ag-popover-titel">Nieuw · {titel}</p>
      <button type="button" className="ag-keuze-knop" onClick={onAfspraak}>
        <span>Afspraak</span>
        <kbd>a</kbd>
      </button>
      <button type="button" className="ag-keuze-knop" onClick={onTaak}>
        <span>Taak</span>
        <kbd>t</kbd>
      </button>
    </div>
  );
}
