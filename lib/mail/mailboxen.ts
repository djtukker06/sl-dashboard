import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { teamProfielen } from '@/lib/team/profielen';
import { configUitRij, eigenMailboxRij, envMailConfig, magEnvMailbox, type MailConfig, type MailboxRij } from './config';
import { ontsleutel } from './kluis';
import {
  ENV_MAILBOX_ID,
  isZichtbaar,
  naarDto,
  OUDE_MAILBOX_ID,
  sorteerInboxen,
  standaardLabel,
  type InboxDto,
  type Zichtbaarheid
} from './zichtbaarheid';

// Meerdere inboxen per teamlid (migratie 0026). Eén plek die bepaalt welke inboxen je ziet:
//   - je eigen inboxen (tabel mailboxen; vóór 0026 de ene rij in user_mailboxes);
//   - inboxen die een ANDER ACTIEF teamlid met het hele team deelt;
//   - de standaard-mailbox uit de env (alleen voor wie hem mag gebruiken, zie config.ts).
// Alleen de server leest mailboxen (service-role, ná de teamcheck: lid.bewijs). De
// wachtwoorden worden hier ontsleuteld (AAD = eigenaar_id van de rij) en blijven op de
// server; naar de browser gaat alleen naarDto() (lib/mail/zichtbaarheid.ts).

/** Een zichtbare inbox, met (alleen server-side) de verbinding. */
export interface Mailbox extends InboxDto {
  eigenaarId: string;
  volgorde: number;
  /** 'mailbox' = tabel mailboxen (0026), 'oud' = user_mailboxes (vóór 0026), 'env' = serverinstellingen. */
  soort: 'mailbox' | 'oud' | 'env';
  geverifieerdOp: string | null;
  gekoppeldOp: string | null;
  /** Servers (alleen voor het eigen beheer op de server; nooit naar de browser van een ander). */
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** De verbinding met wachtwoord; null = niet te ontsleutelen. NOOIT naar de browser. */
  cfg: MailConfig | null;
}

/** Waar de inboxen staan: 'nieuw' = tabel mailboxen, 'oud' = user_mailboxes, 'geen' = overgangsmodus (vóór 0021). */
export type MailboxOpslag = 'nieuw' | 'oud' | 'geen';

export interface ZichtbareMailboxen {
  lijst: Mailbox[];
  opslag: MailboxOpslag;
}

export interface MailboxenRij {
  id: string;
  eigenaar_id: string;
  email: string;
  label: string;
  kleur: string;
  zichtbaarheid: Zichtbaarheid;
  volgorde: number;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  from_name: string;
  handtekening: string;
  wachtwoord_enc: string;
  sleutel_versie: number;
  geverifieerd_op: string | null;
  gekoppeld_op: string | null;
}

export const MAILBOXEN_KOLOMMEN =
  'id, eigenaar_id, email, label, kleur, zichtbaarheid, volgorde, imap_host, imap_port, smtp_host, smtp_port, from_name, handtekening, wachtwoord_enc, sleutel_versie, geverifieerd_op, gekoppeld_op';

function uitRij(rij: MailboxenRij, viewerId: string, namen: Map<string, string>): Mailbox {
  const wachtwoord = ontsleutel(rij.wachtwoord_enc, rij.eigenaar_id);
  if (wachtwoord === null) console.warn('[mail] een inbox is niet te ontsleutelen (andere MAIL_ENCRYPTION_KEY?): opnieuw koppelen via /account.');
  return {
    id: rij.id,
    label: rij.label,
    email: rij.email,
    kleur: rij.kleur,
    zichtbaarheid: rij.zichtbaarheid === 'team' ? 'team' : 'prive',
    vanMij: rij.eigenaar_id === viewerId,
    eigenaarNaam: namen.get(rij.eigenaar_id) ?? 'Teamlid',
    standaard: false,
    fromName: rij.from_name || '',
    handtekening: rij.handtekening || '',
    leesbaar: wachtwoord !== null,
    eigenaarId: rij.eigenaar_id,
    volgorde: rij.volgorde ?? 0,
    soort: 'mailbox',
    geverifieerdOp: rij.geverifieerd_op,
    gekoppeldOp: rij.gekoppeld_op,
    imapHost: rij.imap_host,
    imapPort: rij.imap_port,
    smtpHost: rij.smtp_host,
    smtpPort: rij.smtp_port,
    cfg: wachtwoord === null ? null : configUitRij(rij, wachtwoord)
  };
}

function uitOudeRij(lid: Teamlid, rij: MailboxRij): Mailbox {
  const wachtwoord = ontsleutel(rij.wachtwoord_enc, lid.userId);
  return {
    id: OUDE_MAILBOX_ID,
    label: standaardLabel(rij.email),
    email: rij.email,
    kleur: lid.profiel.kleur,
    zichtbaarheid: 'prive',
    vanMij: true,
    eigenaarNaam: lid.profiel.naam,
    standaard: false,
    fromName: rij.from_name || '',
    handtekening: rij.handtekening || '',
    leesbaar: wachtwoord !== null,
    eigenaarId: lid.userId,
    volgorde: 0,
    soort: 'oud',
    geverifieerdOp: rij.geverifieerd_op,
    gekoppeldOp: rij.updated_at,
    imapHost: rij.imap_host,
    imapPort: rij.imap_port,
    smtpHost: rij.smtp_host,
    smtpPort: rij.smtp_port,
    cfg: wachtwoord === null ? null : configUitRij(rij, wachtwoord)
  };
}

function envMailbox(lid: Teamlid, cfg: MailConfig): Mailbox {
  return {
    id: ENV_MAILBOX_ID,
    label: 'Studio Levant (standaard)',
    email: cfg.user,
    kleur: '#c8a97e',
    zichtbaarheid: 'prive',
    vanMij: true,
    eigenaarNaam: lid.profiel.naam,
    standaard: true,
    fromName: cfg.fromName,
    handtekening: cfg.handtekening,
    leesbaar: true,
    eigenaarId: lid.userId,
    volgorde: 0,
    soort: 'env',
    geverifieerdOp: null,
    gekoppeldOp: null,
    imapHost: cfg.imapHost,
    imapPort: cfg.imapPort,
    smtpHost: cfg.smtpHost,
    smtpPort: cfg.smtpPort,
    cfg
  };
}

/** De actieve teamleden en de namen van het team (RLS: alleen wat een teamlid mag zien). */
async function teamInfo(lid: Teamlid): Promise<{ actief: Set<string>; namen: Map<string, string> }> {
  const profielen = await teamProfielen(lid);
  return {
    actief: new Set(profielen.filter((p) => p.actief).map((p) => p.id)),
    namen: new Map(profielen.map((p) => [p.id, p.naam]))
  };
}

async function laad(lid: Teamlid): Promise<{ waarde: ZichtbareMailboxen; bewaren: boolean }> {
  let magEnv = false;
  try {
    magEnv = await magEnvMailbox(lid);
  } catch {
    magEnv = false;
  }
  const env = magEnv ? envMailConfig() : null;
  const metEnv = (lijst: Mailbox[]) => {
    // Heb je hetzelfde adres zelf gekoppeld, dan telt alleen die koppeling.
    if (env && !lijst.some((m) => m.vanMij && m.email.toLowerCase() === env.user.toLowerCase())) lijst.push(envMailbox(lid, env));
    return sorteerInboxen(lijst);
  };

  if (lid.overgang) return { waarde: { lijst: metEnv([]), opslag: 'geen' }, bewaren: true };

  const { data, error } = await createServiceRoleClient(lid.bewijs)
    .from('mailboxen')
    .select(MAILBOXEN_KOLOMMEN)
    .or(`eigenaar_id.eq.${lid.userId},zichtbaarheid.eq.team`)
    .order('volgorde', { ascending: true })
    .order('gekoppeld_op', { ascending: true })
    .limit(200);

  if (error) {
    if (!tabelOntbreekt(error)) {
      console.error('[mail] inboxen ophalen mislukt', error.code ?? '');
      // Storing: liever de standaard-mailbox (als die van jou is) dan niets, en niet onthouden.
      return { waarde: { lijst: metEnv([]), opslag: 'nieuw' }, bewaren: false };
    }
    // Vóór 0026: precies zoals daarvoor — de ene eigen mailbox uit user_mailboxes, en alleen
    // zonder eigen mailbox (of als die niet te ontsleutelen is) de standaard-mailbox.
    try {
      const { rij, ingericht } = await eigenMailboxRij(lid);
      const eigen = rij ? uitOudeRij(lid, rij) : null;
      const lijst = eigen?.cfg ? [eigen] : metEnv(eigen ? [eigen] : []);
      return { waarde: { lijst, opslag: ingericht ? 'oud' : 'geen' }, bewaren: true };
    } catch {
      return { waarde: { lijst: metEnv([]), opslag: 'oud' }, bewaren: false };
    }
  }

  const rijen = (data ?? []) as unknown as MailboxenRij[];
  const anderen = rijen.some((r) => r.eigenaar_id !== lid.userId);
  const team = anderen ? await teamInfo(lid) : { actief: new Set([lid.userId]), namen: new Map<string, string>() };
  team.namen.set(lid.userId, lid.profiel.naam);
  const lijst = rijen.filter((r) => isZichtbaar(r, lid.userId, team.actief)).map((r) => uitRij(r, lid.userId, team.namen));
  return { waarde: { lijst: metEnv(lijst), opslag: 'nieuw' }, bewaren: true };
}

// Korte cache per kijker (per serverinstantie): Mail, de rail-badge en het dashboard vragen
// de inboxen vaak op. Elke wijziging (koppelen, delen, ontkoppelen) wist de HELE cache
// (vergeetMailboxen), want een gedeelde inbox hoort bij meerdere kijkers. Op een andere
// serverinstantie is een wijziging hooguit MAILBOX_CACHE_MS oud.
export const MAILBOX_CACHE_MS = 30_000;
const cache = new Map<string, { tot: number; waarde: ZichtbareMailboxen }>();

/** Wist de gecachete inboxen van iedereen (na koppelen, wijzigen of ontkoppelen). */
export function vergeetMailboxen(): void {
  cache.clear();
}

/** Alle inboxen die dit teamlid mag zien (zie boven), in de volgorde van Mail. */
export async function zichtbareMailboxen(lid: Teamlid): Promise<ZichtbareMailboxen> {
  const sleutel = `${lid.userId}:${lid.overgang ? 'o' : 't'}`;
  const nu = Date.now();
  const hit = cache.get(sleutel);
  if (hit && hit.tot > nu) return hit.waarde;
  const { waarde, bewaren } = await laad(lid);
  if (bewaren) {
    if (cache.size > 100) cache.clear();
    cache.set(sleutel, { tot: nu + MAILBOX_CACHE_MS, waarde });
  }
  return waarde;
}

/** De standaardkeuze: de eerste inbox die werkt, anders de eerste. */
export function eersteMailbox(lijst: Mailbox[]): Mailbox | null {
  return lijst.find((m) => m.cfg) ?? lijst[0] ?? null;
}

/**
 * Eén inbox van dit teamlid: met `id` precies die (null als hij niet bestaat of niet
 * zichtbaar is — nooit die van een ander die niet gedeeld is), zonder `id` de standaard.
 */
export async function mailboxVoor(lid: Teamlid, id?: string | null): Promise<Mailbox | null> {
  const { lijst } = await zichtbareMailboxen(lid);
  if (!id) return eersteMailbox(lijst);
  return lijst.find((m) => m.id === id) ?? null;
}

/** De verbinding van de standaard-inbox van dit teamlid, of null ("niet gekoppeld"). */
export async function mailConfigVoor(lid: Teamlid, id?: string | null): Promise<MailConfig | null> {
  return (await mailboxVoor(lid, id))?.cfg ?? null;
}

/** De inboxen voor de browser (zonder wachtwoord of servers). */
export function inboxenDto(lijst: Mailbox[]): InboxDto[] {
  return lijst.map(naarDto);
}
