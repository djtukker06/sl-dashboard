import { NextResponse } from 'next/server';
import { feedVoorToken } from '@/lib/agenda/feed';
import { siteUrl } from '@/lib/auth/site';
import { logFout } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

// Het agenda-abonnement van één teamlid (ICS) voor Apple Agenda / Google Agenda. Zonder
// sessie (proxy.ts laat dit exacte pad door); het geheime token in de URL is de sleutel.
// Een onbekend token of een gedeactiveerd teamlid krijgt 404, zonder verschil.
export async function GET(request: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  try {
    const ics = await feedVoorToken(token.replace(/\.ics$/, ''), request.headers.get('user-agent'), siteUrl(null) ?? new URL(request.url).origin);
    if (!ics) return new NextResponse('Niet gevonden', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return new NextResponse(ics, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="studio-levant.ics"',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex'
      }
    });
  } catch (e) {
    logFout('[agenda-feed]', e);
    return new NextResponse('Tijdelijk niet beschikbaar', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' } });
  }
}
