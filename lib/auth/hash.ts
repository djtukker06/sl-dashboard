import 'server-only';
import { createHash, hkdfSync } from 'node:crypto';

// Gepeperde hashes voor audit-log en pogingenlimiet: zo staat er nooit een IP-adres of
// e-mailadres leesbaar in de database. Peper: AUDIT_PEPPER, anders afgeleid (HKDF) van de
// service-role-sleutel (die staat toch alleen in de server-env).

let peperCache: Buffer | null = null;

function peper(): Buffer {
  if (peperCache) return peperCache;
  const eigen = process.env.AUDIT_PEPPER;
  const basis = eigen || process.env.SUPABASE_SERVICE_ROLE_KEY || 'sl-geen-peper';
  peperCache = Buffer.from(hkdfSync('sha256', basis, 'studio-levant', 'sl-audit-pepper-v1', 32));
  return peperCache;
}

/** sha256(peper ‖ soort ‖ waarde), eerste 32 hex-tekens. */
export function hashKort(soort: string, waarde: string): string {
  return createHash('sha256').update(peper()).update(`${soort}\u0000${waarde}`).digest('hex').slice(0, 32);
}

/** Het IP van de bezoeker zoals Vercel het doorgeeft (eerste adres in x-forwarded-for). */
export function clientIp(h: Headers): string {
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim().slice(0, 64);
  return (h.get('x-real-ip') || '').trim().slice(0, 64);
}

export function ipHash(h: Headers): string | null {
  const ip = clientIp(h);
  return ip ? hashKort('ip', ip) : null;
}
