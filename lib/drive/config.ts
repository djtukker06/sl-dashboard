import 'server-only';
import { leesSleutel, ontsleutelMet, versleutelMet } from '@/lib/mail/kluis-kern';

// Server-instellingen van de Drive-koppeling (nooit naar de browser):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   OAuth-client (type "Web application") uit
//                                            Google Cloud Console (zie README)
//   DRIVE_ENCRYPTION_KEY                     optioneel: eigen sleutel (32 bytes, base64) voor
//                                            het refresh token. Leeg = MAIL_ENCRYPTION_KEY.
//
// Keuze: standaard dezelfde AES-256-GCM-kluis en dezelfde sleutel als de mailboxen
// (MAIL_ENCRYPTION_KEY), met een eigen AAD ('drive-koppeling'), zodat een versleutelde
// mailbox-waarde nooit als Drive-token bruikbaar is en andersom. Wie de sleutels gescheiden
// wil houden, zet DRIVE_ENCRYPTION_KEY; staat die er (ook als hij ongeldig is), dan wordt
// alleen die gebruikt. Wisselen van sleutel = Drive opnieuw koppelen.

export const DRIVE_AAD = 'drive-koppeling';

export function sleutel(): Buffer | null {
  const eigen = process.env.DRIVE_ENCRYPTION_KEY;
  if (eigen && eigen.trim()) return leesSleutel(eigen);
  return leesSleutel(process.env.MAIL_ENCRYPTION_KEY);
}

export function clientId(): string {
  return (process.env.GOOGLE_CLIENT_ID || '').trim();
}

export function clientSecret(): string {
  return (process.env.GOOGLE_CLIENT_SECRET || '').trim();
}

/** Namen van ontbrekende env-vars (nooit waarden). */
export function ontbrekendeEnv(): string[] {
  const mist: string[] = [];
  if (!clientId()) mist.push('GOOGLE_CLIENT_ID');
  if (!clientSecret()) mist.push('GOOGLE_CLIENT_SECRET');
  if (!sleutel()) mist.push(process.env.DRIVE_ENCRYPTION_KEY?.trim() ? 'DRIVE_ENCRYPTION_KEY (ongeldig)' : 'MAIL_ENCRYPTION_KEY of DRIVE_ENCRYPTION_KEY');
  return mist;
}

export function versleutelToken(token: string): string {
  const k = sleutel();
  if (!k) throw new Error('Geen sleutel voor de Drive-koppeling.');
  return versleutelMet(k, token, DRIVE_AAD);
}

/** Het refresh token, of null als het niet (meer) te ontsleutelen is (andere sleutel). */
export function ontsleutelToken(waarde: string): string | null {
  const k = sleutel();
  if (!k) return null;
  try {
    return ontsleutelMet(k, waarde, DRIVE_AAD);
  } catch {
    return null;
  }
}
