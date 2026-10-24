import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

// De kern van de back-ups: het versleutelde bestandsformaat, de vaste tabellenlijst en de
// controle van een database-export. Zonder env, database of '@/'-imports, zodat de scripts
// (backup-controleren.mjs, backup-herstellen.mjs, test-backup.mjs) dit direct kunnen laden.
//
// Bestandsformaat (.slbak voor de database, .slenc voor een los storage-bestand):
//
//   "SLBAK" | 0x01 | uint32 BE headerlengte | header-JSON (UTF-8) | ciphertext | 16-byte GCM-tag
//
//   header = { v:1, alg:"AES-256-GCM", iv:<base64, 12 bytes>, sleutelId:<16 hex>,
//              soort:"db"|"bestand", gemaakt:ISO, bron:<supabase-host>, gzip:true,
//              sha256:<hex van gzip(plaintext)>, grootte:<bytes plaintext>, pad?:<bucket/pad> }
//
//   - AES-256-GCM met BACKUP_ENCRYPTION_KEY (32 bytes, base64; los van de mailsleutel);
//   - AAD = de volledige header-bytes: elke wijziging aan de header (ook het pad van een
//     bestand of de bron) laat het ontsleutelen falen, net als aan ciphertext of tag;
//   - sleutelId = eerste 16 hex van sha256("sl-backup-key-id" ‖ sleutel): zo zie je zonder
//     te ontsleutelen met welke sleutel een bestand is gemaakt (en de sleutel zelf lekt niet);
//   - de plaintext wordt eerst met gzip ingepakt; sha256 is over die gzip-bytes.

export const MAGIC = Buffer.from('SLBAK', 'ascii');
export const VERSIE = 1;
export const EXTENSIE_DB = '.slbak';
export const EXTENSIE_BESTAND = '.slenc';
const MAX_HEADER = 64 * 1024;

export type BackupSoort = 'db' | 'bestand';

export interface BackupHeader {
  v: 1;
  alg: 'AES-256-GCM';
  iv: string;
  sleutelId: string;
  soort: BackupSoort;
  gemaakt: string;
  bron: string;
  gzip: true;
  sha256: string;
  grootte: number;
  pad?: string;
}

export class BackupFout extends Error {
  code: string;
  constructor(code: string, bericht: string) {
    super(bericht);
    this.name = 'BackupFout';
    this.code = code;
  }
}

/** 32 bytes uit base64 (`openssl rand -base64 32`), anders null. */
export function leesBackupSleutel(waarde: string | undefined | null): Buffer | null {
  if (!waarde) return null;
  const s = waarde.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  const k = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return k.length === 32 ? k : null;
}

export function sleutelIdVan(sleutel: Buffer): string {
  return createHash('sha256').update('sl-backup-key-id').update(sleutel).digest('hex').slice(0, 16);
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Alleen de host van de Supabase-URL (bv. abcd.supabase.co), nooit sleutels. */
export function bronVan(supabaseUrl: string | undefined | null): string {
  try {
    return new URL(String(supabaseUrl ?? '')).host || 'onbekend';
  } catch {
    return 'onbekend';
  }
}

export function versleutel(
  sleutel: Buffer,
  plaintext: Uint8Array,
  meta: { soort: BackupSoort; bron: string; pad?: string; gemaakt?: Date }
): { bestand: Buffer; header: BackupHeader } {
  if (sleutel.length !== 32) throw new BackupFout('sleutel', 'Ongeldige back-upsleutel.');
  const ingepakt = gzipSync(plaintext);
  const iv = randomBytes(12);
  const header: BackupHeader = {
    v: 1,
    alg: 'AES-256-GCM',
    iv: iv.toString('base64'),
    sleutelId: sleutelIdVan(sleutel),
    soort: meta.soort,
    gemaakt: (meta.gemaakt ?? new Date()).toISOString(),
    bron: meta.bron,
    gzip: true,
    sha256: sha256Hex(ingepakt),
    grootte: plaintext.length
  };
  if (meta.pad) header.pad = meta.pad;
  const kop = Buffer.from(JSON.stringify(header), 'utf8');
  const c = createCipheriv('aes-256-gcm', sleutel, iv);
  c.setAAD(kop);
  const ct = Buffer.concat([c.update(ingepakt), c.final()]);
  const tag = c.getAuthTag();
  const lengte = Buffer.alloc(4);
  lengte.writeUInt32BE(kop.length, 0);
  return { bestand: Buffer.concat([MAGIC, Buffer.from([VERSIE]), lengte, kop, ct, tag]), header };
}

/** Leest alleen de header (zonder sleutel); gooit bij een ander formaat. */
export function leesHeader(bestand: Uint8Array): { header: BackupHeader; kop: Buffer; start: number } {
  const b = Buffer.from(bestand.buffer, bestand.byteOffset, bestand.byteLength);
  if (b.length < MAGIC.length + 1 + 4 + 2 + 16 || !b.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupFout('formaat', 'Geen Studio Levant-back-up (onbekend formaat).');
  }
  if (b[MAGIC.length] !== VERSIE) throw new BackupFout('versie', `Onbekende versie van het back-upformaat (${b[MAGIC.length]}).`);
  const n = b.readUInt32BE(MAGIC.length + 1);
  const start = MAGIC.length + 1 + 4;
  if (n < 2 || n > MAX_HEADER || start + n + 16 > b.length) throw new BackupFout('formaat', 'Beschadigde back-up (header).');
  const kop = b.subarray(start, start + n);
  let header: BackupHeader;
  try {
    header = JSON.parse(kop.toString('utf8')) as BackupHeader;
  } catch {
    throw new BackupFout('formaat', 'Beschadigde back-up (header).');
  }
  if (!header || header.v !== 1 || header.alg !== 'AES-256-GCM' || typeof header.iv !== 'string' || !/^[0-9a-f]{16}$/.test(String(header.sleutelId))) {
    throw new BackupFout('formaat', 'Beschadigde back-up (header).');
  }
  if (header.soort !== 'db' && header.soort !== 'bestand') throw new BackupFout('formaat', 'Onbekende soort back-up.');
  return { header, kop: Buffer.from(kop), start: start + n };
}

/**
 * Ontsleutelt en controleert: magic, versie, sleutel-id, GCM-tag (dus ook geknoei aan de
 * header) en sha256. Geeft de header en de oorspronkelijke bytes.
 */
export function ontsleutel(sleutel: Buffer, bestand: Uint8Array): { header: BackupHeader; plaintext: Buffer } {
  const { header, kop, start } = leesHeader(bestand);
  if (sleutel.length !== 32) throw new BackupFout('sleutel', 'Ongeldige back-upsleutel.');
  if (sleutelIdVan(sleutel) !== header.sleutelId) {
    throw new BackupFout('verkeerde_sleutel', 'Deze back-up is met een andere sleutel gemaakt (sleutel-id klopt niet).');
  }
  const b = Buffer.from(bestand.buffer, bestand.byteOffset, bestand.byteLength);
  const iv = Buffer.from(header.iv, 'base64');
  if (iv.length !== 12) throw new BackupFout('formaat', 'Beschadigde back-up (iv).');
  const ct = b.subarray(start, b.length - 16);
  const tag = b.subarray(b.length - 16);
  let ingepakt: Buffer;
  try {
    const d = createDecipheriv('aes-256-gcm', sleutel, iv);
    d.setAAD(kop);
    d.setAuthTag(tag);
    ingepakt = Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new BackupFout('geknoeid', 'Ontsleutelen mislukt: het bestand is beschadigd of gewijzigd.');
  }
  if (sha256Hex(ingepakt) !== header.sha256) throw new BackupFout('controlesom', 'Controlesom klopt niet.');
  let plaintext: Buffer;
  try {
    plaintext = gunzipSync(ingepakt);
  } catch {
    throw new BackupFout('formaat', 'Uitpakken mislukt.');
  }
  if (plaintext.length !== header.grootte) throw new BackupFout('controlesom', 'Grootte klopt niet.');
  return { header, plaintext };
}

// ---------------------------------------------------------------------------------
// De tabellen in de database-export, in foreign-key-volgorde (herstellen gaat in deze
// volgorde; verwijderen in omgekeerde). `pk` = primaire sleutel (voor sorteren, vergelijken en
// upsert), `zonder` = gegenereerde kolommen die bij herstellen niet geschreven mogen worden,
// `alleenToevoegen` = nooit overschrijven (audit_log is onveranderbaar).
// inlog_pogingen gaat bewust niet mee (vluchtig, alleen hashes).
// ---------------------------------------------------------------------------------
export interface TabelDef {
  naam: string;
  pk: string[];
  zonder?: string[];
  alleenToevoegen?: boolean;
  /** Kolom die naar dezelfde tabel verwijst: bij herstellen eerst leeg, daarna invullen. */
  zelfVerwijzing?: string;
}

export const TABELLEN: TabelDef[] = [
  { naam: 'profiles', pk: ['id'] },
  { naam: 'team_members', pk: ['user_id'] },
  { naam: 'clients', pk: ['id'], zonder: ['company_name_normalized'] },
  { naam: 'client_notes', pk: ['id'] },
  { naam: 'projects', pk: ['id'] },
  { naam: 'project_eigenaren', pk: ['project_id', 'user_id'] },
  { naam: 'invoice_counters', pk: ['year'] },
  { naam: 'quotes', pk: ['id'] },
  { naam: 'invoices', pk: ['id'], zelfVerwijzing: 'remainder_of_invoice_id' },
  { naam: 'expenses', pk: ['id'] },
  { naam: 'expense_files', pk: ['id'] },
  { naam: 'calendar_events', pk: ['id'] },
  { naam: 'event_attendees', pk: ['event_id', 'user_id'] },
  { naam: 'tasks', pk: ['id'] },
  { naam: 'task_assignees', pk: ['task_id', 'user_id'] },
  { naam: 'task_subtasks', pk: ['id'] },
  { naam: 'social_brand', pk: ['id'] },
  { naam: 'social_projects', pk: ['id'] },
  { naam: 'social_slides', pk: ['project_id', 'file'] },
  { naam: 'social_versions', pk: ['id'] },
  { naam: 'drive_koppeling', pk: ['id'] },
  { naam: 'drive_mappen', pk: ['root_id', 'soort', 'sleutel'] },
  { naam: 'drive_kopieen', pk: ['root_id', 'bron', 'bron_id'] },
  { naam: 'drive_bestanden', pk: ['drive_file_id'] },
  { naam: 'user_mailboxes', pk: ['user_id'] },
  { naam: 'mailboxen', pk: ['id'] },
  { naam: 'app_instellingen', pk: ['id'] },
  { naam: 'audit_log', pk: ['id'], alleenToevoegen: true },
  { naam: 'backup_runs', pk: ['id'] },
  { naam: 'backup_bestanden', pk: ['bucket', 'pad'] },
  { naam: 'heartbeat', pk: ['id'] }
];

/** Tabellen die bewust niet in de export staan. */
export const NIET_EXPORTEREN = new Set(['inlog_pogingen']);

/** Storage-buckets in de back-up. mail-tmp en uitgaven-export zijn tijdelijk. */
export const BUCKETS = ['invoices', 'uitgaven', 'social-assets'] as const;

export interface DbTabelExport {
  pk: string[];
  rijen: Record<string, unknown>[];
  aantal: number;
  sha256: string;
}

export interface StorageItem {
  pad: string;
  grootte: number | null;
  bijgewerkt: string | null;
  mime: string | null;
  etag: string | null;
}

export interface DbExport {
  formaat: 'sl-db-export';
  versie: 1;
  gemaakt: string;
  migratie: string;
  tabellen: Record<string, DbTabelExport>;
  /** Tabellen die er (nog) niet zijn (migratie niet uitgevoerd). */
  ontbrekend?: string[];
  gebruikers: { id: string; email: string | null; created_at: string | null; email_confirmed_at: string | null }[];
  storage: Record<string, StorageItem[]>;
}

/** sha256 over de rijen van één tabel (stabiel: JSON van de rijen in pk-volgorde). */
export function rijenHash(rijen: Record<string, unknown>[]): string {
  return sha256Hex(JSON.stringify(rijen));
}

/** Zet een export om naar bytes (UTF-8 JSON). */
export function exportNaarBytes(e: DbExport): Buffer {
  return Buffer.from(JSON.stringify(e), 'utf8');
}

/**
 * Controleert de structuur van een ontsleutelde database-export: formaat, versie, per tabel
 * pk, aantal en sha256. Geeft tellingen per tabel en een lijst problemen (leeg = in orde).
 */
export function controleerExport(data: unknown): { tellingen: Record<string, number>; problemen: string[]; export: DbExport | null } {
  const problemen: string[] = [];
  const tellingen: Record<string, number> = {};
  const e = data as DbExport;
  if (!e || typeof e !== 'object' || e.formaat !== 'sl-db-export') return { tellingen, problemen: ['geen database-export'], export: null };
  if (e.versie !== 1) problemen.push(`onbekende exportversie ${String(e.versie)}`);
  if (!e.tabellen || typeof e.tabellen !== 'object') return { tellingen, problemen: [...problemen, 'tabellen ontbreken'], export: null };
  for (const [naam, t] of Object.entries(e.tabellen)) {
    if (!/^[a-z0-9_]{1,63}$/.test(naam)) {
      problemen.push(`ongeldige tabelnaam`);
      continue;
    }
    if (!t || !Array.isArray(t.rijen) || !Array.isArray(t.pk)) {
      problemen.push(`${naam}: geen rijen`);
      continue;
    }
    tellingen[naam] = t.rijen.length;
    if (t.aantal !== t.rijen.length) problemen.push(`${naam}: aantal klopt niet (${t.aantal} ≠ ${t.rijen.length})`);
    if (t.sha256 !== rijenHash(t.rijen)) problemen.push(`${naam}: controlesom klopt niet`);
  }
  for (const def of TABELLEN) {
    if (!e.tabellen[def.naam] && !(e.ontbrekend ?? []).includes(def.naam)) problemen.push(`${def.naam}: ontbreekt in de export`);
  }
  if (!Array.isArray(e.gebruikers)) problemen.push('gebruikers ontbreken');
  if (!e.storage || typeof e.storage !== 'object') problemen.push('storage-overzicht ontbreekt');
  return { tellingen, problemen, export: e };
}

/** Bestandsnaam van een database-back-up: <YYYY-MM-DD>.slbak, handmatig <datum>-handmatig-<HHmm>.slbak (Europe/Amsterdam). */
export function backupNaam(nu: Date, handmatig: boolean): string {
  const delen = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(nu);
  const d = Object.fromEntries(delen.map((p) => [p.type, p.value]));
  const datum = `${d.year}-${d.month}-${d.day}`;
  return handmatig ? `${datum}-handmatig-${d.hour}${d.minute}${EXTENSIE_DB}` : `${datum}${EXTENSIE_DB}`;
}

/** Naam in Drive voor een storage-bestand: het pad plat (mapjes met "__"), plus .slenc. */
export function bestandNaamInDrive(pad: string): string {
  const plat = pad.replace(/^\/+/, '').split('/').filter(Boolean).join('__');
  return `${plat.slice(0, 200) || 'bestand'}${EXTENSIE_BESTAND}`;
}

/** Een korte, veilige foutmelding voor backup_runs (geen data, geen tokens). */
export function korteFout(e: unknown): string {
  const raw = e instanceof Error ? `${e.name === 'Error' ? '' : `${e.name}: `}${e.message}` : String(e ?? 'onbekende fout');
  return raw
    .replace(/(token|sig|signature|apikey|key|secret|password|authorization)=([^&\s]+)/gi, '$1=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, '<e-mail>')
    .slice(0, 300);
}
