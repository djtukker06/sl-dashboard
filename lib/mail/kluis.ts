import 'server-only';
import { leesSleutel, ontsleutelMet, versleutelMet } from './kluis-kern';

// Versleutelen van mailbox-wachtwoorden (tabel user_mailboxes) met de sleutel uit de env:
//   MAIL_ENCRYPTION_KEY   32 bytes, base64 — maken met:  openssl rand -base64 32
// De sleutel staat alleen op de server (Vercel / .env.local), nooit in de database of de
// browser. Zonder (geldige) sleutel kan niemand een eigen mailbox koppelen; /account
// toont dan een melding. Een andere sleutel = opnieuw koppelen (oude records zijn dan
// onleesbaar). `sleutel_versie` in de tabel is er voor een latere rotatie.

export const SLEUTEL_VERSIE = 1;

function sleutel(): Buffer | null {
  return leesSleutel(process.env.MAIL_ENCRYPTION_KEY);
}

/** Staat er een geldige sleutel op de server? */
export function kluisBeschikbaar(): boolean {
  return sleutel() !== null;
}

export function versleutel(wachtwoord: string, userId: string): string {
  const k = sleutel();
  if (!k) throw new Error('MAIL_ENCRYPTION_KEY ontbreekt of is ongeldig.');
  return versleutelMet(k, wachtwoord, userId);
}

/** Het wachtwoord, of null als het niet (meer) te ontsleutelen is (andere sleutel, geknoei). */
export function ontsleutel(waarde: string, userId: string): string | null {
  const k = sleutel();
  if (!k) return null;
  try {
    return ontsleutelMet(k, waarde, userId);
  } catch {
    return null;
  }
}
