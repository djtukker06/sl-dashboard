import { bkRoute, fout } from '@/lib/boekhouding/api';
import { jaarAfsluitenActie, jaarHeropenenActie, leesJaar } from '@/lib/boekhouding/acties-jaar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jaar: string }> };

// POST /api/boekhouding/jaarafsluiting/[jaar]  { banksaldi: { <rekeningId>: centen }, verwacht? } → { boekjaar }
//   Alleen de eigenaar (2FA). De server controleert de checklist, boekt de afsluitpost
//   (resultaat en privé naar kapitaal) en vergrendelt het jaar.
export const POST = bkRoute(
  async (request, ctx: Ctx, { repo }) => {
    const jaar = leesJaar((await ctx.params).jaar);
    if (!jaar) return fout(404, 'Onbekend boekjaar.');
    return jaarAfsluitenActie(request, repo, jaar);
  },
  { alleenEigenaar: true }
);

// DELETE /api/boekhouding/jaarafsluiting/[jaar] → { ok }   Heropenen (alleen de eigenaar).
export const DELETE = bkRoute(
  async (_request, ctx: Ctx, { repo }) => {
    const jaar = leesJaar((await ctx.params).jaar);
    if (!jaar) return fout(404, 'Onbekend boekjaar.');
    return jaarHeropenenActie(repo, jaar);
  },
  { alleenEigenaar: true }
);
