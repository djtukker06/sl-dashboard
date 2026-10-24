import { bkRoute } from '@/lib/boekhouding/api';
import { bronExtraActie } from '@/lib/boekhouding/acties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/boekhouding/bron-extra  { bron: 'factuur'|'uitgave', bronId, btwCode?, grootboek?, vennootId?, notitie? }
//   → { bronExtra }   Boekhoudkundige verfijning van een factuur of bonnetje (andere btw-rubriek,
//   categorie of vennoot) ZONDER de factuur of het bonnetje zelf te wijzigen. null = standaard.
export const POST = bkRoute((request, _ctx, { repo }) => bronExtraActie(request, repo));
