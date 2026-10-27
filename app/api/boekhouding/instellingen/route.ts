import { bkRoute } from '@/lib/boekhouding/api';
import { instellingenActie } from '@/lib/boekhouding/acties-jaar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH /api/boekhouding/instellingen  { bedrijfsnaam?, kvk?, btwNummer?, startdatum? } → { instellingen }
export const PATCH = bkRoute(async (request, _ctx, { repo }) => instellingenActie(request, repo));
