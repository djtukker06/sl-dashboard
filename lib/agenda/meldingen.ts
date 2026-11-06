'use client';

import { useSyncExternalStore } from 'react';
import { perGebruiker } from '@/lib/mail/client';
import { teMelden, type KomendeAfspraak, type Melding } from './meldingen-kern';

// Meldingen vóór een afspraak (10 en 1 minuut vooraf): de instelling (per gebruiker, in deze
// browser), de toestemming van de browser en de twee geluiden. Het plannen en tonen gebeurt in
// components/agenda/AfspraakMeldingen (in de shell, dus op elke pagina van het dashboard).

export { teMelden, type KomendeAfspraak, type Melding };

const SLEUTEL = 'sl-afspraak-meldingen';
const EVENT = 'sl-meldingen-instelling';

export type Toestemming = NotificationPermission | 'niet-ondersteund';

export function toestemming(): Toestemming {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'niet-ondersteund';
  return Notification.permission;
}

function leesAan(): boolean {
  try {
    return localStorage.getItem(perGebruiker(SLEUTEL)) === '1';
  } catch {
    return false;
  }
}

function abonneer(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Staan de meldingen aan (en mag de browser ze tonen)? Op de server: uit. */
export function useMeldingen(): { aan: boolean; toestemming: Toestemming } {
  const aan = useSyncExternalStore(abonneer, leesAan, () => false);
  const t = useSyncExternalStore(abonneer, toestemming, () => 'default' as Toestemming);
  return { aan: aan && t === 'granted', toestemming: t };
}

/**
 * Meldingen aan- of uitzetten. Aanzetten vraagt (bij een klik) eerst toestemming aan de
 * browser; zonder toestemming blijft het uit. Geeft de nieuwe toestemming terug.
 */
export async function zetMeldingen(aan: boolean): Promise<Toestemming> {
  let t = toestemming();
  if (aan && t === 'default') {
    try {
      t = await Notification.requestPermission();
    } catch {
      t = toestemming();
    }
  }
  try {
    if (aan && t === 'granted') localStorage.setItem(perGebruiker(SLEUTEL), '1');
    else localStorage.removeItem(perGebruiker(SLEUTEL));
  } catch {
    /* geen opslag */
  }
  if (aan) ontgrendelGeluid();
  window.dispatchEvent(new Event(EVENT));
  return t;
}

// ---------- geluid ----------
// Met de Web Audio API gemaakt (geen bestand): 10 minuten vooraf een rustig tweetonig
// klokje, 1 minuut vooraf een snel oplopend drieklankje, twee keer. Browsers laten pas
// geluid toe na een klik of toets op de pagina; daarom "ontgrendelen" we bij de eerste klik.

let ctx: AudioContext | null = null;

export function ontgrendelGeluid() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* geen geluid */
  }
}

function toon(c: AudioContext, freq: number, start: number, duur: number, volume: number, vorm: OscillatorType) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = vorm;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duur);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + duur + 0.05);
}

export function speelGeluid(soort: Melding['minuten']) {
  ontgrendelGeluid();
  const c = ctx;
  if (!c) return;
  const t = c.currentTime + 0.05;
  if (soort === 10) {
    // Klokje: E5 dan B5, lang uitklinkend (met een zachte boventoon).
    for (const [f, d] of [[659.25, 0], [987.77, 0.32]] as const) {
      toon(c, f, t + d, 1.4, 0.22, 'sine');
      toon(c, f * 2, t + d, 0.7, 0.05, 'sine');
    }
  } else {
    // Dringender: C6–E6–G6 kort en oplopend, twee keer.
    for (const herhaal of [0, 0.62]) {
      [1046.5, 1318.5, 1568].forEach((f, i) => toon(c, f, t + herhaal + i * 0.12, 0.28, 0.2, 'triangle'));
    }
  }
}
