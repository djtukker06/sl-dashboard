import { teamlidRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { KoppelFout, ontkoppel } from '@/lib/social/koppeling';
import { fout, json } from '@/lib/social/meta/api';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/social/accounts/[id] → { ok: true }. Ontkoppelen: het token wordt gewist en het
// account inactief; geplaatste posts en hun cijfers blijven bewaard. Ingeplande posts op dit
// account krijgen een melding en worden daar niet meer geplaatst. Toegang intrekken bij Meta
// zelf doe je in Facebook: Instellingen → Bedrijfsintegraties (zie README).
export const DELETE = teamlidRoute<Ctx>(async (request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Account niet gevonden.');
  try {
    const rij = await ontkoppel(createServiceRoleClient(lid.bewijs), id);
    if (!rij) return fout(404, 'Account niet gevonden.');
    await logAudit('social_ontkoppeld', { lid, details: { soort: rij.platform, naam: rij.gebruikersnaam ?? rij.naam } }, request);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof KoppelFout) return fout(503, e.message, e.code);
    throw e;
  }
}, { label: 'social-accounts' });
