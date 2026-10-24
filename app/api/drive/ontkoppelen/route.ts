import { driveRoute, json } from '@/lib/drive/api';
import { ontsleutelToken } from '@/lib/drive/config';
import { trekIn } from '@/lib/drive/kern';
import { leesKoppeling, vergeetToken } from '@/lib/drive/koppeling';
import { vergeetMappen } from '@/lib/drive/mappen';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/drive/ontkoppelen (alleen de eigenaar): toestemming bij Google intrekken (best
// effort) en de koppeling verwijderen. De bestanden in Drive blijven gewoon staan; de
// mappen-cache en de kopie-administratie zijn per rootmap, dus opnieuw koppelen met
// hetzelfde account gaat verder waar het was (geen dubbele kopieën).
export const POST = driveRoute(
  async (request, _ctx, lid) => {
    const service = createServiceRoleClient(lid.bewijs);
    const k = await leesKoppeling(service);
    if (k) {
      const token = ontsleutelToken(k.refresh_token_enc);
      if (token) await trekIn(fetch, token);
      const { error } = await service.from('drive_koppeling').delete().eq('id', 1);
      if (error) throw error;
    }
    vergeetToken();
    vergeetMappen();
    await logAudit('drive_ontkoppeld', { lid }, request);
    return json({ ok: true });
  },
  { alleenEigenaar: true }
);
