import 'server-only';
import { systeemClient } from '@/lib/supabase/systeem';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { ipHash } from '@/lib/auth/hash';
import { logFout } from '@/lib/log';

// Audit-log van gevoelige acties (tabel audit_log, migratie 0026; alleen de eigenaar kan hem
// lezen, niemand kan hem wijzigen). Altijd "best effort": een ontbrekende tabel (0026 nog
// niet uitgevoerd) of een storing blokkeert de actie zelf nooit. In `details` alleen een vaste
// lijst sleutels met korte waarden — nooit wachtwoorden, tokens, codes of mailinhoud. Het
// IP-adres alleen als gepeperde hash.

export type AuditActie =
  | 'inloggen'
  | 'inloggen_mislukt'
  | 'inlog_geblokkeerd'
  | 'uitloggen'
  | 'sessie_verlopen'
  | '2fa_ingeschreven'
  | '2fa_verwijderd'
  | '2fa_gelukt'
  | '2fa_mislukt'
  | '2fa_geblokkeerd'
  | '2fa_reset_door_eigenaar'
  | 'wachtwoord_gewijzigd'
  | 'wachtwoord_herstel_aangevraagd'
  | 'mailbox_gekoppeld'
  | 'mailbox_gewijzigd'
  | 'mailbox_zichtbaarheid'
  | 'mailbox_ontkoppeld'
  | 'export_bonnetjes'
  | 'export_social'
  | 'drive_gekoppeld'
  | 'drive_ontkoppeld'
  | 'audit_bekeken'
  | `verwijderd_${string}`
  | `backup_${string}`
  | `cron_${string}`
  | `team_${string}`;

export type AuditBron = 'app' | 'script' | 'cron' | 'github' | 'systeem';

const TOEGESTAAN = new Set([
  'mailbox',
  'adres',
  'label',
  'zichtbaarheid',
  'van',
  'naar',
  'aantal',
  'soort',
  'reden',
  'bron',
  'velden',
  'jaar',
  'kwartaal',
  'factor',
  'methode',
  'status',
  'id',
  'naam'
]);

/** Alleen toegestane sleutels; waarden ingekort, geen geneste objecten. */
export function saneerDetails(details: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const uit: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(details ?? {})) {
    if (!TOEGESTAAN.has(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean') uit[k] = v;
    else if (typeof v === 'string') uit[k] = v.slice(0, 200);
    else if (Array.isArray(v)) uit[k] = v.map(String).join(',').slice(0, 200);
  }
  return uit;
}

export interface AuditOpties {
  /** Wie (user-id). Bij mislukt inloggen: leeg. */
  userId?: string | null;
  /** Een teamlid in de overgangsmodus (vóór 0021) logt niets. */
  overgang?: boolean;
  doel?: string;
  details?: Record<string, unknown>;
  bron?: AuditBron;
}

function kopVan(bron: Request | Headers | undefined): Headers | null {
  if (!bron) return null;
  return bron instanceof Headers ? bron : bron.headers;
}

export async function logAudit(actie: AuditActie, opties: AuditOpties | { lid: { userId: string; overgang?: boolean }; doel?: string; details?: Record<string, unknown> }, request?: Request | Headers): Promise<void> {
  try {
    const o: AuditOpties = 'lid' in opties ? { userId: opties.lid.userId, overgang: opties.lid.overgang, doel: opties.doel, details: opties.details } : opties;
    if (o.overgang) return;
    const kop = kopVan(request);
    const { error } = await systeemClient('audit')
      .from('audit_log')
      .insert({
        user_id: o.userId ?? null,
        actie,
        doel: o.doel?.slice(0, 200) ?? null,
        details: saneerDetails(o.details),
        ip_hash: kop ? ipHash(kop) : null,
        ua: kop?.get('user-agent')?.slice(0, 120) ?? null,
        bron: o.bron ?? 'app'
      });
    if (error && !tabelOntbreekt(error)) logFout('[audit] vastleggen mislukt', error);
  } catch (e) {
    /* nooit de actie zelf laten mislukken */
    logFout('[audit] vastleggen mislukt', e);
  }
}
