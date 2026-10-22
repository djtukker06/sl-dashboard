import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { parseFactuurInvoer, type FactuurInvoerBody } from '@/lib/invoice/invoer';
import { upsertKlant } from '@/lib/invoice/opslag';
import { maakFactuurAan } from '@/lib/invoice/aanmaken';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }

  const body: FactuurInvoerBody = await request.json();
  const parsed = parseFactuurInvoer(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.fout }, { status: 400 });
  }
  const invoer = parsed.invoer;

  const service = createServiceRoleClient();

  const klantResultaat = await upsertKlant(service, invoer.klant);
  if (!klantResultaat.ok) {
    return NextResponse.json({ error: klantResultaat.fout }, { status: 500 });
  }
  const clientId = klantResultaat.id;

  const resultaat = await maakFactuurAan(service, { invoer, clientId });
  if (!resultaat.ok) {
    return NextResponse.json({ error: resultaat.fout }, { status: 500 });
  }

  revalidatePath('/facturen');

  return NextResponse.json({ id: resultaat.id, invoiceNumber: resultaat.invoiceNumber });
}
