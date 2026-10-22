import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// De kern van de mailkluis: AES-256-GCM, zonder env of '@/'-imports (zodat
// scripts/test-account.mjs dit los kan testen). De server-kant staat in lib/mail/kluis.ts.
//
// Formaat: "v1:<iv base64>.<tag base64>.<ciphertext base64>"
//   - iv: 12 willekeurige bytes per keer versleutelen (nooit hergebruikt);
//   - tag: 16 bytes (GCM): elke wijziging aan iv, tag, ciphertext of AAD laat ontsleutelen falen;
//   - AAD: het user-id. Een ciphertext die naar het record van een ander wordt gekopieerd,
//     is daar dus onbruikbaar.

export const KLUIS_VERSIE = 'v1';

/** 32 bytes uit base64 (`openssl rand -base64 32`), anders null. */
export function leesSleutel(waarde: string | undefined | null): Buffer | null {
  if (!waarde) return null;
  const s = waarde.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  const k = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return k.length === 32 ? k : null;
}

export function versleutelMet(sleutel: Buffer, tekst: string, aad: string): string {
  if (sleutel.length !== 32) throw new Error('Ongeldige sleutel.');
  if (!aad) throw new Error('AAD ontbreekt.');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', sleutel, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(tekst, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `${KLUIS_VERSIE}:${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

/** Gooit bij een ander formaat, een verkeerde sleutel, een andere AAD of geknoei. */
export function ontsleutelMet(sleutel: Buffer, waarde: string, aad: string): string {
  if (sleutel.length !== 32) throw new Error('Ongeldige sleutel.');
  const m = /^v1:([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]*)$/.exec(waarde);
  if (!m) throw new Error('Onbekend formaat.');
  const iv = Buffer.from(m[1], 'base64');
  const tag = Buffer.from(m[2], 'base64');
  const ct = Buffer.from(m[3], 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Onbekend formaat.');
  const d = createDecipheriv('aes-256-gcm', sleutel, iv);
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
