'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { typtIn, useSmal } from '@/lib/agenda/client';
import { vandaag } from '@/lib/agenda/datum';
import { adresVol, leesLaatsteVan, mailApi, MailApiFout, meldOngelezen } from '@/lib/mail/client';
import type { Adres, Bericht, Envelop, InboxDto, InboxTeller, MailMap, MapRol } from '@/lib/mail/types';
import { ALLE_INBOXEN } from '@/lib/mail/zichtbaarheid';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { ToastProvider, useToast } from '@/components/agenda/Toast';
import { useTeam } from '@/components/team/TeamProvider';
import { Icoon } from './Iconen';
import { Inboxen } from './Inboxen';
import { Lezer, type LezerActie } from './Lezer';
import { Lijst } from './Lijst';
import { Opsteller, type OpstelModus } from './Opsteller';

// Mail met meerdere inboxen. Links "Alle inboxen" en elke inbox met eigen mappen; in het
// midden de berichten van de gekozen inbox+map (of de INBOX van alle inboxen samen, met per
// bericht de kleur en naam van zijn inbox); rechts het bericht of de opsteller.
// Elk bericht is uniek per inbox + map + uid; elke API-aanroep krijgt de inbox mee.

type LijstStaat = { berichten: Envelop[]; totaal: number; meer: boolean; pagina: number; fouten?: { id: string; label: string }[] };
type Opstel = { modus: OpstelModus; basis: Bericht | null; basisMb: string | null; aan?: string; sleutel: number };
type Selectie = { mb: string; uid: number };

const PER = 40;

/**
 * Werkgeheugen van Mail over tabbladwissels heen: ga je naar een ander tabblad en terug, dan
 * staan tellers, mappen, lijsten en geopende berichten er meteen weer, en ververst Mail op de
 * achtergrond (zoals al binnen de pagina). Alleen in het geheugen van dit browsertabblad
 * (nooit op schijf) en per gebruiker; herladen of uitloggen wist het.
 */
interface MailGeheugen {
  gebruiker: string;
  tellers: Record<string, InboxTeller>;
  mappenPer: Record<string, MailMap[]>;
  lijsten: Record<string, LijstStaat>;
  berichten: Record<string, Bericht>;
}
let geheugen: MailGeheugen | null = null;
const uitGeheugen = (gebruiker: string) => (typeof window !== 'undefined' && geheugen?.gebruiker === gebruiker ? geheugen : null);
const SNELTOETSEN: [string, string][] = [
  ['j / k', 'volgende / vorige'],
  ['r', 'beantwoorden'],
  ['a', 'allen beantwoorden'],
  ['f', 'doorsturen'],
  ['e', 'archiveren'],
  ['#', 'verwijderen'],
  ['u', 'ongelezen'],
  ['s', 'markeren'],
  ['t', 'taak maken'],
  ['c', 'nieuwe mail'],
  ['/', 'zoeken'],
  ['⌘ Enter', 'verzenden']
];
const VERVERS_MS = 2 * 60_000;
const lijstSleutel = (mb: string, map: string, zoek: string) => `${mb}\n${map}\n${zoek}`;
const berichtSleutel = (mb: string, map: string, uid: number) => `${mb}\n${map}\n${uid}`;
const envSleutel = (e: { mb?: string; uid: number }) => `${e.mb ?? ''}\n${e.uid}`;
const isInbox = (pad: string) => pad.toUpperCase() === 'INBOX';
const tijd = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};
const opDatum = (l: Envelop[]) => [...l].sort((a, b) => tijd(b.datum) - tijd(a.datum) || b.uid - a.uid);

export function MailApp(props: {
  inboxen: InboxDto[];
  startMb: string | null;
  startBerichtMb: string | null;
  startMap: string;
  startUid: number | null;
  nieuw: boolean;
  nieuwAan: string;
  mijnEmail: string;
}) {
  return (
    <ToastProvider>
      <Mail {...props} />
    </ToastProvider>
  );
}

function Mail({
  inboxen,
  startMb,
  startBerichtMb,
  startMap,
  startUid,
  nieuw,
  nieuwAan,
  mijnEmail
}: {
  inboxen: InboxDto[];
  startMb: string | null;
  startBerichtMb: string | null;
  startMap: string;
  startUid: number | null;
  nieuw: boolean;
  nieuwAan: string;
  mijnEmail: string;
}) {
  const toast = useToast();
  const { mijnId } = useTeam();
  const smal = useSmal('(max-width: 720px)');
  const middel = useSmal('(max-width: 1100px)');

  const meerdere = inboxen.length > 1;
  const eerste = (inboxen.find((i) => i.leesbaar) ?? inboxen[0]).id;
  const inboxInfo = useMemo(() => new Map(inboxen.map((i) => [i.id, i])), [inboxen]);
  // Een oude link (/mail?uid=…) zonder inbox hoort bij de eerste inbox.
  const beginMb = startMb ?? (startUid && !startBerichtMb ? eerste : meerdere ? ALLE_INBOXEN : eerste);

  const [mb, setMb] = useState(beginMb);
  const [map, setMap] = useState(beginMb === ALLE_INBOXEN ? 'INBOX' : startMap || 'INBOX');
  const [tellers, setTellers] = useState<Record<string, InboxTeller>>(() => uitGeheugen(mijnId)?.tellers ?? {});
  const [mappenPer, setMappenPer] = useState<Record<string, MailMap[]>>(() => uitGeheugen(mijnId)?.mappenPer ?? {});
  const [mappenFout, setMappenFout] = useState<Record<string, MailApiFout>>({});
  const [open, setOpen] = useState<Record<string, boolean>>(() => (beginMb === ALLE_INBOXEN ? {} : { [beginMb]: true }));
  const [zoekInvoer, setZoekInvoer] = useState('');
  const [zoek, setZoek] = useState('');
  const [lijsten, setLijsten] = useState<Record<string, LijstStaat>>(() => uitGeheugen(mijnId)?.lijsten ?? {});
  const [lijstLaden, setLijstLaden] = useState(false);
  const [lijstFout, setLijstFout] = useState<{ sleutel: string; fout: MailApiFout } | null>(null);
  const [meerLaden, setMeerLaden] = useState(false);
  const [sel, setSel] = useState<Selectie | null>(() =>
    startUid ? { mb: beginMb === ALLE_INBOXEN ? (startBerichtMb ?? eerste) : beginMb, uid: startUid } : null
  );
  const [berichten, setBerichten] = useState<Record<string, Bericht>>(() => uitGeheugen(mijnId)?.berichten ?? {});
  useEffect(() => {
    if (mijnId) geheugen = { gebruiker: mijnId, tellers, mappenPer, lijsten, berichten };
  }, [mijnId, tellers, mappenPer, lijsten, berichten]);
  const [berichtLaden, setBerichtLaden] = useState(false);
  const [berichtFout, setBerichtFout] = useState<{ sleutel: string; fout: MailApiFout } | null>(null);
  const [opstel, setOpstel] = useState<Opstel | null>(
    nieuw ? { modus: 'nieuw', basis: null, basisMb: null, aan: nieuwAan, sleutel: 1 } : null
  );
  const [paneel, setPaneel] = useState<'lijst' | 'lezer'>(startUid || nieuw ? 'lezer' : 'lijst');
  const [mappenOpen, setMappenOpen] = useState(false);
  const [adressenPer, setAdressenPer] = useState<Record<string, Adres[]>>({});
  const [verversBezig, setVerversBezig] = useState(false);

  const zoekRef = useRef<HTMLInputElement>(null);
  const handmatigOngelezen = useRef(new Set<string>());
  const adressenGeladen = useRef(new Set<string>());
  const mappenBezig = useRef(new Set<string>());
  const laatsteVerversing = useRef(0);
  const lijstVerzoek = useRef(0);

  const alle = mb === ALLE_INBOXEN;
  const lijstMap = alle ? 'INBOX' : map;
  const huidigeInbox = alle ? null : (inboxInfo.get(mb) ?? null);
  const huidigeMap = alle ? null : (mappenPer[mb]?.find((m) => m.pad === map) ?? null);
  const rol: MapRol = alle ? 'inbox' : (huidigeMap?.rol ?? (isInbox(map) ? 'inbox' : 'overig'));
  const mapNaam = alle ? 'Alle inboxen' : (huidigeMap?.naam ?? (rol === 'inbox' ? 'Inbox' : map));
  const lijst = lijsten[lijstSleutel(mb, lijstMap, zoek)] ?? null;
  const bericht = sel ? (berichten[berichtSleutel(sel.mb, lijstMap, sel.uid)] ?? null) : null;
  const envelop = sel ? lijst?.berichten.find((b) => b.mb === sel.mb && b.uid === sel.uid) : undefined;

  const totaal = useMemo(
    () => inboxen.reduce((s, i) => s + (tellers[i.id]?.ongelezen ?? 0), 0),
    [inboxen, tellers]
  );
  const tellersBekend = Object.keys(tellers).length > 0;
  useEffect(() => {
    if (tellersBekend) meldOngelezen(totaal);
  }, [totaal, tellersBekend]);

  // ---------- laden ----------

  const laadInboxen = useCallback(async () => {
    try {
      const { inboxen: lijst } = await mailApi.inboxen();
      setTellers(Object.fromEntries(lijst.map((i) => [i.id, { id: i.id, ongelezen: i.ongelezen, fout: i.fout }])));
    } catch {
      /* tellers zijn een extraatje: de lijst en mappen tonen hun eigen fouten */
    }
  }, []);

  const laadMappen = useCallback(async (inbox: string) => {
    if (mappenBezig.current.has(inbox)) return;
    mappenBezig.current.add(inbox);
    try {
      const { mappen } = await mailApi.mappen(inbox);
      setMappenPer((o) => ({ ...o, [inbox]: mappen }));
      setMappenFout((o) => {
        if (!o[inbox]) return o;
        const rest = { ...o };
        delete rest[inbox];
        return rest;
      });
      const ib = mappen.find((m) => m.rol === 'inbox');
      if (ib) setTellers((t) => ({ ...t, [inbox]: { id: inbox, ongelezen: ib.ongelezen } }));
    } catch (e) {
      setMappenFout((o) => ({ ...o, [inbox]: e instanceof MailApiFout ? e : new MailApiFout(0, 'Mappen laden mislukt.') }));
    } finally {
      mappenBezig.current.delete(inbox);
    }
  }, []);

  const laadLijst = useCallback(
    async (inbox: string, m: string, z: string, pagina = 1) => {
      const nr = ++lijstVerzoek.current;
      if (pagina === 1) setLijstLaden(true);
      else setMeerLaden(true);
      try {
        const res = await mailApi.berichten(inbox, m, pagina, z, PER);
        const nieuwe = res.berichten.map((e) => (e.mb ? e : { ...e, mb: inbox }));
        const samen = inbox === ALLE_INBOXEN;
        setLijsten((oud) => {
          const sleutel = lijstSleutel(inbox, m, z);
          const vorige = oud[sleutel];
          let staat: LijstStaat;
          if (pagina === 1) {
            // Verversen: eerste pagina vervangen, eerder bijgeladen (oudere) berichten houden.
            let rest: Envelop[] = [];
            if (vorige && vorige.pagina > 1) {
              const nieuwSet = new Set(nieuwe.map(envSleutel));
              if (samen) {
                const min = nieuwe.length ? Math.min(...nieuwe.map((b) => tijd(b.datum))) : Infinity;
                rest = vorige.berichten.filter((b) => !nieuwSet.has(envSleutel(b)) && tijd(b.datum) < min);
              } else {
                const min = nieuwe.length ? Math.min(...nieuwe.map((b) => b.uid)) : Infinity;
                rest = vorige.berichten.filter((b) => b.uid < min);
              }
            }
            staat = {
              berichten: [...nieuwe, ...rest],
              totaal: res.totaal,
              meer: rest.length ? vorige!.meer : res.meer,
              pagina: rest.length ? vorige!.pagina : 1,
              fouten: res.fouten
            };
          } else {
            const bestaand = new Set((vorige?.berichten ?? []).map(envSleutel));
            const lijst = [...(vorige?.berichten ?? []), ...nieuwe.filter((b) => !bestaand.has(envSleutel(b)))];
            staat = { berichten: samen ? opDatum(lijst) : lijst, totaal: res.totaal, meer: res.meer, pagina, fouten: res.fouten };
          }
          return { ...oud, [sleutel]: staat };
        });
        if (nr === lijstVerzoek.current) setLijstFout(null);
      } catch (e) {
        if (nr === lijstVerzoek.current)
          setLijstFout({ sleutel: lijstSleutel(inbox, m, z), fout: e instanceof MailApiFout ? e : new MailApiFout(0, 'Berichten laden mislukt.') });
        if (pagina > 1) toast('Meer berichten laden is niet gelukt.', { fout: true });
      } finally {
        if (nr === lijstVerzoek.current) setLijstLaden(false);
        setMeerLaden(false);
      }
    },
    [toast]
  );

  const laadBericht = useCallback(async (inbox: string, m: string, u: number) => {
    setBerichtLaden(true);
    setBerichtFout(null);
    try {
      const { bericht } = await mailApi.bericht(inbox, m, u);
      setBerichten((oud) => {
        // Houd de cache klein: max. 40 berichten in het geheugen.
        const sleutels = Object.keys(oud);
        const rest = sleutels.length > 40 ? Object.fromEntries(sleutels.slice(-30).map((k) => [k, oud[k]])) : oud;
        return { ...rest, [berichtSleutel(inbox, m, u)]: bericht };
      });
    } catch (e) {
      setBerichtFout({ sleutel: berichtSleutel(inbox, m, u), fout: e instanceof MailApiFout ? e : new MailApiFout(0, 'Bericht laden mislukt.') });
    } finally {
      setBerichtLaden(false);
    }
  }, []);

  const laadAdressen = useCallback((inbox: string) => {
    if (adressenGeladen.current.has(inbox)) return;
    adressenGeladen.current.add(inbox);
    mailApi
      .adressen(inbox)
      .then((r) => setAdressenPer((o) => ({ ...o, [inbox]: r.adressen })))
      .catch(() => adressenGeladen.current.delete(inbox));
  }, []);

  /** Mappen van een inbox opnieuw ophalen, als die al eens geladen zijn (of de huidige inbox). */
  const verversMappen = useCallback(
    (inbox: string) => {
      if (inbox === mb || mappenPer[inbox]) void laadMappen(inbox);
    },
    [mb, mappenPer, laadMappen]
  );

  const ververs = useCallback(
    async (zichtbaar = false) => {
      laatsteVerversing.current = Date.now();
      if (zichtbaar) setVerversBezig(true);
      await Promise.all([laadInboxen(), alle ? null : laadMappen(mb), laadLijst(mb, lijstMap, zoek, 1)]);
      if (zichtbaar) setVerversBezig(false);
    },
    [laadInboxen, laadMappen, laadLijst, alle, mb, lijstMap, zoek]
  );

  // Eerste keer: tellers van alle inboxen.
  // (Het laden start via een timer van 0 ms: de setStates gebeuren zo in een callback en
  // snel na elkaar wisselen — j/k, typen in het zoekveld — annuleert het vorige verzoek.)
  useEffect(() => {
    const t = setTimeout(laadInboxen, 0);
    return () => clearTimeout(t);
  }, [laadInboxen]);

  // Mappen van de gekozen en van opengeklapte inboxen (één keer; daarna bij verversen).
  const nodigeMappen = useMemo(
    () => inboxen.map((i) => i.id).filter((id) => (id === mb || open[id] || !meerdere) && !mappenPer[id] && !mappenFout[id]),
    [inboxen, mb, open, meerdere, mappenPer, mappenFout]
  );
  useEffect(() => {
    if (!nodigeMappen.length) return;
    const t = setTimeout(() => nodigeMappen.forEach((id) => void laadMappen(id)), 0);
    return () => clearTimeout(t);
  }, [nodigeMappen, laadMappen]);

  useEffect(() => {
    // Toon meteen wat in het geheugen staat; ververs op de achtergrond.
    const t = setTimeout(() => laadLijst(mb, lijstMap, zoek, 1), 0);
    return () => clearTimeout(t);
  }, [mb, lijstMap, zoek, laadLijst]);

  // Bericht openen: uit het geheugen als het er al is, anders ophalen (kort uitgesteld,
  // zodat snel j/k-en niet elk tussenliggend bericht ophaalt).
  const inGeheugen = sel != null && Boolean(berichten[berichtSleutel(sel.mb, lijstMap, sel.uid)]);
  useEffect(() => {
    if (!sel || inGeheugen) return;
    const t = setTimeout(() => laadBericht(sel.mb, lijstMap, sel.uid), 120);
    return () => clearTimeout(t);
  }, [sel, lijstMap, inGeheugen, laadBericht]);

  // Verversen bij terugkeren naar het venster (max. 1× per 30 s) en elke 2 minuten.
  useEffect(() => {
    const bijFocus = () => {
      if (document.visibilityState === 'visible' && Date.now() - laatsteVerversing.current > 30_000) ververs();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') ververs();
    }, VERVERS_MS);
    window.addEventListener('focus', bijFocus);
    document.addEventListener('visibilitychange', bijFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', bijFocus);
      document.removeEventListener('visibilitychange', bijFocus);
    };
  }, [ververs]);

  // Telefoon: de terugknop of het terugveeggebaar van het toestel gaat van het leesvenster
  // terug naar de lijst (in plaats van Mail te verlaten). Bij het openen van het leesvenster
  // komt er één stap in de geschiedenis bij (vóór het bijwerken van het adres hieronder, zodat
  // de vorige stap het adres van de lijst houdt); gaat het venster op een andere manier dicht
  // (Terug-knop, archiveren), dan halen we die stap weer weg.
  const lezerStap = useRef(false);
  const lezerOpen = smal && paneel === 'lezer';
  useEffect(() => {
    if (lezerOpen && !lezerStap.current) {
      lezerStap.current = true;
      window.history.pushState({ ...window.history.state, mlLezer: true }, '');
    } else if (!lezerOpen && lezerStap.current) {
      lezerStap.current = false;
      if (window.history.state?.mlLezer) window.history.back();
    }
  }, [lezerOpen]);
  const opstelOpen = opstel != null;
  useEffect(() => {
    const terug = () => {
      if (!lezerStap.current) return;
      if (opstelOpen) {
        // Niet stil een concept weggooien: de stap terugzetten; sluiten gaat via Sluiten.
        window.history.pushState({ ...window.history.state, mlLezer: true }, '');
        return;
      }
      lezerStap.current = false;
      setPaneel('lijst');
      setSel(null);
    };
    window.addEventListener('popstate', terug);
    return () => window.removeEventListener('popstate', terug);
  }, [opstelOpen]);

  // Adres in de URL bijhouden (zonder navigatie), zodat verversen/delen hetzelfde bericht toont.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (meerdere) sp.set('mb', mb);
    if (!alle && map !== 'INBOX') sp.set('map', map);
    if (sel) {
      if (alle) sp.set('umb', sel.mb);
      sp.set('uid', String(sel.uid));
    }
    const url = `/mail${sp.toString() ? `?${sp}` : ''}`;
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', url);
  }, [meerdere, mb, alle, map, sel]);

  // ---------- vlaggen en verplaatsen (optimistisch) ----------

  /** Past een bericht aan in elke lijst waar het in staat (ook "Alle inboxen"). */
  const pasEnvelopAan = useCallback((inbox: string, m: string, u: number, f: (e: Envelop) => Envelop) => {
    setLijsten((oud) => {
      const nieuw: Record<string, LijstStaat> = {};
      for (const [k, v] of Object.entries(oud)) {
        const lmap = k.split('\n')[1];
        nieuw[k] = lmap === m ? { ...v, berichten: v.berichten.map((e) => (e.mb === inbox && e.uid === u ? f(e) : e)) } : v;
      }
      return nieuw;
    });
  }, []);

  const pasOngelezenAan = useCallback((inbox: string, m: string, delta: number) => {
    setMappenPer((oud) => {
      const lijst = oud[inbox];
      if (!lijst) return oud;
      return { ...oud, [inbox]: lijst.map((x) => (x.pad === m ? { ...x, ongelezen: Math.max(0, x.ongelezen + delta) } : x)) };
    });
    if (isInbox(m)) {
      setTellers((t) => {
        const huidig = t[inbox];
        if (!huidig) return t;
        return { ...t, [inbox]: { ...huidig, ongelezen: Math.max(0, huidig.ongelezen + delta) } };
      });
    }
  }, []);

  const zetGelezen = useCallback(
    async (inbox: string, m: string, u: number, gelezen: boolean, stil = false) => {
      pasEnvelopAan(inbox, m, u, (e) => ({ ...e, gelezen }));
      pasOngelezenAan(inbox, m, gelezen ? -1 : 1);
      try {
        await mailApi.vlaggen(inbox, m, u, { gelezen });
        if (!stil) toast(gelezen ? 'Gemarkeerd als gelezen' : 'Gemarkeerd als ongelezen');
      } catch (e) {
        pasEnvelopAan(inbox, m, u, (x) => ({ ...x, gelezen: !gelezen }));
        pasOngelezenAan(inbox, m, gelezen ? 1 : -1);
        toast(e instanceof MailApiFout ? e.message : 'Dat lukte niet.', { fout: true });
      }
    },
    [pasEnvelopAan, pasOngelezenAan, toast]
  );

  const zetVlag = useCallback(
    async (inbox: string, m: string, u: number, gemarkeerd: boolean) => {
      pasEnvelopAan(inbox, m, u, (e) => ({ ...e, gemarkeerd }));
      try {
        await mailApi.vlaggen(inbox, m, u, { gemarkeerd });
      } catch (e) {
        pasEnvelopAan(inbox, m, u, (x) => ({ ...x, gemarkeerd: !gemarkeerd }));
        toast(e instanceof MailApiFout ? e.message : 'Dat lukte niet.', { fout: true });
      }
    },
    [pasEnvelopAan, toast]
  );

  // Automatisch op gelezen zetten als een bericht even open staat (niet bij snel j/k-en).
  useEffect(() => {
    if (!sel || !bericht || !envelop || envelop.gelezen) return;
    if (handmatigOngelezen.current.has(berichtSleutel(sel.mb, lijstMap, sel.uid))) return;
    const timer = setTimeout(() => zetGelezen(sel.mb, lijstMap, sel.uid, true, true), 700);
    return () => clearTimeout(timer);
  }, [sel, lijstMap, bericht, envelop, zetGelezen]);

  const volgendeNa = useCallback(
    (s: Selectie): Selectie | null => {
      const l = lijst?.berichten ?? [];
      const i = l.findIndex((b) => b.mb === s.mb && b.uid === s.uid);
      if (i < 0) return null;
      const doel = l[i + 1] ?? l[i - 1];
      return doel ? { mb: doel.mb ?? s.mb, uid: doel.uid } : null;
    },
    [lijst]
  );

  const verplaats = useCallback(
    async (s: Selectie, naar: 'archief' | 'prullenbak' | 'inbox') => {
      const vanMap = lijstMap;
      const verwijderd = lijst?.berichten.find((b) => b.mb === s.mb && b.uid === s.uid);
      const volgende = volgendeNa(s);
      // Optimistisch weghalen en door naar het volgende bericht.
      setLijsten((oud) => {
        const nieuw: Record<string, LijstStaat> = {};
        for (const [k, v] of Object.entries(oud)) {
          const weg = k.split('\n')[1] === vanMap && v.berichten.some((e) => e.mb === s.mb && e.uid === s.uid);
          nieuw[k] = weg
            ? { ...v, totaal: Math.max(0, v.totaal - 1), berichten: v.berichten.filter((e) => !(e.mb === s.mb && e.uid === s.uid)) }
            : v;
        }
        return nieuw;
      });
      if (verwijderd && !verwijderd.gelezen) pasOngelezenAan(s.mb, vanMap, -1);
      if (sel && sel.mb === s.mb && sel.uid === s.uid) {
        setSel(smal ? null : volgende);
        if (smal) setPaneel('lijst');
      }
      try {
        const res = await mailApi.verplaats(s.mb, vanMap, s.uid, { naar });
        const tekst = naar === 'archief' ? 'Gearchiveerd' : naar === 'prullenbak' ? 'Naar de prullenbak' : 'Naar de inbox';
        const terug = res.uid;
        toast(
          tekst,
          terug
            ? {
                actie: {
                  label: 'Ongedaan maken',
                  onClick: async () => {
                    try {
                      await mailApi.verplaats(s.mb, res.naar, terug, { naarMap: vanMap });
                      await laadLijst(mb, lijstMap, zoek, 1);
                      verversMappen(s.mb);
                      void laadInboxen();
                    } catch (e) {
                      toast(e instanceof MailApiFout ? e.message : 'Terugzetten lukte niet.', { fout: true });
                    }
                  }
                }
              }
            : undefined
        );
        verversMappen(s.mb);
      } catch (e) {
        toast(e instanceof MailApiFout ? e.message : 'Verplaatsen lukte niet.', { fout: true });
        laadLijst(mb, lijstMap, zoek, 1);
        verversMappen(s.mb);
      }
    },
    [lijstMap, lijst, volgendeNa, pasOngelezenAan, sel, smal, toast, laadLijst, mb, zoek, verversMappen, laadInboxen]
  );

  const maakTaak = useCallback(
    async (b: Bericht, inbox: string) => {
      const van = b.van ? adresVol(b.van) : '(onbekend)';
      const link = `/mail?${new URLSearchParams({ mb: inbox, map: b.map, uid: String(b.uid) })}`;
      const label = inboxInfo.get(inbox)?.label;
      try {
        const res = await fetch('/api/taken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titel: `Reageren: ${b.onderwerp || '(geen onderwerp)'}`.slice(0, 300),
            notitie: `Mail van ${van}${meerdere && label ? ` (inbox ${label})` : ''}\n${link}`,
            datum: vandaag(),
            prioriteit: 2
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Taak maken lukte niet.');
        toast('Taak gemaakt voor vandaag', {
          actie: { label: 'Bekijken', onClick: () => (window.location.href = `/agenda?taak=${data.task.id}`) }
        });
      } catch (e) {
        toast((e as Error).message || 'Taak maken lukte niet.', { fout: true });
      }
    },
    [toast, inboxInfo, meerdere]
  );

  // ---------- acties ----------

  const kies = useCallback(
    (e: Envelop) => {
      setSel({ mb: e.mb ?? mb, uid: e.uid });
      setPaneel('lezer');
      setOpstel(null);
    },
    [mb]
  );

  const naarLijst = useCallback(() => {
    setSel(null);
    setZoek('');
    setZoekInvoer('');
    setMappenOpen(false);
    setPaneel('lijst');
    setOpstel(null);
  }, []);

  const wisselMap = useCallback(
    (inbox: string, pad: string) => {
      setMb(inbox);
      setMap(pad);
      setOpen((o) => (o[inbox] ? o : { ...o, [inbox]: true }));
      naarLijst();
    },
    [naarLijst]
  );

  const kiesAlle = useCallback(() => {
    setMb(ALLE_INBOXEN);
    setMap('INBOX');
    naarLijst();
  }, [naarLijst]);

  const opstellen = useCallback((modus: OpstelModus, basis: Bericht | null = null, basisMb: string | null = null) => {
    setOpstel({ modus, basis, basisMb, sleutel: Date.now() });
    setPaneel('lezer');
  }, []);

  /** Vanaf welke inbox een nieuwe mail standaard vertrekt. */
  const standaardVan = useCallback((): string => {
    const bruikbaar = (id: string | null) => (id && inboxInfo.get(id)?.leesbaar ? id : null);
    return bruikbaar(alle ? null : mb) ?? bruikbaar(leesLaatsteVan()) ?? eerste;
  }, [alle, mb, inboxInfo, eerste]);

  const actie = useCallback(
    (a: LezerActie) => {
      if (!bericht || !sel) return;
      switch (a) {
        case 'antwoord':
        case 'allen':
        case 'doorsturen':
          opstellen(a, bericht, sel.mb);
          break;
        case 'archief':
        case 'prullenbak':
        case 'inbox':
          verplaats(sel, a);
          break;
        case 'ongelezen':
          handmatigOngelezen.current.add(berichtSleutel(sel.mb, lijstMap, sel.uid));
          if (envelop?.gelezen !== false) zetGelezen(sel.mb, lijstMap, sel.uid, false);
          break;
        case 'vlag':
          zetVlag(sel.mb, lijstMap, sel.uid, !(envelop?.gemarkeerd ?? bericht.gemarkeerd));
          break;
        case 'taak':
          maakTaak(bericht, sel.mb);
          break;
      }
    },
    [bericht, sel, lijstMap, envelop, opstellen, verplaats, zetGelezen, zetVlag, maakTaak]
  );

  // ---------- sneltoetsen ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typtIn(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const l = lijst?.berichten ?? [];
      const i = sel ? l.findIndex((b) => b.mb === sel.mb && b.uid === sel.uid) : -1;
      const stap = (d: number) => {
        const doel = l[Math.min(l.length - 1, Math.max(0, i + d))] ?? l[0];
        if (doel) {
          setSel({ mb: doel.mb ?? mb, uid: doel.uid });
          setOpstel(null);
          if (!smal) setPaneel('lezer');
        }
      };
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          if (opstel) return;
          e.preventDefault();
          stap(1);
          break;
        case 'k':
        case 'ArrowUp':
          if (opstel) return;
          e.preventDefault();
          stap(-1);
          break;
        case 'Enter':
          if (sel && !opstel) {
            e.preventDefault();
            setPaneel('lezer');
          }
          break;
        case 'c':
          e.preventDefault();
          opstellen('nieuw');
          break;
        case '/':
          e.preventDefault();
          zoekRef.current?.focus();
          zoekRef.current?.select();
          break;
        case 'Escape':
          if (smal && paneel === 'lezer' && !opstel) setPaneel('lijst');
          else if (mappenOpen) setMappenOpen(false);
          break;
        case 'r':
        case 'a':
        case 'f':
        case 'e':
        case '#':
        case 'u':
        case 's':
        case 't': {
          if (!bericht || opstel) return;
          e.preventDefault();
          const kaart: Record<string, LezerActie> = {
            r: 'antwoord',
            a: 'allen',
            f: 'doorsturen',
            e: rol === 'archief' || rol === 'prullenbak' || rol === 'spam' ? 'inbox' : 'archief',
            '#': 'prullenbak',
            u: 'ongelezen',
            s: 'vlag',
            t: 'taak'
          };
          if (e.key === '#' && rol === 'prullenbak') return;
          actie(kaart[e.key]);
          break;
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lijst, sel, mb, opstel, smal, paneel, mappenOpen, bericht, rol, actie, opstellen]);

  // ---------- weergave ----------

  const inboxenLijst = (
    <Inboxen
      inboxen={inboxen}
      tellers={tellers}
      totaal={totaal}
      mappenPer={mappenPer}
      mappenFout={mappenFout}
      open={open}
      actiefMb={mb}
      actiefMap={lijstMap}
      onKiesAlle={kiesAlle}
      onKies={wisselMap}
      onToggle={(id) => setOpen((o) => ({ ...o, [id]: !o[id] }))}
      onOpnieuw={(id) => {
        setMappenFout((o) => {
          const rest = { ...o };
          delete rest[id];
          return rest;
        });
        void laadMappen(id);
      }}
    />
  );

  const knopNaam = alle ? 'Alle inboxen' : meerdere && huidigeInbox ? `${huidigeInbox.label} · ${mapNaam}` : mapNaam;
  const knopAantal = alle ? totaal : rol !== 'verzonden' ? (huidigeMap?.ongelezen ?? (isInbox(map) ? tellers[mb]?.ongelezen : 0) ?? 0) : 0;
  const mappenKnop = middel ? (
    <div className="ml-mapkeuze">
      <button
        type="button"
        className="ml-mapkeuze-knop"
        aria-expanded={mappenOpen}
        aria-haspopup="true"
        onClick={() => setMappenOpen((o) => !o)}
      >
        {huidigeInbox && meerdere && <span className="ml-inbox-stip" style={{ background: huidigeInbox.kleur }} aria-hidden="true" />}
        <span>{knopNaam}</span>
        {knopAantal > 0 && <span className="ml-map-aantal">{knopAantal}</span>}
        <Icoon naam="pijlOmlaag" grootte={14} />
      </button>
      {mappenOpen && (
        <>
          <div className="ml-pop-achter" onClick={() => setMappenOpen(false)} aria-hidden="true" />
          <div className="ml-pop">{inboxenLijst}</div>
        </>
      )}
    </div>
  ) : null;

  const lezerSleutel = useMemo(() => (sel ? berichtSleutel(sel.mb, lijstMap, sel.uid) : 'leeg'), [sel, lijstMap]);
  const klasse = ['ml', smal ? `ml-mobiel-${paneel}` : '', middel ? 'ml-middel' : ''].filter(Boolean).join(' ');
  const kopLabel = meerdere ? `${inboxen.length} inboxen` : inboxen[0].email;
  const selInbox = sel ? (inboxInfo.get(sel.mb) ?? null) : null;

  return (
    <div className="ml-app">
      <ModuleKop label={kopLabel} titel="Mail">
        <button type="button" className="db-knop" onClick={() => ververs(true)} disabled={verversBezig} title="Verversen">
          <Icoon naam="ververs" grootte={15} className={`ml-icoon${verversBezig ? ' ml-draait' : ''}`} />
          <span className="ml-verberg-mobiel">Verversen</span>
        </button>
        <button type="button" className="db-knop db-knop-primair" onClick={() => opstellen('nieuw')} title="Nieuwe mail (c)">
          <Icoon naam="plus" grootte={15} />
          Nieuwe mail
        </button>
      </ModuleKop>

      <div className={klasse}>
        {!middel && (
          <aside className="ml-mappen">
            {inboxenLijst}
            <details className="ml-toetsen">
              <summary>Sneltoetsen</summary>
              <dl>
                {SNELTOETSEN.map(([toets, uitleg]) => (
                  <div key={toets}>
                    <dt>
                      <kbd>{toets}</kbd>
                    </dt>
                    <dd>{uitleg}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </aside>
        )}

        <Lijst
          mapNaam={mapNaam}
          rol={rol}
          berichten={lijst?.berichten ?? null}
          totaal={lijst?.totaal ?? 0}
          geselecteerd={sel ? envSleutel(sel) : null}
          laden={lijstLaden}
          fout={lijstFout?.sleutel === lijstSleutel(mb, lijstMap, zoek) ? lijstFout.fout : null}
          onbereikbaar={lijst?.fouten ?? []}
          meer={Boolean(lijst?.meer)}
          meerLaden={meerLaden}
          zoekInvoer={zoekInvoer}
          zoek={zoek}
          zoekRef={zoekRef}
          mappenKnop={mappenKnop}
          inboxVan={alle ? (id) => inboxInfo.get(id) : undefined}
          onZoekInvoer={setZoekInvoer}
          onZoek={(z) => {
            setZoek(z);
            setSel(null);
          }}
          onKies={kies}
          onMeer={() => laadLijst(mb, lijstMap, zoek, (lijst?.pagina ?? 1) + 1)}
          onOpnieuw={() => laadLijst(mb, lijstMap, zoek, 1)}
          onVlag={(e) => zetVlag(e.mb ?? mb, lijstMap, e.uid, !e.gemarkeerd)}
        />

        {opstel ? (
          <Opsteller
            key={opstel.sleutel}
            modus={opstel.modus}
            basis={opstel.basis}
            basisMb={opstel.basisMb}
            inboxen={inboxen}
            startVan={opstel.basisMb && inboxInfo.get(opstel.basisMb)?.leesbaar ? opstel.basisMb : standaardVan()}
            startAan={opstel.aan}
            mijnEmail={mijnEmail}
            adressenPer={adressenPer}
            laadAdressen={laadAdressen}
            onSluit={() => {
              setOpstel(null);
              if (smal && !sel) setPaneel('lijst');
            }}
            onVerzonden={(antwoordOp, van) => {
              setOpstel(null);
              if (antwoordOp) pasEnvelopAan(antwoordOp.mb, antwoordOp.map, antwoordOp.uid, (e) => ({ ...e, beantwoord: true }));
              if (smal && !sel) setPaneel('lijst');
              // Verzonden-map (en tellers) van de verzendende inbox bijwerken.
              verversMappen(van);
              if (rol === 'verzonden' && mb === van) laadLijst(mb, lijstMap, zoek, 1);
            }}
          />
        ) : (
          <Lezer
            key={lezerSleutel}
            mb={sel?.mb ?? mb}
            inbox={meerdere && selInbox ? { label: selInbox.label, email: selInbox.email, kleur: selInbox.kleur } : null}
            bericht={bericht}
            rol={rol}
            laden={sel != null && (berichtLaden || !bericht)}
            fout={sel && berichtFout?.sleutel === berichtSleutel(sel.mb, lijstMap, sel.uid) ? berichtFout.fout : null}
            gemarkeerd={envelop?.gemarkeerd ?? bericht?.gemarkeerd ?? false}
            smal={smal}
            onActie={actie}
            onTerug={() => {
              setPaneel('lijst');
              setSel(null);
            }}
            onOpnieuw={() => sel && laadBericht(sel.mb, lijstMap, sel.uid)}
          />
        )}
      </div>
    </div>
  );
}
