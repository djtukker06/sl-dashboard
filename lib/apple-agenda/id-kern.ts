// Id's van afspraken uit Apple Agenda (iCloud), zonder imports (ook bruikbaar in de browser
// en in scripts/test-apple-agenda.mjs):
//
//   "a.<agenda-rij-id>.<bestand>"               een afspraak (bestand = base64url van de naam
//                                                van het .ics-bestand in die agenda)
//   "a.<agenda-rij-id>.<bestand>~<voorkomen>"   één voorkomen van een herhalende afspraak
//                                                (voorkomen = 20261121 of 20261121T090000Z)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BESTAND = /^[A-Za-z0-9_-]{1,400}$/;
const VOORKOMEN = /^\d{8}(T\d{6}Z)?$/;

function naarB64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function uitB64url(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Een geldige bestandsnaam in een agenda: geen pad, geen rare tekens. */
export function isBestandsnaam(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 280 && !/[/\\\0\r\n]/.test(s) && s !== '.' && s !== '..';
}

export function appleAfspraakId(agendaId: string, bestand: string, voorkomen?: string | null): string {
  return `a.${agendaId}.${naarB64url(bestand)}${voorkomen ? `~${voorkomen}` : ''}`;
}

/** "a.<agenda>.<bestand>[~<voorkomen>]" → de delen, of null. */
export function splitsAppleId(s: unknown): { agendaId: string; bestand: string; voorkomen: string | null } | null {
  if (typeof s !== 'string' || !s.startsWith('a.') || s.length > 500) return null;
  const agendaId = s.slice(2, 38);
  if (!UUID.test(agendaId) || s[38] !== '.') return null;
  const rest = s.slice(39);
  const [b, voorkomen = null, ...meer] = rest.split('~');
  if (meer.length || !BESTAND.test(b) || (voorkomen !== null && !VOORKOMEN.test(voorkomen))) return null;
  const bestand = uitB64url(b);
  if (!bestand || !isBestandsnaam(bestand)) return null;
  return { agendaId, bestand, voorkomen };
}

export function isAppleAfspraakId(s: unknown): s is string {
  return splitsAppleId(s) !== null;
}

/** Snelle check in de browser: komt deze afspraak uit Apple Agenda? */
export const isAppleId = (s: string | null | undefined) => typeof s === 'string' && s.startsWith('a.');
