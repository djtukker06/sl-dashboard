// Sessiebeleid op app-niveau (Supabase gratis kent geen time-box en geen inactiviteits-
// timeout): een httpOnly-cookie met {start, laatst}, ondertekend met HMAC-SHA256. Alleen
// Web Crypto en zonder imports met @/, zodat proxy.ts én scripts/test-beveiliging.mjs dit
// kunnen gebruiken.
//
//   - langer dan INACTIEF_MS niets gedaan, of de sessie ouder dan MAX_MS: uitloggen;
//   - "laatst" wordt hooguit eens per VERVERS_MS bijgewerkt (minder Set-Cookie);
//   - ontbreekt de cookie of klopt de handtekening niet (bv. nieuwe sleutel): een nieuwe
//     cookie zetten, NOOIT iemand daarom buitensluiten.

export const SESSIE_COOKIE = 'sl_sessie';
export const INACTIEF_MS = 12 * 60 * 60 * 1000;
export const MAX_MS = 14 * 24 * 60 * 60 * 1000;
export const VERVERS_MS = 5 * 60 * 1000;

export interface SessieTijden {
  start: number;
  laatst: number;
}

export type SessieBeslissing =
  | { soort: 'nieuw' }
  | { soort: 'verlopen'; reden: 'inactief' | 'max' }
  | { soort: 'ok'; verversen: boolean };

const sleutels = new Map<string, Promise<CryptoKey>>();

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HMAC-sleutel via HKDF uit een geheim (label sl-sessie-v1). Gecachet per geheim. */
export function sessieSleutel(geheim: string): Promise<CryptoKey> {
  let k = sleutels.get(geheim);
  if (!k) {
    const enc = new TextEncoder();
    k = crypto.subtle
      .importKey('raw', enc.encode(geheim), 'HKDF', false, ['deriveKey'])
      .then((basis) =>
        crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('studio-levant'), info: enc.encode('sl-sessie-v1') },
          basis,
          { name: 'HMAC', hash: 'SHA-256', length: 256 },
          false,
          ['sign', 'verify']
        )
      );
    sleutels.set(geheim, k);
  }
  return k;
}

export async function maakSessieWaarde(sleutel: CryptoKey, t: SessieTijden): Promise<string> {
  const data = `v1.${Math.floor(t.start)}.${Math.floor(t.laatst)}`;
  const sig = await crypto.subtle.sign('HMAC', sleutel, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

export async function leesSessieWaarde(sleutel: CryptoKey, waarde: string | undefined | null): Promise<SessieTijden | null> {
  if (!waarde || waarde.length > 200) return null;
  const m = /^v1\.(\d{1,15})\.(\d{1,15})\.([A-Za-z0-9_-]{20,100})$/.exec(waarde);
  if (!m) return null;
  const data = `v1.${m[1]}.${m[2]}`;
  const verwacht = await crypto.subtle.sign('HMAC', sleutel, new TextEncoder().encode(data));
  // Vergelijk in constante tijd.
  const a = b64url(verwacht);
  const b = m[3];
  if (a.length !== b.length) return null;
  let verschil = 0;
  for (let i = 0; i < a.length; i++) verschil |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (verschil !== 0) return null;
  const start = Number(m[1]);
  const laatst = Number(m[2]);
  if (!(start > 0) || laatst < start) return null;
  return { start, laatst };
}

export function sessieBeslissing(t: SessieTijden | null, nu: number): SessieBeslissing {
  if (!t) return { soort: 'nieuw' };
  // Een klok die terugloopt of een cookie uit de toekomst: opnieuw beginnen.
  if (t.start > nu + 60_000 || t.laatst > nu + 60_000) return { soort: 'nieuw' };
  if (nu - t.start > MAX_MS) return { soort: 'verlopen', reden: 'max' };
  if (nu - t.laatst > INACTIEF_MS) return { soort: 'verlopen', reden: 'inactief' };
  return { soort: 'ok', verversen: nu - t.laatst > VERVERS_MS };
}

export const SESSIE_COOKIE_OPTIES = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  // De cookie zelf leeft iets langer dan de maximale sessie; de inhoud bepaalt het verlopen.
  maxAge: Math.ceil(MAX_MS / 1000) + 86_400
};
