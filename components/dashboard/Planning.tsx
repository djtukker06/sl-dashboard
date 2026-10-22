'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { agendaApi, useNu } from '@/lib/agenda/client';
import { DAGNAMEN_KORT, dagDelen, dagTekst, inAmsterdam, korteDag, plusDagen, weekdagIndex, type Dag } from '@/lib/agenda/datum';
import { afspraakRaakt, blokkenOpDag, indelen, isBalk, tijdvak } from '@/lib/agenda/weergave';
import type { Afspraak, Taak } from '@/lib/agenda/types';
import { Afvinker, TaakRij, Toegewezenen } from '@/components/agenda/TaakRij';
import { useAfvinken } from '@/components/agenda/useAfvinken';
import { useTaakDialoog, useTaakGebeurtenis } from '@/components/taken/TakenProvider';
import { Kaart, KaartMelding } from './Kaart';

export type PlanningData = { taken: Taak[]; afspraken: Afspraak[]; teLaat: Taak[]; uitgedeeld: Taak[] };

const VERVERS_MS = 2 * 60_000;

/**
 * Jouw planning op het dashboard: Vandaag, Deze week, Taken en "Uitgedeeld door jou".
 * Alleen taken voor jou en afspraken waar jij bij hoort. Krijgt de eerste gegevens van de
 * server (PlanningWidgets) en houdt ze daarna zelf bij; ververst bij terugkomen en elke
 * 2 minuten (zo verschijnt werk van je compagnon vanzelf). Vereist <DashboardTaken> erboven.
 */
export function Planning({
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
  const { nieuw, open } = useTaakDialoog();
  const router = useRouter();
  const laatst = useRef(0);

  const ververs = useCallback(async () => {
    setBezig(true);
    laatst.current = Date.now();
    try {
      const [bereik, laat, uit] = await Promise.all([
        agendaApi.bereik(vandaag, plusDagen(vandaag, 6), 'ik'),
        agendaApi.taken('telaat', { wie: 'ik' }),
        agendaApi.uitgedeeld()
      ]);
      setData({ taken: bereik.tasks, afspraken: bereik.events, teLaat: laat.tasks, uitgedeeld: uit.tasks });
      setFout(null);
    } catch (e) {
      setFout(e && typeof e === 'object' && 'nietIngericht' in e && (e as { nietIngericht: boolean }).nietIngericht ? 'niet-ingericht' : 'fout');
    } finally {
      setBezig(false);
    }
  }, [vandaag]);

  // Verversen als je terugkomt (tabblad of venster) en elke 2 minuten zolang het zichtbaar
  // is; router.refresh() ververst ook de gedeelde widgets (facturen, bonnetjes, posts).
  useEffect(() => {
    const opnieuw = (forceer = false) => {
      if (document.visibilityState !== 'visible') return;
      if (!forceer && Date.now() - laatst.current < 30_000) return;
      void ververs();
      router.refresh();
    };
    const zicht = () => opnieuw();
    const focus = () => opnieuw();
    const timer = setInterval(() => opnieuw(true), VERVERS_MS);
    document.addEventListener('visibilitychange', zicht);
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', zicht);
      window.removeEventListener('focus', focus);
    };
  }, [ververs, router]);

  // Taak toegevoegd/gewijzigd/verwijderd in de popup: opnieuw ophalen.
  useTaakGebeurtenis(() => void ververs());

  const pasAan = useCallback((t: Taak) => {
    setData((d) =>
      d
        ? {
            ...d,
            taken: d.taken.map((x) => (x.id === t.id ? { ...x, ...t } : x)),
            teLaat: d.teLaat.map((x) => (x.id === t.id ? { ...x, ...t } : x)),
            uitgedeeld: d.uitgedeeld.map((x) => (x.id === t.id ? { ...x, ...t } : x))
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

  const d = data ?? { taken: [], afspraken: [], teLaat: [], uitgedeeld: [] };
  const opUitgedeeld = d.uitgedeeld.length > 0;
  return (
    <>
      <VandaagKaart vandaag={vandaag} nu={nu} data={d} onToggle={toggle} onNieuw={() => nieuw()} onOpen={open} />
      <div className="db-smal db-stapel">
        <Kaart label="Deze week" href={`/agenda?dag=${vandaag}`} linkTekst="Agenda" className="db-week-kaart">
          <WeekStrip vandaag={vandaag} taken={d.taken} afspraken={d.afspraken} />
          <Eerstvolgende vandaag={vandaag} nu={nu} afspraken={d.afspraken} />
        </Kaart>
        {opUitgedeeld && <UitgedeeldKaart vandaag={vandaag} taken={d.uitgedeeld} onOpen={open} />}
      </div>
      <TakenKaart vandaag={vandaag} nu={nu} data={d} onToggle={toggle} onNieuw={() => nieuw()} onOpen={open} />
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
  onNieuw,
  onOpen
}: {
  vandaag: Dag;
  nu: number | null;
  data: PlanningData;
  onToggle: (t: Taak) => void;
  onNieuw: () => void;
  onOpen: (id: string) => void;
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
            <button type="button" className="db-knop" onClick={onNieuw}>
              + Taak
            </button>
          }
        >
          Geen afspraken en geen taken voor jou vandaag. Voeg een taak toe met <kbd>n</kbd>.
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
                  const tekst = (
                    <>
                      <span className="ag-blok-titel">{b.item.titel}</span>
                      <span className="ag-blok-tijd">
                        {b.soort === 'afspraak' ? tijdvak(b.item) : b.item.tijd}
                        {b.soort === 'afspraak' && b.item.locatie ? ` · ${b.item.locatie}` : ''}
                        {b.item.klantNaam ? ` · ${b.item.klantNaam}` : ''}
                      </span>
                    </>
                  );
                  return (
                    <div
                      key={`${b.soort}:${b.id}`}
                      className={`ag-blok ag-blok-${b.soort}${b.soort === 'taak' && b.item.afgerond ? ' is-af' : ''}${voorbij ? ' is-voorbij' : ''}${hoogte < 38 ? ' is-kort' : ''}`}
                      style={stijl}
                    >
                      {b.soort === 'taak' && <Afvinker taak={b.item} onToggle={onToggle} klein />}
                      {b.soort === 'taak' ? (
                        <button type="button" className="ag-blok-tekst" onClick={() => onOpen(b.id)}>
                          {tekst}
                        </button>
                      ) : (
                        <Link className="ag-blok-tekst" href={`/agenda?dag=${vandaag}&afspraak=${b.id}`}>
                          {tekst}
                        </Link>
                      )}
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
                  <TaakRij key={t.id} taak={t} vandaag={vandaag} onToggle={onToggle} onOpen={(x) => onOpen(x.id)} toonDatum={false} />
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
  onNieuw,
  onOpen
}: {
  vandaag: Dag;
  nu: number | null;
  data: PlanningData;
  onToggle: (t: Taak) => void;
  onNieuw: () => void;
  onOpen: (id: string) => void;
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
            <button type="button" className="db-knop" onClick={onNieuw}>
              + Taak
            </button>
          }
        >
          Niets achterstallig en niets voor jou gepland in de komende dagen.
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
                <TaakRij key={t.id} taak={t} vandaag={vandaag} onToggle={onToggle} onOpen={(x) => onOpen(x.id)} toonDatum={g.datum} />
              ))}
            </ul>
          </section>
        ))
      )}
    </Kaart>
  );
}

// ---------- Uitgedeeld door jou ----------

function UitgedeeldKaart({ vandaag, taken, onOpen }: { vandaag: Dag; taken: Taak[]; onOpen: (id: string) => void }) {
  const zichtbaar = taken.filter((t) => !t.afgerond).slice(0, 5);
  if (!zichtbaar.length) return null;
  return (
    <Kaart label={`Uitgedeeld door jou · ${taken.filter((t) => !t.afgerond).length}`} href="/agenda?wie=team" linkTekst="Team" className="db-uitgedeeld">
      <ul className="db-lijst">
        {zichtbaar.map((t) => {
          const laat = !!t.datum && t.datum < vandaag;
          return (
            <li key={t.id}>
              <button type="button" className="db-rij db-rij-knop" onClick={() => onOpen(t.id)}>
                <Toegewezenen ids={t.toegewezen} max={2} />
                <span className="db-rij-hoofd">
                  <span className="db-rij-titel">{t.titel}</span>
                  <span className={`db-rij-meta${laat ? ' is-gevaar' : ''}`}>
                    {t.datum ? dagTekst(t.datum, vandaag) : 'Geen deadline'}
                    {t.subtaken.totaal > 0 ? ` · ${t.subtaken.klaar}/${t.subtaken.totaal}` : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Kaart>
  );
}

/** Net afgevinkt (blijft even zichtbaar, doorgestreept). Op de server (nu = null): nee. */
function isRecent(t: Taak, nu: number | null): boolean {
  return nu !== null && !!t.afgerondOp && nu - Date.parse(t.afgerondOp) < 10 * 60_000;
}
