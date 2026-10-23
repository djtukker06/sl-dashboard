import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { ontsleutel } from './kluis';
import { envMailboxKeuze } from './envkeuze';

// Instellingen van de mailkoppeling (Namecheap Private Email). Alleen env-var-namen staan
// in de code; de waarden komen uit .env.local / Vercel. Zonder mailbox is mail "nog niet
// gekoppeld" en tonen alle schermen een nette uitleg i.p.v. een fout.
//
// Mail is PERSOONLIJK: elke gebruiker ziet alleen zijn eigen mailbox (mailConfigVoor(lid)).
//   1. Een eigen mailbox, gekoppeld via /account: tabel user_mailboxes (migratie 0021),
//      wachtwoord versleuteld met MAIL_ENCRYPTION_KEY (lib/mail/kluis.ts). Alleen de server
//      leest die tabel (service-role, altijd met het eigen user-id).
//   2. Anders de mailbox uit de env hieronder. Die is van Daniel en alleen bruikbaar voor
//      ÉÉN account (magEnvMailbox): het account met hetzelfde adres als MAIL_USER, anders
//      het account uit MAIL_ENV_USER_ID (als die gezet is), anders de OUDSTE actieve eigenaar
//      (Daniel). Een tweede eigenaar (bv. de compagnon) krijgt hem dus nooit. Plus de
//      overgangsmodus zolang 0021 niet is uitgevoerd (toen was er maar één gebruiker).
//   3. Anders: niet gekoppeld (de schermen verwijzen naar /account).
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

/** Welke mailbox volgt uit het eigen record en het recht op de env-mailbox (zonder I/O). */
export function mailboxUit(lid: Pick<Teamlid, 'userId'>, rij: MailboxRij | null, magEnv: boolean): { cfg: MailConfig | null; bron: MailBron } {
  if (rij) {
    const wachtwoord = ontsleutel(rij.wachtwoord_enc, lid.userId);
    if (wachtwoord !== null) return { cfg: configUitRij(rij, wachtwoord), bron: 'eigen' };
    console.warn('[mail] eigen mailbox niet te ontsleutelen (andere MAIL_ENCRYPTION_KEY?): opnieuw koppelen via /account.');
  }
  if (magEnv) {
    const env = envMailConfig();
    if (env) return { cfg: env, bron: 'standaard' };
  }
  return { cfg: null, bron: 'geen' };
}

// Korte cache per gebruiker (per serverinstantie): het dashboard, de rail-badge en elke
// /api/mail/**-call vragen de mailbox op; zonder cache is dat telkens een service-role-query
// (+ soms de eigenaar-query) en een ontsleuteling. Altijd per user-id: nooit de mailbox van
// een ander. Koppelen/ontkoppelen via /account wist de eigen regel meteen (vergeetMailbox);
// op een andere serverinstantie is een wijziging hooguit MAILBOX_CACHE_MS oud.
export const MAILBOX_CACHE_MS = 30_000;
const mailboxCache = new Map<string, { tot: number; waarde: { cfg: MailConfig | null; bron: MailBron } }>();

/** Wist de gecachete mailbox van deze gebruiker (na koppelen of ontkoppelen). */
export function vergeetMailbox(userId: string): void {
  for (const k of mailboxCache.keys()) if (k.startsWith(`${userId}:`)) mailboxCache.delete(k);
}

/** De mailbox van dit teamlid en waar hij vandaan komt (zie boven). */
export async function mailboxVoor(lid: Teamlid): Promise<{ cfg: MailConfig | null; bron: MailBron }> {
  const sleutel = `${lid.userId}:${lid.overgang ? 'o' : 't'}`;
  const nu = Date.now();
  const hit = mailboxCache.get(sleutel);
  if (hit && hit.tot > nu) return hit.waarde;

  let rij: MailboxRij | null = null;
  let gelukt = true;
  try {
    rij = (await eigenMailboxRij(lid)).rij;
  } catch {
    // Storing bij het ophalen: liever de standaard-mailbox (als die van jou is) dan niets.
    rij = null;
    gelukt = false;
  }
  const waarde = mailboxUit(lid, rij, await magEnvMailbox(lid));
  // Een storing niet onthouden: dan volgende keer gewoon opnieuw proberen.
  if (gelukt) {
    if (mailboxCache.size > 100) mailboxCache.clear();
    mailboxCache.set(sleutel, { tot: nu + MAILBOX_CACHE_MS, waarde });
  }
  return waarde;
}

/** Het adres van de standaard-mailbox, alleen als dit teamlid hem mag gebruiken. */
export async function standaardAdresVoor(lid: Teamlid, magEnv?: boolean): Promise<string | null> {
  return (magEnv ?? (await magEnvMailbox(lid))) ? envMailConfig()?.user ?? null : null;
}

/**
 * De mailbox van dit teamlid, of null ("niet gekoppeld"). Nooit de mailbox van een ander:
 * een eigen record alleen met het eigen user-id, de env-mailbox alleen volgens magEnvMailbox().
 */
export async function mailConfigVoor(lid: Teamlid): Promise<MailConfig | null> {
  return (await mailboxVoor(lid)).cfg;
}
