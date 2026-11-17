import { NextResponse } from 'next/server';
import { controleerRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { SJABLOON_KOLOMMEN, verstuurFactuur, type SjabloonRij } from '@/lib/invoice/terugkerend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/terugkerend/[id]/versturen  { factuurId } → { ok }
//   Een factuur van dit sjabloon (opnieuw) mailen, met de huidige e-mailinstellingen.
export async function POST(request: Request, ctx: Ctx) {
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { factuurId?: unknown } | null;
  if (!isUuid(id) || !isUuid(body?.factuurId)) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 });

  const service = createServiceRoleClient(toegang.lid.bewijs);
  const [{ data: s }, { data: f }] = await Promise.all([
    service.from('terugkerende_facturen').select(SJABLOON_KOLOMMEN).eq('id', id).maybeSingle(),
    service.from('invoices').select('id').eq('id', body.factuurId).eq('terugkerend_id', id).maybeSingle()
  ]);
  if (!s || !f) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 });
  const sjabloon = s as unknown as SjabloonRij;
  if (!sjabloon.email_aan || !sjabloon.mailbox_id) {
    return NextResponse.json({ error: 'Stel eerst bij de terugkerende factuur in naar welk adres en vanaf welke inbox hij gaat.' }, { status: 400 });
  }
  try {
    await verstuurFactuur(service, body.factuurId as string, sjabloon);
    await service.from('terugkerende_facturen').update({ laatste_fout: null }).eq('id', id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, { status: 500 });
  }
}
