import { teamlidRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { accountsVan, feedInGoogle, googleStatus, ontkoppel, synchroniseerLijst } from '@/lib/google-agenda/koppeling';
import { fout, googleFoutAntwoord, json } from '@/lib/google-agenda/api';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST   /api/google-agenda/accounts/[id]  → agendalijst nu opnieuw ophalen → GoogleStatus
// DELETE /api/google-agenda/accounts/[id]  → ontkoppelen (toestemming intrekken) → GoogleStatus
// Alleen je eigen accounts.
export const POST = teamlidRoute<Ctx>(async (_request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Account niet gevonden.');
  const service = createServiceRoleClient(lid.bewijs);
  try {
    const account = (await accountsVan(service, lid.userId)).find((a) => a.id === id);
    if (!account) return fout(404, 'Account niet gevonden.');
    await synchroniseerLijst({ account, service }, { feedInGoogle: await feedInGoogle(service, lid.userId) });
    return json(await googleStatus(service, lid.userId));
  } catch (e) {
    return googleFoutAntwoord(e);
  }
}, { label: 'google-agenda' });

export const DELETE = teamlidRoute<Ctx>(async (request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Account niet gevonden.');
  const service = createServiceRoleClient(lid.bewijs);
  try {
    if (!(await ontkoppel(service, lid.userId, id))) return fout(404, 'Account niet gevonden.');
    await logAudit('google_agenda_ontkoppeld', { lid }, request);
    return json(await googleStatus(service, lid.userId));
  } catch (e) {
    return googleFoutAntwoord(e);
  }
}, { label: 'google-agenda' });
