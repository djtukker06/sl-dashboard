import { NextResponse } from 'next/server';
import { teamlidRoute } from '@/lib/auth/team';
import { feedStatus, nieuweLink, uitstellen } from '@/lib/agenda/feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

// Je eigen agenda-koppeling: status (voor het wachten op Apple/Google), een nieuwe link (de
// oude werkt dan niet meer) of koppelen een dag uitstellen.
export const GET = teamlidRoute(async (_request, _ctx, lid) => {
  return NextResponse.json(await feedStatus(lid), { headers: GEEN_CACHE });
}, { label: 'agenda-koppelen' });

export const POST = teamlidRoute(async (request, _ctx, lid) => {
  const body = (await request.json().catch(() => null)) as { actie?: unknown } | null;
  const status = await feedStatus(lid);
  if (!status.ingericht) return NextResponse.json({ error: 'Voer eerst supabase/UITVOEREN_0029.sql uit.' }, { status: 503, headers: GEEN_CACHE });
  if (body?.actie === 'nieuw') {
    const token = await nieuweLink(lid);
    return NextResponse.json({ pad: `/api/agenda-feed/${token}.ics` }, { headers: GEEN_CACHE });
  }
  if (body?.actie === 'uitstellen') {
    if (!status.heeftLink) return NextResponse.json({ error: 'Maak eerst een link aan.' }, { status: 400, headers: GEEN_CACHE });
    return NextResponse.json({ uitgesteldTot: await uitstellen(lid) }, { headers: GEEN_CACHE });
  }
  return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400, headers: GEEN_CACHE });
}, { label: 'agenda-koppelen' });
