import { teamlidRoute } from '@/lib/auth/team';
import { isUuid } from '@/lib/agenda/invoer';
import { leesBody } from '@/lib/agenda/api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { appleStatus, wijzigAgenda } from '@/lib/apple-agenda/koppeling';
import { appleFoutAntwoord, fout, json } from '@/lib/apple-agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/apple-agenda/agendas/[id]  { zichtbaar?, kleur? } → ExternStatus
export const PATCH = teamlidRoute<Ctx>(async (request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Niet gevonden.');
  const body = await leesBody<{ zichtbaar?: unknown; kleur?: unknown }>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const service = createServiceRoleClient(lid.bewijs);
  try {
    await wijzigAgenda(service, lid.userId, id, {
      zichtbaar: typeof body.zichtbaar === 'boolean' ? body.zichtbaar : undefined,
      kleur: typeof body.kleur === 'string' ? body.kleur.toLowerCase() : undefined
    });
    const s = await appleStatus(service, lid.userId);
    return json({ apple: s.status, google: null, accounts: s.accounts });
  } catch (e) {
    return appleFoutAntwoord(e);
  }
}, { label: 'apple-agenda' });
