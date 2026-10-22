import { json, uitgavenRoute } from '@/lib/uitgaven/api';
import { leveranciers } from '@/lib/uitgaven/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/uitgaven/leveranciers → { leveranciers: [{ naam, categorie, betaaldVia, aantal }] }
// Voor de autocomplete: eerder gebruikte leveranciers met hun laatst gebruikte categorie.
export const GET = uitgavenRoute(async (_request, _ctx, sb) => {
  return json({ leveranciers: await leveranciers(sb) });
});
