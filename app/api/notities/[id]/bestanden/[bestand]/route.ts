import { NextResponse } from 'next/server';
import { isUuid, teamlidRoute } from '@/lib/auth/team';
import { bijlageOpenen } from '@/lib/notities/bestanden';
import { fout, foutAntwoord } from '@/lib/notities/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/notities/[id]/bestanden/[bestand]             → 302 naar een signed URL van 5 min
// GET /api/notities/[id]/bestanden/[bestand]?download=1  → idem, als download
// Zo kan de editor een <img> of link tonen zonder dat het bestand ooit publiek is. Of je hem
// mag zien, bepaalt RLS (de notitie moet voor jou zichtbaar zijn).

type Ctx = { params: Promise<{ id: string; bestand: string }> };

export const GET = teamlidRoute(
  async (request, ctx: Ctx, lid) => {
    const { id, bestand } = await ctx.params;
    if (!isUuid(id) || !isUuid(bestand)) return fout(404, 'Dit bestand bestaat niet (meer).');
    try {
      const url = await bijlageOpenen(lid, id, bestand, new URL(request.url).searchParams.get('download') === '1');
      if (!url) return fout(404, 'Dit bestand bestaat niet (meer).');
      return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=240' } });
    } catch (e) {
      return foutAntwoord(e);
    }
  },
  { label: 'notities' }
);
