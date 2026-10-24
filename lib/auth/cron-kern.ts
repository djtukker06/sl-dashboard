import { createHash, timingSafeEqual } from 'node:crypto';

// De beslisregels voor de cron-routes, zonder env of '@/'-imports (zodat
// scripts/test-backup.mjs ze los kan testen). De route-wrapper staat in lib/auth/cron.ts.

export type CronToegang = 'ok' | 'niet_ingericht' | 'geweigerd';
export type CronBron = 'cron' | 'github';

/** Een bruikbaar CRON_SECRET (minstens 16 tekens), anders null. */
export function geldigSecret(waarde: string | undefined | null): string | null {
  const s = (waarde ?? '').trim();
  return s.length >= 16 ? s : null;
}

/** Vergelijkt in constante tijd (via sha256, dus ook bij verschillende lengtes). */
function gelijk(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

/** Klopt "Authorization: Bearer <secret>"? Zonder secret: nooit (fail closed). */
export function cronToegestaan(authorization: string | null | undefined, secret: string | null): CronToegang {
  if (!secret) return 'niet_ingericht';
  if (!authorization) return 'geweigerd';
  return gelijk(authorization.trim(), `Bearer ${secret}`) ? 'ok' : 'geweigerd';
}

/** Alleen ?bron=github telt als GitHub; al het andere is Vercel Cron. */
export function cronBron(url: string): CronBron {
  try {
    return new URL(url).searchParams.get('bron') === 'github' ? 'github' : 'cron';
  } catch {
    return 'cron';
  }
}
