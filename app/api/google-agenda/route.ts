import { teamlidRoute } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { googleStatus } from '@/lib/google-agenda/koppeling';
import { googleFoutAntwoord, json } from '@/lib/google-agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/google-agenda → GoogleStatus: je gekoppelde Google-accounts en hun agenda's
// (naam, kleur, tonen, in de agenda-link). Nooit tokens.
export const GET = teamlidRoute(async (_request, _ctx, lid) => {
  try {
    return json(await googleStatus(createServiceRoleClient(lid.bewijs), lid.userId));
  } catch (e) {
    return googleFoutAntwoord(e);
  }
}, { label: 'google-agenda' });
