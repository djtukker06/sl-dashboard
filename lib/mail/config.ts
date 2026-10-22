import 'server-only';
import type { Teamlid } from '@/lib/auth/team';

// Instellingen van de mailkoppeling (Namecheap Private Email). Alleen env-var-namen staan
// in de code; de waarden komen uit .env.local / Vercel. Zonder mailbox is mail "nog niet
// gekoppeld" en tonen alle schermen een nette uitleg i.p.v. een fout.
//
// Mail is PERSOONLIJK: elke gebruiker ziet alleen zijn eigen mailbox (mailConfigVoor(lid)).
// De mailbox uit de env hieronder is van de eigenaar (Daniel) en is alleen bruikbaar voor:
//   - het account met hetzelfde adres als MAIL_USER, of
//   - de eigenaar van het team (rol 'eigenaar' in team_members), of
//   - de overgangsmodus zolang migratie 0021 niet is uitgevoerd (dan is er één gebruiker).
// Een eigen mailbox per teamlid (versleuteld in user_mailboxes) volgt via /account.
//
//   MAIL_USER, MAIL_PASSWORD                verplicht
//   MAIL_IMAP_HOST (mail.privateemail.com), MAIL_IMAP_PORT (993, SSL)
//   MAIL_SMTP_HOST (mail.privateemail.com), MAIL_SMTP_PORT (465, SSL)
//   MAIL_FROM_NAME (Studio Levant), MAIL_HANDTEKENING (optioneel, "\n" = nieuwe regel)

const STANDAARD_HOST = 'mail.privateemail.com';

export interface MailConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  password: string;
  fromName: string;
  handtekening: string;
}

function poort(waarde: string | undefined, standaard: number): number {
  const n = Number(waarde);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : standaard;
}

function envMailConfig(): MailConfig | null {
  const user = process.env.MAIL_USER?.trim();
  const password = process.env.MAIL_PASSWORD;
  if (!user || !password) return null;
  return {
    imapHost: process.env.MAIL_IMAP_HOST?.trim() || STANDAARD_HOST,
    imapPort: poort(process.env.MAIL_IMAP_PORT, 993),
    smtpHost: process.env.MAIL_SMTP_HOST?.trim() || STANDAARD_HOST,
    smtpPort: poort(process.env.MAIL_SMTP_PORT, 465),
    user,
    password,
    fromName: process.env.MAIL_FROM_NAME?.trim() || 'Studio Levant',
    handtekening: (process.env.MAIL_HANDTEKENING || '').replace(/\\n/g, '\n').trim()
  };
}

/** Mag dit teamlid de mailbox uit de env gebruiken? (zie boven) */
export function magEnvMailbox(lid: Pick<Teamlid, 'email' | 'rol' | 'overgang'>): boolean {
  const envUser = process.env.MAIL_USER?.trim().toLowerCase();
  if (!envUser) return false;
  return lid.overgang || lid.rol === 'eigenaar' || lid.email.trim().toLowerCase() === envUser;
}

/**
 * De mailbox van dit teamlid, of null ("niet gekoppeld"). Nooit de mailbox van een ander:
 * de env-mailbox alleen volgens magEnvMailbox().
 */
export async function mailConfigVoor(lid: Pick<Teamlid, 'email' | 'rol' | 'overgang'>): Promise<MailConfig | null> {
  return magEnvMailbox(lid) ? envMailConfig() : null;
}
