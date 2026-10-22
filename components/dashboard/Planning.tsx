'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { agendaApi, typtIn, useNu } from '@/lib/agenda/client';
import { DAGNAMEN_KORT, dagDelen, inAmsterdam, korteDag, plusDagen, weekdagIndex, type Dag } from '@/lib/agenda/datum';
import { afspraakRaakt, blokkenOpDag, indelen, isBalk, tijdvak } from '@/lib/agenda/weergave';
import type { Afspraak, Taak } from '@/lib/agenda/types';
import { SnelInvoer } from '@/components/agenda/SnelInvoer';
import { Afvinker, TaakRij } from '@/components/agenda/TaakRij';
import { ToastProvider } from '@/components/agenda/Toast';
import { useAfvinken } from '@/components/agenda/useAfvinken';
import { Kaart, KaartMelding } from './Kaart';

export type PlanningData = { taken: Taak[]; afspraken: Afspraak[]; teLaat: Taak[] };

/**
 * Planning op het dashboard: snelinvoer + widgets Vandaag, Deze week en Taken.
 * Krijgt de eerste gegevens van de server (PlanningWidgets) en houdt ze daarna zelf bij,
 * zodat afvinken en toevoegen direct zichtbaar zijn.
 */
export function Planning(props: { vandaag: Dag; data: PlanningData | null; fout: 'niet-ingericht' | 'fout' | null }) {
  return (
    <ToastProvider>
      <PlanningInhoud {...props} />
    </ToastProvider>
  );
}

function PlanningInhoud({
  vandaag: vandaagServer,
  data: start,
  fout: startFout
}: {
  vandaag: Dag;
  data: PlanningData | null;
  fout: 'niet-ingericht' | 'fout' | null;
}) {
  const nu = useNu();
  const vandaag = nu ? inAmsterdam(nu).dag : vandaagServer;
  const [data, setData] = useState<PlanningData | null>(start);
  const [fout, setFout] = useState(startFout);
  const [bezig, setBezig] = useState(false);
  const snelRef = useRef<HTMLInputElement>(null);

  const ververs = useCallback(async () => {
    setBezig(true);
    try {
      const [bereik, laat] = await Promise.all([agendaApi.bereik(vandaag, plusDagen(vandaag, 6)), agendaApi.taken('telaat')]);
      setData({ taken: bereik.tasks, afspraken: bereik.events, teLaat: laat.tasks });
      setFout(null);
    } catch (e) {
      setFout(e && typeof e === 'object' && 'nietIngericht' in e && (e as { nietIngericht: boolean }).nietIngericht ? 'niet-ingericht' : 'fout');
    } finally {
      setBezig(false);
    }
  }, [vandaag]);

  // Verversen als je terugkomt naar het tabblad (bv. na werken in de agenda).
  useEffect(() => {
    const opZicht = () => {
      if (document.visibilityState === 'visible') void ververs();
    };
    document.addEventListener('visibilitychange', opZicht);
    return () => document.removeEventListener('visibilitychange', opZicht);
  }, [ververs]);

  // n = nieuwe taak (focus op de snelinvoer).
  useEffect(() => {
    function toets(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || typtIn(e.target)) return;
      if (!snelRef.current) return;
      e.preventDefault();
      snelRef.current.focus();
    }
    document.addEventListener('keydown', toets);
    return () => document.removeEventListener('keydown', toets);
  }, []);

  const pasAan = useCallback((t: Taak) => {
    setData((d) =>
      d
        ? {
            ...d,
            taken: d.taken.map((x) => (x.id === t.id ? { ...x, ...t } : x)),
            teLaat: d.teLaat.map((x) => (x.id === t.id ? { ...x, ...t } : x))
          }
        : d
    );
  }, []);
  const toggle = useAfvinken(pasAan);

  if (fout === 'niet-ingericht' || (fout === 'fout' && !data)) {
    const setup = fout === 'niet-ingericht';
    const melding = (
      <KaartMelding
        toon={setup ? 'setup' : 'fout'}
        titel={setup ? 'Agenda nog niet ingericht' : 'Agenda nu niet bereikbaar'}
        actie={
          <button type="button" className="db-knop" disabled={bezig} onClick={() => void ververs()}>
            {bezig ? 'Bezig…' : 'Opnieuw'}
          </button>
        }
      >
        {setup
          ? 'Voer in de Supabase SQL Editor migratie 0018_agenda_taken.sql (of UITVOEREN_IN_SQL_EDITOR.sql) uit; daarna verschijnen hier je afspraken en taken.'
          : 'Je afspraken en taken konden niet worden opgehaald. Probeer het zo opnieuw.'}
      </KaartMelding>
    );
    return (
      <>
        <Kaart label="Vandaag" href="/agenda" linkTekst="Agenda" className="db-breed">
          {melding}
        </Kaart>
        <Kaart label="Deze week" href="/agenda" linkTekst="Week" className="db-smal">
          <WeekStrip vandaag={vandaag} taken={[]} afspraken={[]} />
        </Kaart>
      </>
    );
  }

  const d = data ?? { taken: [], afspraken: [], teLaat: [] };
  return (
    <>
      <section className="db-snel" aria-label="Snel toevoegen">
        <SnelInvoer ref={snelRef} id="snelinvoer" vandaag={vandaag} onKlaar={() => void ververs()} onNietIngericht={() => setFout('niet-ingericht')} />
      </section>
      <VandaagKaart vandaag={vandaag} nu={nu} data={d} onToggle={toggle} snelRef={snelRef} />
      <Kaart label="Deze week" href={`/agenda?dag=${vandaag}`} linkTekst="Agenda" className="db-smal">
        <WeekStrip vandaag={vandaag} taken={d.taken} afspraken={d.afspraken} />
        <Eerstvolgende vandaag={vandaag} nu={nu} afspraken={d.afspraken} />
      </Kaart>
      <TakenKaart vandaag={vandaag} nu={nu} data={d} onToggle={toggle} snelRef={snelRef} />
    </>
  );
}

// ---------- Vandaag: tijdlijn ----------

const UUR_PX = 34;

function VandaagKaart({
  vandaag,
  nu,
  data,
  onToggle,
  snelRef
}: {
  vandaag: Dag;
  nu: number | null;
  data: PlanningData;
  onToggle: (t: Taak) => void;
  snelRef: React.RefObject<HTMLInputElement | null>;
}) {
  const blokken = blokkenOpDag(vandaag, data.taken, data.afspraken);
  const lanes = indelen(blokken);
  const balken = data.afspraken.filter((a) => isBalk(a) && afspraakRaakt(a, vandaag));
  const losse = data.taken.filter((t) => t.datum === vandaag && !t.tijd);
  const leeg = !blokken.length && !balken.length && !losse.length;

  // Venster 07–20 uur, uitgerekt als er eerder of later iets staat.
  const vanUur = Math.min(7, ...blokken.map((b) => Math.floor(b.start / 60)));
  const totUur = Math.max(20, ...blokken.map((b) => Math.ceil(b.eind / 60)));
  const uren = totUur - vanUur;
  const nuMin = nu ? inAmsterdam(nu).minuten : null;

  return (
    <Kaart label="Vandaag" href={`/agenda?dag=${vandaag}`} linkTekst="Agenda" className="db-breed db-vandaag">
      {leeg ? (
        <KaartMelding
          titel="Nog niets gepland voor vandaag"
          actie={
            <button type="button" className="db-knop" onClick={() => snelRef.current?.focus()}>
              + Taak
            </button>
          }
        >
          Typ hierboven wat er moet gebeuren — bijvoorbeeld ‘Klant bellen 15:00’.
        </KaartMelding>
      ) : (
        <>
          {blokken.length > 0 && (
            <div className="db-tijdlijn" style={{ height: uren * UUR_PX }}>
              <div className="db-tijdlijn-uren" aria-hidden="true">
                {Array.from({ length: uren + 1 }, (_, i) => (
                  <span key={i} style={{ top: i * UUR_PX }}>
                    {String(vanUur + i).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
              <div className="db-tijdlijn-baan">
                {blokken.map((b) => {
                  const lane = lanes.get(`${b.soort}:${b.id}`) ?? { kolom: 0, kolommen: 1 };
                  const top = ((b.start - vanUur * 60) / 60) * UUR_PX;
                  const hoogte = Math.max(((b.eind - b.start) / 60) * UUR_PX, 22);
                  const stijl: React.CSSProperties = {
                    top,
                    height: hoogte,
                    left: `calc(${(lane.kolom / lane.kolommen) * 100}% + 2px)`,
                    width: `calc(${100 / lane.kolommen}% - 4px)`
                  };
                  const voorbij = nuMin !== null && b.eind <= nuMin;
                  const href = b.soort === 'taak' ? `/agenda?taak=${b.id}` : `/agenda?dag=${vandaag}&afspraak=${b.id}`;
                  return (
                    <div
                      key={`${b.soort}:${b.id}`}
                      className={`ag-blok ag-blok-${b.soort}${b.soort === 'taak' && b.item.afgerond ? ' is-af' : ''}${voorbij ? ' is-voorbij' : ''}${hoogte < 38 ? ' is-kort' : ''}`}
                      style={stijl}
                    >
                      {b.soort === 'taak' && <Afvinker taak={b.item} onToggle={onToggle} klein />}
                      <Link className="ag-blok-tekst" href={href}>
                        <span className="ag-blok-titel">{b.item.titel}</span>
                        <span className="ag-blok-tijd">
                          {b.soort === 'afspraak' ? tijdvak(b.item) : b.item.tijd}
                          {b.soort === 'afspraak' && b.item.locatie ? ` · ${b.item.locatie}` : ''}
                          {b.item.klantNaam ? ` · ${b.item.klantNaam}` : ''}
                        </span>
                      </Link>
                    </div>
                  );
                })}
                {nuMin !== null && nuMin >= vanUur * 60 && nuMin <= totUur * 60 && (
                  <div className="ag-nu" style={{ top: ((nuMin - vanUur * 60) / 60) * UUR_PX }} aria-hidden="true" />
                )}
              </div>
            </div>
          )}
          {(balken.length > 0 || losse.length > 0) && (
            <div className="db-zonder-tijd">
              <p className="db-sub">Zonder tijd</p>
              <ul className="ag-taken">
                {balken.map((a) => (
                  <li key={a.id} className="ag-taak">
                    <span className="ag-balk-stip" aria-hidden="true" />
                    <Link className="ag-taak-hoofd" href={`/agenda?dag=${vandaag}&afspraak=${a.id}`}>
                      <span className="ag-taak-titel">{a.titel}</span>
                      <span className="ag-taak-meta">
                        <span>{tijdvak(a)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
                {losse.map((t) => (
                  <TaakRij key={t.id} taak={t} vandaag={vandaag} onToggle={onToggle} href={`/agenda?taak=${t.id}`} toonDatum={false} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Kaart>
  );
}

// ---------- Deze week ----------

function WeekStrip({ vandaag, taken, afspraken }: { vandaag: Dag; taken: Taak[]; afspraken: Afspraak[] }) {
  const dagen = Array.from({ length: 7 }, (_, i) => plusDagen(vandaag, i));
  return (
    <ol className="db-week">
      {dagen.map((d) => {
        const n =
          afspraken.filter((a) => afspraakRaakt(a, d)).length + taken.filter((t) => t.datum === d && !t.afgerond).length;
        return (
          <li key={d}>
            <Link
              className={`db-week-dag${d === vandaag ? ' is-vandaag' : ''}${weekdagIndex(d) >= 5 ? ' is-weekend' : ''}`}
              href={`/agenda?dag=${d}`}
              aria-label={`${korteDag(d)}: ${n} ${n === 1 ? 'item' : 'items'}`}
            >
              <span className="db-week-naam">{DAGNAMEN_KORT[weekdagIndex(d)]}</span>
              <span className="db-week-nr">{dagDelen(d).d}</span>
              <span className={`db-week-aantal${n ? '' : ' is-leeg'}`}>{n || '·'}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function Eerstvolgende({ vandaag, nu, afspraken }: { vandaag: Dag; nu: number | null; afspraken: Afspraak[] }) {
  const grens = nu ?? Date.parse(`${vandaag}T00:00:00Z`);
  const komend = afspraken
    .filter((a) => !a.heleDag && Date.parse(a.eind) > grens)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 3);
  if (!komend.length) return <p className="db-rustig">Geen afspraken meer deze week.</p>;
  return (
    <ul className="db-lijst">
      {komend.map((a) => {
        const s = inAmsterdam(a.start);
        return (
          <li key={a.id}>
            <Link className="db-rij" href={`/agenda?dag=${s.dag}&afspraak=${a.id}`}>
              <span className="db-rij-hoofd">
                <span className="db-rij-titel">{a.titel}</span>
                <span className="db-rij-meta">
                  {s.dag === vandaag ? 'Vandaag' : korteDag(s.dag)} · {tijdvak(a)}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Taken ----------

function TakenKaart({
  vandaag,
  nu,
  data,
  onToggle,
  snelRef
}: {
  vandaag: Dag;
  nu: number | null;
  data: PlanningData;
  onToggle: (t: Taak) => void;
  snelRef: React.RefObject<HTMLInputElement | null>;
}) {
  const recent = (t: Taak) => isRecent(t, nu);
  // Afgevinkte taken blijven zichtbaar (doorgestreept) tot de volgende keer laden,
  // zodat "ongedaan maken" niet met verspringende rijen gepaard gaat.
  const teLaat = data.teLaat;
  const vandaagTaken = data.taken.filter((t) => t.datum === vandaag && (!t.afgerond || recent(t)));
  const binnenkort = data.taken.filter((t) => t.datum && t.datum > vandaag && (!t.afgerond || recent(t))).slice(0, 5);
  const groepen = [
    { id: 'telaat', titel: 'Te laat', taken: teLaat, gevaar: true, datum: true },
    { id: 'vandaag', titel: 'Vandaag', taken: vandaagTaken, gevaar: false, datum: false },
    { id: 'binnenkort', titel: 'Binnenkort', taken: binnenkort, gevaar: false, datum: true }
  ].filter((g) => g.taken.length);
  const open = teLaat.filter((t) => !t.afgerond).length + vandaagTaken.filter((t) => !t.afgerond).length;

  return (
    <Kaart label={open ? `Taken · ${open} open` : 'Taken'} href="/agenda" linkTekst="Alle taken" className="db-breed">
      {groepen.length === 0 ? (
        <KaartMelding
          titel="Geen open taken"
          actie={
            <button type="button" className="db-knop" onClick={() => snelRef.current?.focus()}>
              + Taak
            </button>
          }
        >
          Niets achterstallig en niets gepland voor de komende dagen.
        </KaartMelding>
      ) : (
        groepen.map((g) => (
          <section key={g.id} className="ag-groep">
            <h3 className={`ag-groep-kop${g.gevaar ? ' is-gevaar' : ''}`}>
              <span>{g.titel}</span>
              <span className="ag-groep-aantal">{g.taken.filter((t) => !t.afgerond).length}</span>
            </h3>
            <ul className="ag-taken">
              {g.taken.map((t) => (
                <TaakRij key={t.id} taak={t} vandaag={vandaag} onToggle={onToggle} href={`/agenda?taak=${t.id}`} toonDatum={g.datum} />
              ))}
            </ul>
          </section>
        ))
      )}
    </Kaart>
  );
}

/** Net afgevinkt (blijft even zichtbaar, doorgestreept). Op de server (nu = null): nee. */
function isRecent(t: Taak, nu: number | null): boolean {
  return nu !== null && !!t.afgerondOp && nu - Date.parse(t.afgerondOp) < 10 * 60_000;
}
