'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { typtIn, useSmal } from '@/lib/agenda/client';
import { vandaag } from '@/lib/agenda/datum';
import { adresVol, mailApi, MailApiFout, meldOngelezen } from '@/lib/mail/client';
import type { Adres, Bericht, Envelop, MailMap, MapRol } from '@/lib/mail/types';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { ToastProvider, useToast } from '@/components/agenda/Toast';
import { Icoon } from './Iconen';
import { Lezer, type LezerActie } from './Lezer';
import { Lijst } from './Lijst';
import { Mappen } from './Mappen';
import { Opsteller, type OpstelModus } from './Opsteller';

type LijstStaat = { berichten: Envelop[]; totaal: number; meer: boolean; pagina: number };
type Opstel = { modus: OpstelModus; basis: Bericht | null; aan?: string; sleutel: number };

const PER = 40;
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
const sleutelVan = (map: string, zoek: string) => `${map}\n${zoek}`;
const berichtSleutel = (map: string, uid: number) => `${map}\n${uid}`;

export function MailApp(props: {
  account: string;
  handtekening: string;
  startMap: string;
  startUid: number | null;
  nieuw: boolean;
  nieuwAan: string;
}) {
  return (
    <ToastProvider>
      <Mail {...props} />
    </ToastProvider>
  );
}

function Mail({
  account,
  handtekening,
  startMap,
  startUid,
  nieuw,
  nieuwAan
}: {
  account: string;
  handtekening: string;
  startMap: string;
  startUid: number | null;
  nieuw: boolean;
  nieuwAan: string;
}) {
  const toast = useToast();
  const smal = useSmal('(max-width: 720px)');
  const middel = useSmal('(max-width: 1100px)');

  const [mappen, setMappen] = useState<MailMap[] | null>(null);
  const [mappenFout, setMappenFout] = useState<MailApiFout | null>(null);
  const [map, setMap] = useState(startMap || 'INBOX');
  const [zoekInvoer, setZoekInvoer] = useState('');
  const [zoek, setZoek] = useState('');
  const [lijsten, setLijsten] = useState<Record<string, LijstStaat>>({});
  const [lijstLaden, setLijstLaden] = useState(false);
  const [lijstFout, setLijstFout] = useState<{ sleutel: string; fout: MailApiFout } | null>(null);
  const [meerLaden, setMeerLaden] = useState(false);
  const [uid, setUid] = useState<number | null>(startUid);
  const [berichten, setBerichten] = useState<Record<string, Bericht>>({});
  const [berichtLaden, setBerichtLaden] = useState(false);
  const [berichtFout, setBerichtFout] = useState<{ sleutel: string; fout: MailApiFout } | null>(null);
  const [opstel, setOpstel] = useState<Opstel | null>(nieuw ? { modus: 'nieuw', basis: null, aan: nieuwAan, sleutel: 1 } : null);
  const [paneel, setPaneel] = useState<'lijst' | 'lezer'>(startUid || nieuw ? 'lezer' : 'lijst');
  const [mappenOpen, setMappenOpen] = useState(false);
  const [adressen, setAdressen] = useState<Adres[]>([]);
  const [verversBezig, setVerversBezig] = useState(false);

  const zoekRef = useRef<HTMLInputElement>(null);
  const handmatigOngelezen = useRef(new Set<string>());
  const adressenGeladen = useRef(false);
  const laatsteVerversing = useRef(0);
  const lijstVerzoek = useRef(0);

  const huidigeMap = mappen?.find((m) => m.pad === map) ?? null;
  const rol: MapRol = huidigeMap?.rol ?? (map.toUpperCase() === 'INBOX' ? 'inbox' : 'overig');
  const mapNaam = huidigeMap?.naam ?? (rol === 'inbox' ? 'Inbox' : map);
  const lijst = lijsten[sleutelVan(map, zoek)] ?? null;
  const bericht = uid != null ? (berichten[berichtSleutel(map, uid)] ?? null) : null;
  const envelop = uid != null ? lijst?.berichten.find((b) => b.uid === uid) : undefined;

  // ---------- laden ----------

  const laadMappen = useCallback(async () => {
    try {
      const { mappen } = await mailApi.mappen();
      setMappen(mappen);
      setMappenFout(null);
      const inbox = mappen.find((m) => m.rol === 'inbox');
      if (inbox) meldOngelezen(inbox.ongelezen);
    } catch (e) {
      setMappenFout(e instanceof MailApiFout ? e : new MailApiFout(0, 'Mappen laden mislukt.'));
    }
  }, []);

  const laadLijst = useCallback(async (m: string, z: string, pagina = 1) => {
    const nr = ++lijstVerzoek.current;
    if (pagina === 1) setLijstLaden(true);
    else setMeerLaden(true);
    try {
      const res = await mailApi.berichten(m, pagina, z, PER);
      setLijsten((oud) => {
        const sleutel = sleutelVan(m, z);
        const vorige = oud[sleutel];
        let staat: LijstStaat;
        if (pagina === 1) {
          // Verversen: eerste pagina vervangen, eerder bijgeladen (oudere) berichten houden.
          const min = res.berichten.length ? Math.min(...res.berichten.map((b) => b.uid)) : Infinity;
          const rest = vorige && vorige.pagina > 1 ? vorige.berichten.filter((b) => b.uid < min) : [];
          staat = {
            berichten: [...res.berichten, ...rest],
            totaal: res.totaal,
            meer: rest.length ? vorige!.meer : res.meer,
            pagina: rest.length ? vorige!.pagina : 1
          };
        } else {
          const bestaand = new Set((vorige?.berichten ?? []).map((b) => b.uid));
          staat = {
            berichten: [...(vorige?.berichten ?? []), ...res.berichten.filter((b) => !bestaand.has(b.uid))],
            totaal: res.totaal,
            meer: res.meer,
            pagina
          };
        }
        return { ...oud, [sleutel]: staat };
      });
      if (nr === lijstVerzoek.current) setLijstFout(null);
    } catch (e) {
      if (nr === lijstVerzoek.current)
        setLijstFout({ sleutel: sleutelVan(m, z), fout: e instanceof MailApiFout ? e : new MailApiFout(0, 'Berichten laden mislukt.') });
      if (pagina > 1) toast('Meer berichten laden is niet gelukt.', { fout: true });
    } finally {
      if (nr === lijstVerzoek.current) setLijstLaden(false);
      setMeerLaden(false);
    }
  }, [toast]);

  const laadBericht = useCallback(async (m: string, u: number) => {
    setBerichtLaden(true);
    setBerichtFout(null);
    try {
      const { bericht } = await mailApi.bericht(m, u);
      setBerichten((oud) => {
        // Houd de cache klein: max. 40 berichten in het geheugen.
        const sleutels = Object.keys(oud);
        const rest = sleutels.length > 40 ? Object.fromEntries(sleutels.slice(-30).map((k) => [k, oud[k]])) : oud;
        return { ...rest, [berichtSleutel(m, u)]: bericht };
      });
    } catch (e) {
      setBerichtFout({ sleutel: berichtSleutel(m, u), fout: e instanceof MailApiFout ? e : new MailApiFout(0, 'Bericht laden mislukt.') });
    } finally {
      setBerichtLaden(false);
    }
  }, []);

  const ververs = useCallback(
    async (zichtbaar = false) => {
      laatsteVerversing.current = Date.now();
      if (zichtbaar) setVerversBezig(true);
      await Promise.all([laadMappen(), laadLijst(map, zoek, 1)]);
      if (zichtbaar) setVerversBezig(false);
    },
    [laadMappen, laadLijst, map, zoek]
  );

  // Eerste keer en bij wisselen van map/zoekterm.
  // (Het laden start via een timer van 0 ms: de setStates gebeuren zo in een callback en
  // snel na elkaar wisselen — j/k, typen in het zoekveld — annuleert het vorige verzoek.)
  useEffect(() => {
    const t = setTimeout(laadMappen, 0);
    return () => clearTimeout(t);
  }, [laadMappen]);

  useEffect(() => {
    // Toon meteen wat in het geheugen staat; ververs op de achtergrond.
    const t = setTimeout(() => laadLijst(map, zoek, 1), 0);
    return () => clearTimeout(t);
  }, [map, zoek, laadLijst]);

  // Bericht openen: uit het geheugen als het er al is, anders ophalen (kort uitgesteld,
  // zodat snel j/k-en niet elk tussenliggend bericht ophaalt).
  const inGeheugen = uid != null && Boolean(berichten[berichtSleutel(map, uid)]);
  useEffect(() => {
    if (uid == null || inGeheugen) return;
    const t = setTimeout(() => laadBericht(map, uid), 120);
    return () => clearTimeout(t);
  }, [map, uid, inGeheugen, laadBericht]);

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

  // Adres in de URL bijhouden (zonder navigatie), zodat verversen/delen hetzelfde bericht toont.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (map !== 'INBOX') sp.set('map', map);
    if (uid != null) sp.set('uid', String(uid));
    const url = `/mail${sp.toString() ? `?${sp}` : ''}`;
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', url);
  }, [map, uid]);

  // Adressuggesties pas ophalen als er een opsteller open gaat.
  useEffect(() => {
    if (!opstel || adressenGeladen.current) return;
    adressenGeladen.current = true;
    mailApi
      .adressen()
      .then((r) => setAdressen(r.adressen))
      .catch(() => {
        adressenGeladen.current = false;
      });
  }, [opstel]);

  // ---------- vlaggen en verplaatsen (optimistisch) ----------

  const pasEnvelopAan = useCallback((m: string, u: number, f: (e: Envelop) => Envelop) => {
    setLijsten((oud) => {
      const nieuw: Record<string, LijstStaat> = {};
      for (const [k, v] of Object.entries(oud)) {
        nieuw[k] = k.startsWith(`${m}\n`) ? { ...v, berichten: v.berichten.map((e) => (e.uid === u ? f(e) : e)) } : v;
      }
      return nieuw;
    });
  }, []);

  const pasOngelezenAan = useCallback((m: string, delta: number) => {
    setMappen((oud) => {
      if (!oud) return oud;
      const nieuw = oud.map((x) => (x.pad === m ? { ...x, ongelezen: Math.max(0, x.ongelezen + delta) } : x));
      const inbox = nieuw.find((x) => x.rol === 'inbox');
      if (inbox && inbox.pad === m) meldOngelezen(inbox.ongelezen);
      return nieuw;
    });
  }, []);

  const zetGelezen = useCallback(
    async (m: string, u: number, gelezen: boolean, stil = false) => {
      pasEnvelopAan(m, u, (e) => ({ ...e, gelezen }));
      pasOngelezenAan(m, gelezen ? -1 : 1);
      try {
        await mailApi.vlaggen(m, u, { gelezen });
        if (!stil) toast(gelezen ? 'Gemarkeerd als gelezen' : 'Gemarkeerd als ongelezen');
      } catch (e) {
        pasEnvelopAan(m, u, (x) => ({ ...x, gelezen: !gelezen }));
        pasOngelezenAan(m, gelezen ? 1 : -1);
        toast(e instanceof MailApiFout ? e.message : 'Dat lukte niet.', { fout: true });
      }
    },
    [pasEnvelopAan, pasOngelezenAan, toast]
  );

  const zetVlag = useCallback(
    async (m: string, u: number, gemarkeerd: boolean) => {
      pasEnvelopAan(m, u, (e) => ({ ...e, gemarkeerd }));
      try {
        await mailApi.vlaggen(m, u, { gemarkeerd });
      } catch (e) {
        pasEnvelopAan(m, u, (x) => ({ ...x, gemarkeerd: !gemarkeerd }));
        toast(e instanceof MailApiFout ? e.message : 'Dat lukte niet.', { fout: true });
      }
    },
    [pasEnvelopAan, toast]
  );

  // Automatisch op gelezen zetten als een bericht even open staat (niet bij snel j/k-en).
  useEffect(() => {
    if (uid == null || !bericht || !envelop || envelop.gelezen) return;
    if (handmatigOngelezen.current.has(berichtSleutel(map, uid))) return;
    const timer = setTimeout(() => zetGelezen(map, uid, true, true), 700);
    return () => clearTimeout(timer);
  }, [uid, map, bericht, envelop, zetGelezen]);

  const volgendeNa = useCallback(
    (u: number): number | null => {
      const l = lijst?.berichten ?? [];
      const i = l.findIndex((b) => b.uid === u);
      if (i < 0) return null;
      return l[i + 1]?.uid ?? l[i - 1]?.uid ?? null;
    },
    [lijst]
  );

  const verplaats = useCallback(
    async (u: number, naar: 'archief' | 'prullenbak' | 'inbox') => {
      const vanMap = map;
      const verwijderd = lijst?.berichten.find((b) => b.uid === u);
      const volgende = volgendeNa(u);
      // Optimistisch weghalen en door naar het volgende bericht.
      setLijsten((oud) => {
        const nieuw: Record<string, LijstStaat> = {};
        for (const [k, v] of Object.entries(oud)) {
          nieuw[k] = k.startsWith(`${vanMap}\n`)
            ? { ...v, totaal: Math.max(0, v.totaal - 1), berichten: v.berichten.filter((e) => e.uid !== u) }
            : v;
        }
        return nieuw;
      });
      if (verwijderd && !verwijderd.gelezen) pasOngelezenAan(vanMap, -1);
      if (uid === u) {
        setUid(smal ? null : volgende);
        if (smal) setPaneel('lijst');
      }
      try {
        const res = await mailApi.verplaats(vanMap, u, { naar });
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
                      await mailApi.verplaats(res.naar, terug, { naarMap: vanMap });
                      await laadLijst(vanMap, zoek, 1);
                      laadMappen();
                    } catch (e) {
                      toast(e instanceof MailApiFout ? e.message : 'Terugzetten lukte niet.', { fout: true });
                    }
                  }
                }
              }
            : undefined
        );
        laadMappen();
      } catch (e) {
        toast(e instanceof MailApiFout ? e.message : 'Verplaatsen lukte niet.', { fout: true });
        laadLijst(vanMap, zoek, 1);
        laadMappen();
      }
    },
    [map, lijst, volgendeNa, pasOngelezenAan, uid, smal, toast, laadLijst, laadMappen, zoek]
  );

  const maakTaak = useCallback(
    async (b: Bericht) => {
      const van = b.van ? adresVol(b.van) : '(onbekend)';
      const link = `/mail?${new URLSearchParams({ map: b.map, uid: String(b.uid) })}`;
      try {
        const res = await fetch('/api/taken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titel: `Reageren: ${b.onderwerp || '(geen onderwerp)'}`.slice(0, 300),
            notitie: `Mail van ${van}\n${link}`,
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
    [toast]
  );

  // ---------- acties ----------

  const kies = useCallback((u: number) => {
    setUid(u);
    setPaneel('lezer');
    setOpstel(null);
  }, []);

  const wisselMap = useCallback((pad: string) => {
    setMap(pad);
    setUid(null);
    setZoek('');
    setZoekInvoer('');
    setMappenOpen(false);
    setPaneel('lijst');
    setOpstel(null);
  }, []);

  const opstellen = useCallback((modus: OpstelModus, basis: Bericht | null = null) => {
    setOpstel({ modus, basis, sleutel: Date.now() });
    setPaneel('lezer');
  }, []);

  const actie = useCallback(
    (a: LezerActie) => {
      if (!bericht || uid == null) return;
      switch (a) {
        case 'antwoord':
        case 'allen':
        case 'doorsturen':
          opstellen(a, bericht);
          break;
        case 'archief':
        case 'prullenbak':
        case 'inbox':
          verplaats(uid, a);
          break;
        case 'ongelezen':
          handmatigOngelezen.current.add(berichtSleutel(map, uid));
          if (envelop?.gelezen !== false) zetGelezen(map, uid, false);
          break;
        case 'vlag':
          zetVlag(map, uid, !(envelop?.gemarkeerd ?? bericht.gemarkeerd));
          break;
        case 'taak':
          maakTaak(bericht);
          break;
      }
    },
    [bericht, uid, map, envelop, opstellen, verplaats, zetGelezen, zetVlag, maakTaak]
  );

  // ---------- sneltoetsen ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typtIn(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const l = lijst?.berichten ?? [];
      const i = uid == null ? -1 : l.findIndex((b) => b.uid === uid);
      const stap = (d: number) => {
        const doel = l[Math.min(l.length - 1, Math.max(0, i + d))] ?? l[0];
        if (doel) {
          setUid(doel.uid);
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
          if (uid != null && !opstel) {
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
  }, [lijst, uid, opstel, smal, paneel, mappenOpen, bericht, rol, actie, opstellen]);

  // ---------- weergave ----------

  const mappenKnop = middel ? (
    <div className="ml-mapkeuze">
      <button
        type="button"
        className="ml-mapkeuze-knop"
        aria-expanded={mappenOpen}
        aria-haspopup="true"
        onClick={() => setMappenOpen((o) => !o)}
      >
        <span>{mapNaam}</span>
        {huidigeMap && huidigeMap.ongelezen > 0 && rol !== 'verzonden' && <span className="ml-map-aantal">{huidigeMap.ongelezen}</span>}
        <Icoon naam="pijlOmlaag" grootte={14} />
      </button>
      {mappenOpen && (
        <>
          <div className="ml-pop-achter" onClick={() => setMappenOpen(false)} aria-hidden="true" />
          <div className="ml-pop">
            <Mappen mappen={mappen} fout={mappenFout} actief={map} onKies={wisselMap} onOpnieuw={laadMappen} />
          </div>
        </>
      )}
    </div>
  ) : null;

  const lezerSleutel = useMemo(() => (uid != null ? berichtSleutel(map, uid) : 'leeg'), [map, uid]);

  const klasse = ['ml', smal ? `ml-mobiel-${paneel}` : '', middel ? 'ml-middel' : ''].filter(Boolean).join(' ');

  return (
    <div className="ml-app">
      <ModuleKop label={account} titel="Mail">
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
            <Mappen mappen={mappen} fout={mappenFout} actief={map} onKies={wisselMap} onOpnieuw={laadMappen} />
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
          geselecteerd={uid}
          laden={lijstLaden}
          fout={lijstFout?.sleutel === sleutelVan(map, zoek) ? lijstFout.fout : null}
          meer={Boolean(lijst?.meer)}
          meerLaden={meerLaden}
          zoekInvoer={zoekInvoer}
          zoek={zoek}
          zoekRef={zoekRef}
          mappenKnop={mappenKnop}
          onZoekInvoer={setZoekInvoer}
          onZoek={(z) => {
            setZoek(z);
            setUid(null);
          }}
          onKies={kies}
          onMeer={() => laadLijst(map, zoek, (lijst?.pagina ?? 1) + 1)}
          onOpnieuw={() => laadLijst(map, zoek, 1)}
          onVlag={(e) => zetVlag(map, e.uid, !e.gemarkeerd)}
        />

        {opstel ? (
          <Opsteller
            key={opstel.sleutel}
            modus={opstel.modus}
            basis={opstel.basis}
            account={account}
            handtekening={handtekening}
            startAan={opstel.aan}
            adressen={adressen}
            onSluit={() => {
              setOpstel(null);
              if (smal && uid == null) setPaneel('lijst');
            }}
            onVerzonden={(antwoordOp) => {
              setOpstel(null);
              if (antwoordOp) pasEnvelopAan(antwoordOp.map, antwoordOp.uid, (e) => ({ ...e, beantwoord: true }));
              if (smal && uid == null) setPaneel('lijst');
              // Verzonden-map (en tellers) bijwerken.
              laadMappen();
              if (rol === 'verzonden') laadLijst(map, zoek, 1);
            }}
          />
        ) : (
          <Lezer
            key={lezerSleutel}
            bericht={bericht}
            rol={rol}
            laden={uid != null && (berichtLaden || !bericht)}
            fout={uid != null && berichtFout?.sleutel === berichtSleutel(map, uid) ? berichtFout.fout : null}
            gemarkeerd={envelop?.gemarkeerd ?? bericht?.gemarkeerd ?? false}
            smal={smal}
            onActie={actie}
            onTerug={() => {
              setPaneel('lijst');
              setUid(null);
            }}
            onOpnieuw={() => uid != null && laadBericht(map, uid)}
          />
        )}
      </div>
    </div>
  );
}
