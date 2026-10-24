import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';

// Audit-log van gevoelige acties (tabel audit_log, migratie 0026; alleen de eigenaar kan hem
// lezen). Altijd "best effort": een ontbrekende tabel (0026 nog niet uitgevoerd) of een
// storing blokkeert de actie zelf nooit. In `details` alleen een vaste lijst sleutels met
// korte waarden — nooit wachtwoorden, tokens of mailinhoud.

export type AuditActie =
  | 'mailbox_gekoppeld'
  | 'mailbox_gewijzigd'
  | 'mailbox_zichtbaarheid'
  | 'mailbox_ontkoppeld'
  | (string & {});

const TOEGESTAAN = new Set(['mailbox', 'adres', 'label', 'zichtbaarheid', 'van', 'naar', 'aantal', 'soort', 'reden', 'bron', 'velden']);

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

export async function logAudit(
  actie: AuditActie,
  opties: { lid: Teamlid; doel?: string; details?: Record<string, unknown> },
  request?: Request
): Promise<void> {
  try {
    const { lid } = opties;
    if (lid.overgang) return;
    const { error } = await createServiceRoleClient(lid.bewijs)
      .from('audit_log')
      .insert({
        user_id: lid.userId,
        actie,
        doel: opties.doel?.slice(0, 200) ?? null,
        details: saneerDetails(opties.details),
        ua: request?.headers.get('user-agent')?.slice(0, 120) ?? null
      });
    if (error && !tabelOntbreekt(error)) console.error('[audit] vastleggen mislukt', error.code ?? '');
  } catch {
    /* nooit de actie zelf laten mislukken */
  }
}
