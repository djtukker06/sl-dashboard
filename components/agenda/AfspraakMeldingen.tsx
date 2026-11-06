'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/agenda/client';
import { inAmsterdam } from '@/lib/agenda/datum';
import { ontgrendelGeluid, speelGeluid, teMelden, useMeldingen, type KomendeAfspraak, type Melding } from '@/lib/agenda/meldingen';
import { volgendeControle } from '@/lib/agenda/meldingen-kern';
import { korteLocatie, vergaderlinkVan } from '@/lib/agenda/vergaderlink';
import { perGebruiker } from '@/lib/mail/client';

// Meldingen vóór een afspraak: 10 minuten en 1 minuut vooraf een browsermelding met een eigen
// geluid (lib/agenda/meldingen.ts). Staat in de shell (app/(app)/layout.tsx), dus het werkt op
// elke pagina van het dashboard zolang er één tabblad open is (ook op de achtergrond). Klik op
// de melding: deelnemen (bij een Teams/Meet/Zoom-link) of de afspraak openen.
//
// Elke 5 minuten (en bij terugkomen in het tabblad of na een wijziging in de agenda) halen we
// de afspraken van de komende 26 uur op. Met meerdere tabbladen open gaat een melding maar één
// keer af: een Web Lock per melding plus een lijstje "al gemeld" in localStorage.

const VERVERS_MS = 5 * 60_000;
const GEHAD = 'sl-meldingen-gehad';
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

function toon(m: Melding, naar: (pad: string) => void) {
  const a = m.afspraak;
  const link = vergaderlinkVan(a);
  const tijd = `${inAmsterdam(a.start).tijd}–${inAmsterdam(a.eind).tijd}`;
  const waar = link ? `${link.dienst}: klik om deel te nemen` : a.locatie ? korteLocatie(a.locatie) : '';
  try {
    const n = new Notification(m.minuten === 10 ? `Over 10 minuten: ${a.titel}` : `Over 1 minuut: ${a.titel}`, {
      body: [tijd, waar].filter(Boolean).join(' · '),
      tag: m.sleutel,
      icon: '/brand/app/apple-touch-icon.png',
      // De 1-minuutmelding blijft staan tot je hem wegklikt.
      requireInteraction: m.minuten === 1,
      // Ons eigen geluid in plaats van dat van het systeem.
      silent: true
    });
    n.onclick = () => {
      window.focus();
      if (link) window.open(link.url, '_blank', 'noopener');
      else naar(`/agenda?dag=${inAmsterdam(a.start).dag}&afspraak=${encodeURIComponent(a.id)}`);
      n.close();
    };
  } catch {
    /* melding mislukt (bv. toestemming net ingetrokken) */
  }
  speelGeluid(m.minuten);
}

/** Eén keer melden, ook met meerdere tabbladen open. */
async function meldEenKeer(m: Melding, naar: (pad: string) => void) {
  const doe = () => {
    const gehad = leesGehad();
    if (gehad.has(m.sleutel)) return;
    gehad.set(m.sleutel, Date.now());
    bewaarGehad(gehad);
    toon(m, naar);
  };
  if (navigator.locks) await navigator.locks.request(`sl-melding:${m.sleutel}`, { ifAvailable: true }, (lock) => (lock ? doe() : undefined));
  else doe();
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

    const kijk = () => {
      clearTimeout(controle);
      if (weg) return;
      const gehad = new Set(leesGehad().keys());
      for (const m of teMelden(afspraken.current, Date.now(), gehad)) void meldEenKeer(m, router.push);
      controle = setTimeout(kijk, volgendeControle(afspraken.current, Date.now()));
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
