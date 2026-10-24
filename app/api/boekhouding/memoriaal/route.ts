import { bkRoute } from '@/lib/boekhouding/api';
import { memoriaalToevoegenActie, memoriaalVerwijderenActie } from '@/lib/boekhouding/acties-jaar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/boekhouding/memoriaal  { datum, omschrijving, soort: beginbalans|correctie,
//   regels: [{ grootboek, debet, credit, vennootId? }] } → { memoriaal }
//   Een sluitende memoriaalpost in een open periode (niet op bank, debiteuren, crediteuren of btw).
export const POST = bkRoute(async (request, _ctx, { repo }) => memoriaalToevoegenActie(request, repo));

// DELETE /api/boekhouding/memoriaal?id=<uuid> → { ok }   Alleen in een open periode.
export const DELETE = bkRoute(async (request, _ctx, { repo }) => memoriaalVerwijderenActie(repo, new URL(request.url).searchParams.get('id')));
