import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { envMailboxKeuze } from './envkeuze';

// Instellingen van de mailkoppeling (Namecheap Private Email). Alleen env-var-namen staan
// in de code; de waarden komen uit .env.local / Vercel. Zonder mailbox is mail "nog niet
// gekoppeld" en tonen alle schermen een nette uitleg i.p.v. een fout.
//
// Welke inboxen een teamlid ziet, staat in lib/mail/mailboxen.ts (meerdere inboxen, 0026):
//   1. eigen inboxen, gekoppeld via /account: tabel mailboxen (0026) of, vóór 0026, de ene
//      rij in user_mailboxes (0021); wachtwoord versleuteld met MAIL_ENCRYPTION_KEY;
//   2. inboxen die een ander actief teamlid met het hele team deelt (0026);
//   3. de mailbox uit de env hieronder. Die is van Daniel en alleen bruikbaar voor ÉÉN
//      account (magEnvMailbox): het account met hetzelfde adres als MAIL_USER, anders het
//      account uit MAIL_ENV_USER_ID (als die gezet is), anders de OUDSTE actieve eigenaar
//      (Daniel). Een tweede eigenaar (bv. de compagnon) krijgt hem dus nooit. Plus de
//      overgangsmodus zolang 0021 niet is uitgevoerd (toen was er maar één gebruiker).
// Geen enkele inbox: niet gekoppeld (de schermen verwijzen naar /account).
//
//   MAIL_USER, MAIL_PASSWORD                verplicht
//   MAIL_IMAP_HOST (mail.privateemail.com), MAIL_IMAP_PORT (993, SSL)
//   MAIL_SMTP_HOST (mail.privateemail.com), MAIL_SMTP_PORT (465, SSL)
//   MAIL_FROM_NAME (Studio Levant), MAIL_HANDTEKENING (optioneel, "\n" = nieuwe regel)
//   MAIL_ENV_USER_ID (optioneel): user-id (uuid) van het account dat de env-mailbox krijgt

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

/** De standaard-mailbox uit de serverinstellingen, of null. Wie hem mag gebruiken: magEnvMailbox(). */
export function envMailConfig(): MailConfig | null {
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

/** De oudste actieve eigenaar (zelfde volgorde als public.team_eigenaar()), of null. */
async function oudsteEigenaar(lid: Pick<Teamlid, 'sb'>): Promise<string | null> {
  const { data, error } = await lid.sb
    .from('team_members')
    .select('user_id')
    .eq('rol', 'eigenaar')
    .eq('actief', true)
    .order('toegevoegd_op', { ascending: true })
    .order('user_id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[mail] eigenaar bepalen mislukt', error.code ?? '', error.message);
    return null; // fail closed: dan geen standaard-mailbox
  }
  return (data as { user_id: string } | null)?.user_id ?? null;
}

/**
 * Mag dit teamlid de mailbox uit de env gebruiken? Altijd hooguit één account (zie boven):
 *   1. hetzelfde adres als MAIL_USER;
 *   2. anders, met MAIL_ENV_USER_ID gezet: alleen dat user-id;
 *   3. anders de oudste actieve eigenaar (niet zomaar elke eigenaar).
 */
export async function magEnvMailbox(lid: Pick<Teamlid, 'userId' | 'email' | 'rol' | 'overgang' | 'sb'>): Promise<boolean> {
  const keuze = envMailboxKeuze({ mailUser: process.env.MAIL_USER, vastId: process.env.MAIL_ENV_USER_ID }, lid);
  if (keuze !== 'oudste_eigenaar') return keuze === 'ja';
  return (await oudsteEigenaar(lid)) === lid.userId;
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

export type ServerRij = Pick<MailboxRij, 'email' | 'imap_host' | 'imap_port' | 'smtp_host' | 'smtp_port' | 'from_name' | 'handtekening'>;

export function configUitRij(rij: ServerRij, wachtwoord: string): MailConfig {
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
