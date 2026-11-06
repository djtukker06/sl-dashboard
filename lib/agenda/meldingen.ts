'use client';

import { useSyncExternalStore } from 'react';
import { perGebruiker } from '@/lib/mail/client';
import { herinneringSleutel, teMelden, type KomendeAfspraak, type Melding } from './meldingen-kern';

// Meldingen vóór een afspraak (10 en 1 minuut vooraf): de instelling (per gebruiker, in deze
// browser), de toestemming van de browser en de twee geluiden. Het plannen en tonen gebeurt in
// components/agenda/AfspraakMeldingen (in de shell, dus op elke pagina van het dashboard).

export { herinneringSleutel, teMelden, type KomendeAfspraak, type Melding };

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

// ---------- herinnering per afspraak ----------
// Standaard krijgt elke afspraak een herinnering; in het afspraakpaneel zet je hem per
// afspraak (bij een reeks: voor de hele reeks) uit. Net als de meldingen zelf per gebruiker
// in deze browser: hier komen de meldingen ook binnen.

const UIT_SLEUTEL = 'sl-herinnering-uit';

export function herinneringenUit(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(perGebruiker(UIT_SLEUTEL)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function heeftHerinnering(sleutel: string): boolean {
  return !herinneringenUit().has(sleutel);
}

export function zetHerinnering(sleutel: string, aan: boolean) {
  const uit = herinneringenUit();
  if (aan) uit.delete(sleutel);
  else uit.add(sleutel);
  try {
    localStorage.setItem(perGebruiker(UIT_SLEUTEL), JSON.stringify([...uit].slice(-500)));
  } catch {
    /* geen opslag */
  }
  window.dispatchEvent(new Event(EVENT));
}

// ---------- beltoon (10 minuten vooraf) ----------
// "Normaal" = het klokje hieronder; "Picobello" = het begin van het nummer
// (public/geluiden/picobello.mp3). Per gebruiker in deze browser.

export type Beltoon = 'normaal' | 'picobello';
export const BELTONEN: { waarde: Beltoon; label: string }[] = [
  { waarde: 'normaal', label: 'Normaal' },
  { waarde: 'picobello', label: 'Picobello' }
];
const BELTOON_SLEUTEL = 'sl-meldingen-beltoon';

function leesBeltoon(): Beltoon {
  try {
    return localStorage.getItem(perGebruiker(BELTOON_SLEUTEL)) === 'picobello' ? 'picobello' : 'normaal';
  } catch {
    return 'normaal';
  }
}

export function useBeltoon(): Beltoon {
  return useSyncExternalStore(abonneer, leesBeltoon, () => 'normaal' as Beltoon);
}

export function zetBeltoon(b: Beltoon) {
  try {
    localStorage.setItem(perGebruiker(BELTOON_SLEUTEL), b);
  } catch {
    /* geen opslag */
  }
  window.dispatchEvent(new Event(EVENT));
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

const CLIP = '/geluiden/picobello.mp3';
/** De clip zelf bepaalt de lengte (nu ±1,5 s), met hooguit 3 s en een korte fade-out. */
const CLIP_SEC = 3;
let clip: Promise<AudioBuffer | null> | null = null;

function laadClip(c: AudioContext): Promise<AudioBuffer | null> {
  clip ??= fetch(CLIP, { cache: 'force-cache' })
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((b) => c.decodeAudioData(b))
    .catch(() => {
      clip = null; // later opnieuw proberen
      return null;
    });
  return clip;
}

/** De eerste seconde van Picobello; true als dat lukte (anders speelt het klokje). */
async function speelClip(c: AudioContext): Promise<boolean> {
  const buf = await laadClip(c);
  if (!buf) return false;
  const duur = Math.min(CLIP_SEC, buf.duration);
  const bron = c.createBufferSource();
  const gain = c.createGain();
  const t = c.currentTime + 0.02;
  bron.buffer = buf;
  gain.gain.setValueAtTime(0.9, t);
  gain.gain.setValueAtTime(0.9, t + duur - 0.12);
  gain.gain.linearRampToValueAtTime(0.0001, t + duur);
  bron.connect(gain).connect(c.destination);
  bron.start(t, 0, duur);
  return true;
}

export function speelGeluid(soort: Melding['minuten'], beltoon: Beltoon = leesBeltoon()) {
  ontgrendelGeluid();
  const c = ctx;
  if (!c) return;
  if (soort === 10 && beltoon === 'picobello') {
    void speelClip(c).then((ok) => {
      if (!ok) speelGeluid(10, 'normaal');
    });
    return;
  }
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
