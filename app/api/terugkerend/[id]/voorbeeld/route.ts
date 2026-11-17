import { NextResponse } from 'next/server';
import { controleerRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { pdfHeaders, veiligeBestandsnaam } from '@/lib/invoice/bestandsnaam';
import { voorbeeldPdf } from '@/lib/invoice/terugkerend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// GET /api/terugkerend/[id]/voorbeeld → PDF van de eerstvolgende factuur zoals hij op de geplande
//   dag wordt (nummer = wat hij nu zou krijgen). Niets wordt opgeslagen of verstuurd.
export async function GET(request: Request, ctx: Ctx) {
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 });
  try {
    const { pdf, naam } = await voorbeeldPdf(createServiceRoleClient(toegang.lid.bewijs), id);
    return new NextResponse(new Uint8Array(pdf), { headers: pdfHeaders(veiligeBestandsnaam(naam, 'Voorbeeld factuur'), false) });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
