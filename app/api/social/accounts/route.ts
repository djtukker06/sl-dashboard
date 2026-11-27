import { teamlidRoute } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { accountsAntwoord, KoppelFout } from '@/lib/social/koppeling';
import { fout, json } from '@/lib/social/meta/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/social/accounts → AccountsAntwoord: de gekoppelde Instagram-accounts en
// Facebookpagina's (zonder tokens), of Meta is ingericht, en vóór migratie 0041 een melding.
export const GET = teamlidRoute(async (_request, _ctx, lid) => {
  try {
    return json(await accountsAntwoord(createServiceRoleClient(lid.bewijs)));
  } catch (e) {
    if (e instanceof KoppelFout) return fout(503, e.message, e.code);
    throw e;
  }
}, { label: 'social-accounts' });
