'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/agenda/client';
import { inAmsterdam } from '@/lib/agenda/datum';
import { herinneringenUit, ontgrendelGeluid, speelGeluid, teMelden, useMeldingen, type KomendeAfspraak, type Melding } from '@/lib/agenda/meldingen';
import { volgendeControle } from '@/lib/agenda/meldingen-kern';
import { korteLocatie, vergaderlinkVan } from '@/lib/agenda/vergaderlink';
import { perGebruiker } from '@/lib/mail/client';

// Herinneringen vóór een afspraak: 10 minuten en 1 minuut vooraf (lib/agenda/meldingen.ts).
// Staat in de shell (app/(app)/layout.tsx), dus het werkt op elke pagina van het dashboard
// zolang er één tabblad open is (ook op de achtergrond).
//   - een systeemmelding: op de Mac de gewone macOS-banner (zoals Agenda), op Windows de
//     melding rechtsonder; de 1-minuutmelding blijft staan tot je hem wegklikt. Klik =
//     deelnemen (Teams/Meet/Zoom-link) of de afspraak openen;
//   - een eigen geluid (Normaal of Picobello vooraf, dringend bij 1 minuut);
//   - staat het tabblad op de achtergrond, dan knippert de titel even mee.
// Met meerdere tabbladen gaat elke melding maar één keer af: een Web Lock per melding en een
// lijstje "al gemeld" in localStorage.
//
// De afspraken (komende 26 uur) halen we elke 5 minuten op, en bij terugkomen in het tabblad
// of na een wijziging in de agenda.

const VERVERS_MS = 5 * 60_000;
const GEHAD = 'sl-meldingen-gehad';
/** Hoe lang de tabtitel hooguit knippert. */
const KNIPPER_MS = 3 * 60_000;
/** De agenda laat met dit event weten dat er iets veranderde (AgendaApp). */
export const AFSPRAKEN_GEWIJZIGD = 'sl-afspraken-gewijzigd';

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

const afspraakPad = (a: KomendeAfspraak) => `/agenda?dag=${inAmsterdam(a.start).dag}&afspraak=${encodeURIComponent(a.id)}`;

/** De systeemmelding (macOS-banner). */
function systeemMelding(m: Melding, naar: (pad: string) => void) {
  const a = m.afspraak;
  const link = vergaderlinkVan(a);
  const tijd = `${inAmsterdam(a.start).tijd}–${inAmsterdam(a.eind).tijd}`;
  const waar = link ? `${link.dienst}: klik om deel te nemen` : a.locatie ? korteLocatie(a.locatie) : '';
  try {
    const n = new Notification(m.minuten === 10 ? `Over 10 minuten: ${a.titel}` : `Over 1 minuut: ${a.titel}`, {
      body: [tijd, waar].filter(Boolean).join(' · '),
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
    /* geen melding (bv. toestemming net ingetrokken) */
  }
}

/** Tabblad op de achtergrond: de titel wisselt even met de melding, tot je terugkomt. */
function knipperTitel(tekst: string) {
  if (document.visibilityState === 'visible') return;
  const origineel = document.title;
  let aan = false;
  const t = setInterval(() => {
    aan = !aan;
    document.title = aan ? tekst : origineel;
  }, 1200);
  const stop = () => {
    clearInterval(t);
    clearTimeout(einde);
    document.title = origineel;
    document.removeEventListener('visibilitychange', stop);
  };
  const einde = setTimeout(stop, KNIPPER_MS);
  document.addEventListener('visibilitychange', stop);
}

export function AfspraakMeldingen() {
  const { aan } = useMeldingen();
  const router = useRouter();
  const afspraken = useRef<KomendeAfspraak[]>([]);

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

    /** Eén keer melden over alle tabbladen. */
    const meld = async (m: Melding) => {
      const doe = () => {
        const gehad = leesGehad();
        if (gehad.has(m.sleutel)) return;
        gehad.set(m.sleutel, Date.now());
        bewaarGehad(gehad);
        systeemMelding(m, router.push);
        speelGeluid(m.minuten);
        knipperTitel(`🔔 ${m.minuten === 1 ? 'Over 1 min' : 'Over 10 min'}: ${m.afspraak.titel}`);
      };
      if (navigator.locks) await navigator.locks.request(`sl-melding:${m.sleutel}`, { ifAvailable: true }, (lock) => (lock ? doe() : undefined));
      else doe();
    };

    const kijk = () => {
      clearTimeout(controle);
      if (weg) return;
      const nu = Date.now();
      for (const m of teMelden(afspraken.current, nu, new Set(leesGehad().keys()), herinneringenUit())) void meld(m);
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
  }, [aan, router]);

  return null;
}
