import { bkRoute } from '@/lib/boekhouding/api';
import { grootboekToevoegenActie, grootboekWijzigenActie } from '@/lib/boekhouding/acties-jaar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST  /api/boekhouding/instellingen/grootboek  { naam, soort: kosten|opbrengst, btw, code? } → { grootboek }
// PATCH /api/boekhouding/instellingen/grootboek  { code, naam?, actief?, btw? } → { grootboek }
//   Eigen categorieën; de vaste rekeningen van het systeem blijven ongewijzigd.
export const POST = bkRoute(async (request, _ctx, { repo }) => grootboekToevoegenActie(request, repo));
export const PATCH = bkRoute(async (request, _ctx, { repo }) => grootboekWijzigenActie(request, repo));
