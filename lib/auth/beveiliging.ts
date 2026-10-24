import 'server-only';
import type { Teamlid } from './team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';

// Gegevens voor de eigenaarspagina /beveiliging: wie heeft 2FA, wanneer voor het laatst
// ingelogd. Alleen aan te roepen na eigenaarRoute / een eigenaarscheck met aal2.

export interface LidBeveiliging {
  userId: string;
  naam: string;
  email: string;
  rol: 'eigenaar' | 'lid';
  actief: boolean;
  factoren: number;
  laatstIngelogd: string | null;
  zelf: boolean;
}

export async function teamBeveiliging(lid: Teamlid): Promise<LidBeveiliging[]> {
  const sb = createServiceRoleClient(lid.bewijs);
  const [ledenRes, profielRes, usersRes] = await Promise.all([
    sb.from('team_members').select('user_id, actief, rol').limit(200),
    sb.from('profiles').select('id, naam').limit(200),
    sb.auth.admin.listUsers({ page: 1, perPage: 200 })
  ]);
  if (ledenRes.error) throw ledenRes.error;
  const namen = new Map(((profielRes.data ?? []) as { id: string; naam: string }[]).map((p) => [p.id, p.naam]));
  const users = new Map((usersRes.data?.users ?? []).map((u) => [u.id, u]));
  return ((ledenRes.data ?? []) as { user_id: string; actief: boolean; rol: string }[])
    .map((m) => {
      const u = users.get(m.user_id);
      return {
        userId: m.user_id,
        naam: namen.get(m.user_id) || (u?.email ?? '').split('@')[0] || 'Teamlid',
        email: u?.email ?? '',
        rol: m.rol === 'eigenaar' ? ('eigenaar' as const) : ('lid' as const),
        actief: m.actief === true,
        factoren: (u?.factors ?? []).filter((f) => f.status === 'verified').length,
        laatstIngelogd: u?.last_sign_in_at ?? null,
        zelf: m.user_id === lid.userId
      };
    })
    .sort((a, b) => Number(b.actief) - Number(a.actief) || (a.rol === 'eigenaar' ? -1 : 1) - (b.rol === 'eigenaar' ? -1 : 1) || a.naam.localeCompare(b.naam, 'nl'));
}

export interface AuditRegel {
  id: number;
  op: string;
  userId: string | null;
  naam: string | null;
  actie: string;
  doel: string | null;
  details: Record<string, unknown>;
  bron: string;
  ip: string | null;
}

export const AUDIT_PER_PAGINA = 100;

/** Audit-log lezen met de gebruikerscliënt: RLS (is_eigenaar) beslist mee. */
export async function leesAudit(
  lid: Teamlid,
  filter: { actie?: string; gebruiker?: string; pagina?: number }
): Promise<{ ontbreekt: true } | { ontbreekt: false; regels: AuditRegel[]; meer: boolean }> {
  const pagina = Math.max(0, Math.min(1000, Math.floor(filter.pagina ?? 0)));
  let q = lid.sb
    .from('audit_log')
    .select('id, op, user_id, actie, doel, details, bron, ip_hash')
    .order('op', { ascending: false })
    .order('id', { ascending: false })
    .range(pagina * AUDIT_PER_PAGINA, pagina * AUDIT_PER_PAGINA + AUDIT_PER_PAGINA);
  if (filter.actie) {
    // Een groep ("2fa", "mailbox", "inloggen") of een exacte actie.
    if (/^[a-z0-9]{2,20}$/.test(filter.actie) && !filter.actie.includes('_')) q = q.like('actie', `${filter.actie}%`);
    else if (/^[a-z0-9_]{2,60}$/.test(filter.actie)) q = q.eq('actie', filter.actie);
  }
  if (filter.gebruiker && /^[0-9a-f-]{36}$/i.test(filter.gebruiker)) q = q.eq('user_id', filter.gebruiker);
  const { data, error } = await q;
  if (error) {
    if (tabelOntbreekt(error)) return { ontbreekt: true };
    throw error;
  }
  const rijen = (data ?? []) as { id: number; op: string; user_id: string | null; actie: string; doel: string | null; details: Record<string, unknown> | null; bron: string; ip_hash: string | null }[];
  const namen = new Map((lid.team?.profielen ?? []).map((p) => [p.id, p.naam ?? null]));
  return {
    ontbreekt: false,
    meer: rijen.length > AUDIT_PER_PAGINA,
    regels: rijen.slice(0, AUDIT_PER_PAGINA).map((r) => ({
      id: r.id,
      op: r.op,
      userId: r.user_id,
      naam: r.user_id ? (namen.get(r.user_id) ?? null) : null,
      actie: r.actie,
      doel: r.doel,
      details: r.details ?? {},
      bron: r.bron,
      // Alleen een kort stukje van de hash: genoeg om "zelfde apparaat/netwerk" te zien.
      ip: r.ip_hash ? r.ip_hash.slice(0, 8) : null
    }))
  };
}
