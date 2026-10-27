import { bkRoute } from '@/lib/boekhouding/api';
import { koppelActie, ontkoppelActie } from '@/lib/boekhouding/acties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/boekhouding/koppelingen  { boekingId, bron: 'factuur'|'uitgave', bronId, bedrag? }
//   → { koppeling }   Een bankregel afletteren tegen een factuur of bonnetje. Zonder bedrag:
//   het kleinste van wat de bankregel nog over heeft en wat er open staat (deelbetaling kan).
//   De factuur of het bonnetje zelf verandert niet; de koppeling staat in bk_koppelingen.
export const POST = bkRoute((request, _ctx, { repo }) => koppelActie(request, repo));

// DELETE /api/boekhouding/koppelingen?id=  → { ok }   Ontkoppelen (de betaling staat weer los).
export const DELETE = bkRoute((request, _ctx, { repo }) => ontkoppelActie(request, repo));
