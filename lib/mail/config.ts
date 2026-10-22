import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { ontsleutel } from './kluis';

// Instellingen van de mailkoppeling (Namecheap Private Email). Alleen env-var-namen staan
// in de code; de waarden komen uit .env.local / Vercel. Zonder mailbox is mail "nog niet
// gekoppeld" en tonen alle schermen een nette uitleg i.p.v. een fout.
//
// Mail is PERSOONLIJK: elke gebruiker ziet alleen zijn eigen mailbox (mailConfigVoor(lid)).
//   1. Een eigen mailbox, gekoppeld via /account: tabel user_mailboxes (migratie 0021),
//      wachtwoord versleuteld met MAIL_ENCRYPTION_KEY (lib/mail/kluis.ts). Alleen de server
//      leest die tabel (service-role, altijd met het eigen user-id).
//   2. Anders de mailbox uit de env hieronder. Die is van de eigenaar (Daniel) en alleen
//      bruikbaar voor het account met hetzelfde adres als MAIL_USER, de eigenaar van het
//      team (rol 'eigenaar'), of de overgangsmodus zolang 0021 niet is uitgevoerd.
//   3. Anders: niet gekoppeld (de schermen verwijzen naar /account).
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

export interface MailboxRij {
  user_id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  from_name: string;
  handtekening: string;
  wachtwoord_enc: string;
  sleutel_versie: number;
  geverifieerd_op: string | null;
  updated_at: string;
}

/**
 * Het eigen mailbox-record van dit teamlid (service-role, alleen het eigen user-id).
 * `ingericht: false` = de tabel bestaat nog niet (0021 niet uitgevoerd of overgangsmodus).
 */
export async function eigenMailboxRij(lid: Teamlid): Promise<{ rij: MailboxRij | null; ingericht: boolean }> {
  if (lid.overgang) return { rij: null, ingericht: false };
  const { data, error } = await createServiceRoleClient(lid.bewijs)
    .from('user_mailboxes')
    .select('*')
    .eq('user_id', lid.userId)
    .maybeSingle();
  if (error) {
    if (tabelOntbreekt(error)) return { rij: null, ingericht: false };
    console.error('[mail] eigen mailbox ophalen mislukt', error.code ?? '', error.message);
    throw new Error('Kon je mailbox-instellingen niet ophalen.');
  }
  return { rij: (data as MailboxRij | null) ?? null, ingericht: true };
}

export function configUitRij(rij: MailboxRij, wachtwoord: string): MailConfig {
  return {
    imapHost: rij.imap_host,
    imapPort: rij.imap_port,
    smtpHost: rij.smtp_host,
    smtpPort: rij.smtp_port,
    user: rij.email,
    password: wachtwoord,
    fromName: rij.from_name || '',
    handtekening: rij.handtekening || ''
  };
}

export type MailBron = 'eigen' | 'standaard' | 'geen';

/** De mailbox van dit teamlid en waar hij vandaan komt (zie boven). */
export async function mailboxVoor(lid: Teamlid): Promise<{ cfg: MailConfig | null; bron: MailBron }> {
  let rij: MailboxRij | null = null;
  try {
    rij = (await eigenMailboxRij(lid)).rij;
  } catch {
    // Storing bij het ophalen: liever de standaard-mailbox (als die van jou is) dan niets.
    rij = null;
  }
  if (rij) {
    const wachtwoord = ontsleutel(rij.wachtwoord_enc, lid.userId);
    if (wachtwoord !== null) return { cfg: configUitRij(rij, wachtwoord), bron: 'eigen' };
    console.warn('[mail] eigen mailbox niet te ontsleutelen (andere MAIL_ENCRYPTION_KEY?): opnieuw koppelen via /account.');
  }
  if (magEnvMailbox(lid)) {
    const env = envMailConfig();
    if (env) return { cfg: env, bron: 'standaard' };
  }
  return { cfg: null, bron: 'geen' };
}

/** Het adres van de standaard-mailbox, alleen als dit teamlid hem mag gebruiken. */
export function standaardAdresVoor(lid: Teamlid): string | null {
  return magEnvMailbox(lid) ? envMailConfig()?.user ?? null : null;
}

/**
 * De mailbox van dit teamlid, of null ("niet gekoppeld"). Nooit de mailbox van een ander:
 * een eigen record alleen met het eigen user-id, de env-mailbox alleen volgens magEnvMailbox().
 */
export async function mailConfigVoor(lid: Teamlid): Promise<MailConfig | null> {
  return (await mailboxVoor(lid)).cfg;
}
