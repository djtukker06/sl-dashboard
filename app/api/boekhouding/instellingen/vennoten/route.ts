import { bkRoute } from '@/lib/boekhouding/api';
import { aandelenActie } from '@/lib/boekhouding/acties-jaar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH /api/boekhouding/instellingen/vennoten  { aandelen: [{ id, aandeel }] } → { ok }
//   De winstverdeling (samen 100%). Alleen de eigenaar (2FA); de database dwingt dat ook af.
export const PATCH = bkRoute(async (request, _ctx, { repo }) => aandelenActie(request, repo), { alleenEigenaar: true });
