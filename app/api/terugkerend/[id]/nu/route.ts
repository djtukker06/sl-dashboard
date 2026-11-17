import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { controleerRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { vandaagNL } from '@/lib/invoice/nummer';
import { voerNuUit } from '@/lib/invoice/terugkerend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/terugkerend/[id]/nu → { status, factuurnummer?, fout? }
//   "Nu factureren": de factuur voor de eerstvolgende periode meteen aanmaken (en versturen,
//   als dat aan staat). Daarna staat de volgende periode gepland, net als na de cron.
export async function POST(request: Request, ctx: Ctx) {
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 });
  try {
    const u = await voerNuUit(createServiceRoleClient(toegang.lid.bewijs), id, vandaagNL());
    revalidatePath('/facturen');
    if (u.status === 'overgeslagen') {
      return NextResponse.json({ error: 'Deze terugkerende factuur staat op pauze of is voorbij de einddatum.' }, { status: 409 });
    }
    return NextResponse.json(u);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, { status: 500 });
  }
}
