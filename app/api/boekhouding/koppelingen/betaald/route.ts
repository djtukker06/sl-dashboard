import { bkRoute } from '@/lib/boekhouding/api';
import { documentBetaaldActie } from '@/lib/boekhouding/acties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/boekhouding/koppelingen/betaald  { bron: 'factuur'|'uitgave', bronId, datum, rekeningId?, bedrag? }
//   → { boeking, koppeling }   "Betaald boeken": maakt de bankregel uit de factuur of het
//   bonnetje (openstaand bedrag, of een deel) en koppelt hem meteen.
export const POST = bkRoute((request, _ctx, { repo }) => documentBetaaldActie(request, repo));
