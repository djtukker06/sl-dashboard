import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// CSRF-bescherming van de OAuth-koppeling (zonder env of '@/'-imports, zodat
// scripts/test-drive.mjs dit los kan testen).
//
// Bij "Drive koppelen" maakt de server een willekeurige nonce. Die gaat als `state` mee naar
// Google, en zit samen met het user-id, de redirect-URI en een verlooptijd in een
// ondertekende, httpOnly cookie (HMAC-SHA256). De callback accepteert alleen een state die
// precies de nonce uit een geldige, niet-verlopen cookie van DEZELFDE gebruiker is. Zo kan
// niemand een eigenaar een Google-account (of code) van een ander laten koppelen.
//
// Cookie-formaat: base64url(JSON {n, u, r, e}) + "." + base64url(HMAC)

export const STATE_COOKIE = 'sl_drive_state';
export const STATE_GELDIG_SEC = 10 * 60;

interface Inhoud {
  n: string; // nonce (= state)
  u: string; // user-id
  r: string; // redirect-URI
  e: number; // verloopt (ms sinds epoch)
}

const b64 = (b: Buffer) => b.toString('base64url');

function teken(geheim: Buffer, data: string): string {
  return b64(createHmac('sha256', geheim).update(`drive-state:${data}`).digest());
}

function gelijk(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Een afgeleid geheim voor het ondertekenen (nooit de sleutel zelf gebruiken). */
export function stateGeheim(sleutel: Buffer): Buffer {
  return createHmac('sha256', sleutel).update('studio-levant/drive-oauth-state/v1').digest();
}

export function maakState(geheim: Buffer, userId: string, redirectUri: string, nu = Date.now()): { state: string; cookie: string } {
  const inhoud: Inhoud = { n: b64(randomBytes(32)), u: userId, r: redirectUri, e: nu + STATE_GELDIG_SEC * 1000 };
  const data = b64(Buffer.from(JSON.stringify(inhoud), 'utf8'));
  return { state: inhoud.n, cookie: `${data}.${teken(geheim, data)}` };
}

export type StateUitkomst = { ok: true; redirectUri: string } | { ok: false; reden: 'ontbreekt' | 'handtekening' | 'verlopen' | 'anders' | 'gebruiker' };

export function controleerState(
  geheim: Buffer,
  cookie: string | null | undefined,
  state: string | null | undefined,
  userId: string,
  nu = Date.now()
): StateUitkomst {
  if (!cookie || !state) return { ok: false, reden: 'ontbreekt' };
  const punt = cookie.lastIndexOf('.');
  if (punt <= 0) return { ok: false, reden: 'handtekening' };
  const data = cookie.slice(0, punt);
  const mac = cookie.slice(punt + 1);
  if (!gelijk(mac, teken(geheim, data))) return { ok: false, reden: 'handtekening' };
  let inhoud: Inhoud;
  try {
    inhoud = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Inhoud;
  } catch {
    return { ok: false, reden: 'handtekening' };
  }
  if (typeof inhoud.e !== 'number' || inhoud.e < nu) return { ok: false, reden: 'verlopen' };
  if (typeof inhoud.n !== 'string' || !gelijk(inhoud.n, state)) return { ok: false, reden: 'anders' };
  if (inhoud.u !== userId) return { ok: false, reden: 'gebruiker' };
  return { ok: true, redirectUri: String(inhoud.r) };
}
