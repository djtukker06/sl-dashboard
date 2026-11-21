import { teamlidRoute } from '@/lib/auth/team';
import { isUuid } from '@/lib/agenda/invoer';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { appleStatus, ontkoppel, vernieuwAccount } from '@/lib/apple-agenda/koppeling';
import { appleFoutAntwoord, fout, json } from '@/lib/apple-agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/apple-agenda/accounts/[id] → ExternStatus (de agendalijst opnieuw ophalen)
export const POST = teamlidRoute<Ctx>(async (_request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Niet gevonden.');
  const service = createServiceRoleClient(lid.bewijs);
  try {
    await vernieuwAccount(service, lid.userId, id);
    const s = await appleStatus(service, lid.userId);
    return json({ apple: s.status, google: null, accounts: s.accounts });
  } catch (e) {
    return appleFoutAntwoord(e);
  }
}, { label: 'apple-agenda' });

// DELETE /api/apple-agenda/accounts/[id] → ExternStatus (ontkoppelen; het wachtwoord gaat weg)
export const DELETE = teamlidRoute<Ctx>(async (_request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Niet gevonden.');
  const service = createServiceRoleClient(lid.bewijs);
  try {
    if (!(await ontkoppel(service, lid.userId, id))) return fout(404, 'Dit Apple-account is niet (meer) gekoppeld.');
    const s = await appleStatus(service, lid.userId);
    return json({ apple: s.status, google: null, accounts: s.accounts });
  } catch (e) {
    return appleFoutAntwoord(e);
  }
}, { label: 'apple-agenda' });
