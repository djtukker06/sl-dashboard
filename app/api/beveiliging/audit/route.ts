import { NextResponse } from 'next/server';
import { eigenaarRoute } from '@/lib/auth/team';
import { leesAudit } from '@/lib/auth/beveiliging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Eigenaar (met 2FA-sessie): de audit-log, 100 regels per pagina, filter op actie(groep) en
// gebruiker. RLS (is_eigenaar) leest mee: ook met een fout in deze route ziet niemand anders iets.
export const GET = eigenaarRoute(async (request, _ctx, lid) => {
  const url = new URL(request.url);
  const r = await leesAudit(lid, {
    actie: url.searchParams.get('actie') ?? undefined,
    gebruiker: url.searchParams.get('gebruiker') ?? undefined,
    pagina: Number(url.searchParams.get('pagina') ?? 0) || 0
  });
  return NextResponse.json(r, { headers: { 'Cache-Control': 'private, no-store' } });
}, { label: 'beveiliging' });
