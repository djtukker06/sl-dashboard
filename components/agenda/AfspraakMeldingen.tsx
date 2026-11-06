'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/agenda/client';
import { inAmsterdam } from '@/lib/agenda/datum';
import { herinneringenUit, ontgrendelGeluid, speelGeluid, teMelden, useMeldingen, type KomendeAfspraak, type Melding } from '@/lib/agenda/meldingen';
import { volgendeControle } from '@/lib/agenda/meldingen-kern';
import { korteLocatie, vergaderlinkVan, type Vergaderlink } from '@/lib/agenda/vergaderlink';
import { perGebruiker } from '@/lib/mail/client';

// Herinneringen vóór een afspraak: 10 minuten en 1 minuut vooraf (lib/agenda/meldingen.ts).
// Staat in de shell (app/(app)/layout.tsx), dus het werkt op elke pagina van het dashboard
// zolang er één tabblad open is (ook op de achtergrond). Drie lagen, zoals Google Agenda:
//   - een banner rechtsboven in ELK open tabblad van het dashboard, met aftellen, "Deelnemen"
//     (Teams/Meet/Zoom-link) en "Bekijken"; blijft tot je hem wegklikt of 5 min na het begin;
//   - een systeemmelding (de banner van macOS/Windows) als je níet naar het dashboard kijkt;
//   - het tabblad knippert met de melding in de titel zolang het op de achtergrond staat.
// Het geluid en de systeemmelding gaan maar één keer af, ook met meerdere tabbladen: een Web
// Lock per melding (het tabblad waar je naar kijkt gaat voor) en een lijstje "al gemeld" in
// localStorage. De banner gaat via een BroadcastChannel naar de andere tabbladen.
//
// De afspraken (komende 26 uur) halen we elke 5 minuten op, en bij terugkomen in het tabblad
// of na een wijziging in de agenda.

const VERVERS_MS = 5 * 60_000;
const GEHAD = 'sl-meldingen-gehad';
/** Banner weg zoveel na het begin van de afspraak. */
const BANNER_TOT_MS = 5 * 60_000;
/** De agenda laat met dit event weten dat er iets veranderde (AgendaApp). */
export const AFSPRAKEN_GEWIJZIGD = 'sl-afspraken-gewijzigd';

interface Banner {
  /** Per afspraak (id + begin): de 1-minuutmelding vervangt die van 10 minuten. */
  sleutel: string;
  minuten: 10 | 1;
  afspraak: KomendeAfspraak;
}

type Bericht = { soort: 'toon'; banner: Banner } | { soort: 'weg'; sleutel: string };

function leesGehad(): Map<string, number> {
  try {
    const ruw = JSON.parse(localStorage.getItem(perGebruiker(GEHAD)) ?? '[]') as [string, number][];
    const grens = Date.now() - 2 * 86_400_000;
    return new Map(ruw.filter(([, t]) => t > grens));
  } catch {
    return new Map();
  }
}

function bewaarGehad(m: Map<string, number>) {
  try {
    localStorage.setItem(perGebruiker(GEHAD), JSON.stringify([...m].slice(-200)));
  } catch {
    /* geen opslag */
  }
}

const kijktErNaar = () => document.visibilityState === 'visible' && document.hasFocus();
const afspraakPad = (a: KomendeAfspraak) => `/agenda?dag=${inAmsterdam(a.start).dag}&afspraak=${encodeURIComponent(a.id)}`;

function tijdTekst(a: KomendeAfspraak) {
  return `${inAmsterdam(a.start).tijd}–${inAmsterdam(a.eind).tijd}`;
}

/** Systeemmelding (alleen als je niet naar het dashboard kijkt; anders is de banner er). */
function systeemMelding(m: Melding, naar: (pad: string) => void) {
  const a = m.afspraak;
  const link = vergaderlinkVan(a);
  const waar = link ? `${link.dienst}: klik om deel te nemen` : a.locatie ? korteLocatie(a.locatie) : '';
  try {
    const n = new Notification(m.minuten === 10 ? `Over 10 minuten: ${a.titel}` : `Over 1 minuut: ${a.titel}`, {
      body: [tijdTekst(a), waar].filter(Boolean).join(' · '),
      tag: m.sleutel,
      icon: '/brand/app/apple-touch-icon.png',
      requireInteraction: m.minuten === 1,
      // Ons eigen geluid in plaats van dat van het systeem.
      silent: true
    });
    n.onclick = () => {
      window.focus();
      if (link) window.open(link.url, '_blank', 'noopener');
      else naar(afspraakPad(a));
      n.close();
    };
  } catch {
    /* geen systeemmelding (bv. toestemming net ingetrokken); de banner staat er wel */
  }
}

export function AfspraakMeldingen() {
  const { aan } = useMeldingen();
  const router = useRouter();
  const afspraken = useRef<KomendeAfspraak[]>([]);
  const kanaal = useRef<BroadcastChannel | null>(null);
  const [banners, setBanners] = useState<Banner[]>([]);

  const toonBanner = useCallback((b: Banner) => {
    setBanners((l) => [...l.filter((x) => x.sleutel !== b.sleutel), b].sort((x, y) => x.afspraak.start.localeCompare(y.afspraak.start)));
  }, []);
  const verberg = useCallback((sleutel: string, overal = true) => {
    setBanners((l) => l.filter((x) => x.sleutel !== sleutel));
    if (overal) kanaal.current?.postMessage({ soort: 'weg', sleutel } satisfies Bericht);
  }, []);

  // Banners van en naar de andere tabbladen (per gebruiker).
  useEffect(() => {
    if (!aan || typeof BroadcastChannel === 'undefined') return;
    const k = new BroadcastChannel(perGebruiker('sl-afspraak-meldingen'));
    k.onmessage = (e: MessageEvent<Bericht>) => {
      if (e.data?.soort === 'toon') toonBanner(e.data.banner);
      else if (e.data?.soort === 'weg') verberg(e.data.sleutel, false);
    };
    kanaal.current = k;
    return () => {
      k.close();
      kanaal.current = null;
    };
  }, [aan, toonBanner, verberg]);

  // Geluid mag pas na een klik of toets op de pagina: bij de eerste alvast "ontgrendelen".
  useEffect(() => {
    if (!aan) return;
    const ontgrendel = () => ontgrendelGeluid();
    window.addEventListener('pointerdown', ontgrendel, { once: true });
    window.addEventListener('keydown', ontgrendel, { once: true });
    return () => {
      window.removeEventListener('pointerdown', ontgrendel);
      window.removeEventListener('keydown', ontgrendel);
    };
  }, [aan]);

  useEffect(() => {
    if (!aan) return;
    let weg = false;
    let controle: ReturnType<typeof setTimeout> | undefined;

    /** Eén keer melden over alle tabbladen; het tabblad waar je naar kijkt gaat voor. */
    const meld = async (m: Melding) => {
      if (!kijktErNaar()) await new Promise((r) => setTimeout(r, 1500));
      const doe = () => {
        const gehad = leesGehad();
        if (gehad.has(m.sleutel)) return;
        gehad.set(m.sleutel, Date.now());
        bewaarGehad(gehad);
        const banner: Banner = { sleutel: `${m.afspraak.id}|${m.afspraak.start}`, minuten: m.minuten, afspraak: m.afspraak };
        toonBanner(banner);
        kanaal.current?.postMessage({ soort: 'toon', banner } satisfies Bericht);
        speelGeluid(m.minuten);
        if (!kijktErNaar()) systeemMelding(m, router.push);
      };
      if (navigator.locks) await navigator.locks.request(`sl-melding:${m.sleutel}`, { ifAvailable: true }, (lock) => (lock ? doe() : undefined));
      else doe();
    };

    const kijk = () => {
      clearTimeout(controle);
      if (weg) return;
      const nu = Date.now();
      for (const m of teMelden(afspraken.current, nu, new Set(leesGehad().keys()), herinneringenUit())) void meld(m);
      // Banners van afspraken die al een tijdje bezig zijn: weg.
      setBanners((l) => (l.some((b) => Date.parse(b.afspraak.start) + BANNER_TOT_MS < nu) ? l.filter((b) => Date.parse(b.afspraak.start) + BANNER_TOT_MS >= nu) : l));
      controle = setTimeout(kijk, volgendeControle(afspraken.current, nu));
    };
    const haal = async () => {
      try {
        const r = await api<{ afspraken: KomendeAfspraak[] }>('/api/agenda/komend');
        if (weg) return;
        afspraken.current = r.afspraken;
      } catch {
        /* volgende ronde opnieuw; de vorige lijst blijft gelden */
      }
      kijk();
    };

    void haal();
    const ververs = setInterval(() => void haal(), VERVERS_MS);
    const zichtbaar = () => {
      if (document.visibilityState === 'visible') void haal();
    };
    const gewijzigd = () => void haal();
    document.addEventListener('visibilitychange', zichtbaar);
    window.addEventListener(AFSPRAKEN_GEWIJZIGD, gewijzigd);
    return () => {
      weg = true;
      clearTimeout(controle);
      clearInterval(ververs);
      document.removeEventListener('visibilitychange', zichtbaar);
      window.removeEventListener(AFSPRAKEN_GEWIJZIGD, gewijzigd);
    };
  }, [aan, router, toonBanner]);

  // Tabblad op de achtergrond: de titel knippert met de eerstvolgende melding.
  const eerste = aan ? banners[0] : undefined;
  useEffect(() => {
    if (!eerste) return;
    let origineel: string | null = null;
    let t: ReturnType<typeof setInterval> | undefined;
    const melding = `🔔 ${eerste.minuten === 1 ? 'Over 1 min' : 'Over 10 min'}: ${eerste.afspraak.titel}`;
    const stop = () => {
      clearInterval(t);
      t = undefined;
      if (origineel !== null) document.title = origineel;
      origineel = null;
    };
    const start = () => {
      if (t || document.visibilityState === 'visible') return;
      origineel = document.title;
      let aanUit = false;
      t = setInterval(() => {
        aanUit = !aanUit;
        document.title = aanUit ? melding : (origineel ?? '');
      }, 1200);
    };
    const wissel = () => (document.visibilityState === 'visible' ? stop() : start());
    start();
    document.addEventListener('visibilitychange', wissel);
    return () => {
      document.removeEventListener('visibilitychange', wissel);
      stop();
    };
  }, [eerste]);

  if (!aan || !banners.length) return null;
  return (
    <div className="ag-meldingen" aria-live="assertive">
      {banners.map((b) => (
        <MeldingBanner
          key={b.sleutel}
          banner={b}
          onSluit={() => verberg(b.sleutel)}
          onBekijk={() => {
            verberg(b.sleutel);
            router.push(afspraakPad(b.afspraak));
          }}
        />
      ))}
    </div>
  );
}

/** "Begint over 9 min", "Begint over 45 s", "Begint nu", "Bezig sinds 2 min". */
function aftellen(start: number, nu: number): string {
  const s = Math.round((start - nu) / 1000);
  if (s > 90) return `Begint over ${Math.round(s / 60)} min`;
  if (s > 5) return `Begint over ${s} s`;
  if (s > -60) return 'Begint nu';
  return `Bezig sinds ${Math.round(-s / 60)} min`;
}

function MeldingBanner({ banner, onSluit, onBekijk }: { banner: Banner; onSluit: () => void; onBekijk: () => void }) {
  const a = banner.afspraak;
  const start = Date.parse(a.start);
  const [nu, setNu] = useState(() => Date.now());
  useEffect(() => {
    // Elke seconde in de laatste twee minuten, daarvoor elke 15 s.
    const t = setTimeout(() => setNu(Date.now()), start - Date.now() < 120_000 ? 1000 : 15_000);
    return () => clearTimeout(t);
  }, [start, nu]);
  const link: Vergaderlink | null = vergaderlinkVan(a);
  const waar = link ? link.dienst : a.locatie ? korteLocatie(a.locatie) : '';
  return (
    <div
      className={`ag-melding${banner.minuten === 1 ? ' is-dringend' : ''}`}
      role="alertdialog"
      aria-label={`Herinnering: ${a.titel}`}
      style={{ '--ag-kleur': a.google?.kleur ?? '#c8a97e' } as React.CSSProperties}
    >
      <span className="ag-melding-icoon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15l1.5-2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M10 20.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      <div className="ag-melding-tekst">
        <p className="ag-melding-wanneer">
          <span className="ag-melding-aftel">{aftellen(start, nu)}</span> · {tijdTekst(a)}
        </p>
        <p className="ag-melding-titel">{a.titel}</p>
        {waar && <p className="ag-melding-waar">{waar}</p>}
        <div className="ag-melding-acties">
          {link && (
            <a className="db-knop db-knop-primair" href={link.url} target="_blank" rel="noopener noreferrer" onClick={onSluit}>
              Deelnemen met {link.dienst}
            </a>
          )}
          <button type="button" className={link ? 'ag-link-knop' : 'db-knop'} onClick={onBekijk}>
            Bekijken
          </button>
        </div>
      </div>
      <button type="button" className="ag-icoonknop ag-melding-sluit" aria-label="Herinnering sluiten" title="Sluiten" onClick={onSluit}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
