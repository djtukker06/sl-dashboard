// Vergaderlinks herkennen: een Teams-, Meet-, Zoom-, Webex-, Whereby-, Jitsi- of
// FaceTime-link in de locatie of de notitie van een afspraak wordt een knop "Deelnemen met
// Teams" (agenda-paneel, dashboard) en een camera-icoon in de agenda. Een Meet-link die
// Google zelf bij een afspraak hoort (conferenceData) gaat voor. Pure functies zonder
// imports (alleen types), zodat scripts/test-google-agenda.mjs dit direct laadt.

import type { Afspraak } from './types';

export interface Vergaderlink {
  url: string;
  /** "Teams", "Google Meet", "Zoom", … */
  dienst: string;
}

const DIENSTEN: { host: RegExp; pad?: RegExp; naam: string }[] = [
  { host: /^meet\.google\.com$/, pad: /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}|^\/lookup\//i, naam: 'Google Meet' },
  { host: /^teams\.(microsoft|live)\.com$/, pad: /^\/(l\/meetup-join|meet)\//i, naam: 'Teams' },
  { host: /^([a-z0-9-]+\.)?zoom\.(us|com)$/, pad: /^\/(j|w|my|s|wc)\//i, naam: 'Zoom' },
  { host: /^([a-z0-9-]+\.)?webex\.com$/, naam: 'Webex' },
  { host: /^whereby\.com$/, naam: 'Whereby' },
  { host: /^meet\.jit\.si$/, naam: 'Jitsi' },
  { host: /^facetime\.apple\.com$/, naam: 'FaceTime' }
];

const URL_IN_TEKST = /https?:\/\/[^\s<>"'()[\]]+/gi;

/** Herkent één link; null als het geen (veilige) vergaderlink is. */
export function alsVergaderlink(ruw: string): Vergaderlink | null {
  const schoon = ruw.replace(/[.,;:!?)]+$/, '');
  let u: URL;
  try {
    u = new URL(schoon);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const d = DIENSTEN.find((x) => x.host.test(host) && (!x.pad || x.pad.test(u.pathname)));
  return d ? { url: u.toString(), dienst: d.naam } : null;
}

/** De eerste vergaderlink in een of meer teksten (locatie eerst, dan de notitie). */
export function vindVergaderlink(...teksten: (string | null | undefined)[]): Vergaderlink | null {
  for (const t of teksten) {
    for (const m of (t ?? '').matchAll(URL_IN_TEKST)) {
      const v = alsVergaderlink(m[0]);
      if (v) return v;
    }
  }
  return null;
}

/** De vergaderlink van een afspraak: die van Google zelf, anders uit locatie of notitie. */
export function vergaderlinkVan(a: Pick<Afspraak, 'locatie' | 'notitie' | 'google'>): Vergaderlink | null {
  if (a.google?.meetLink) return { url: a.google.meetLink, dienst: a.google.vergaderDienst ?? 'Google Meet' };
  return vindVergaderlink(a.locatie, a.notitie);
}

/** Locatie om te tonen in een kort blok: een vergaderlink als de naam van de dienst. */
export function korteLocatie(locatie: string): string {
  const v = vindVergaderlink(locatie);
  if (!v) return locatie;
  const rest = locatie.replace(URL_IN_TEKST, '').replace(/^[\s,·\-–]+|[\s,·\-–]+$/g, '');
  return rest ? `${rest} · ${v.dienst}` : v.dienst;
}
