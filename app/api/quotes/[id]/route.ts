import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { computeTotals } from '@/lib/invoice/calculations';
import { parsePrijsopgaveInvoer, type FactuurInvoerBody } from '@/lib/invoice/invoer';
import { bewaarPrijsopgavePdf } from '@/lib/invoice/opslag';
import { prijsopgaveKolommen } from '@/lib/invoice/prijsopgave';
import { bedrijf } from '@/lib/config';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Een bestaande prijsopgave bijwerken: zelfde id, nieuwe gegevens en een nieuwe PDF.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }

  const { id } = await params;
  const body: FactuurInvoerBody = await request.json();

  const parsed = parsePrijsopgaveInvoer(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.fout }, { status: 400 });
  }
  const invoer = parsed.invoer;

  const service = createServiceRoleClient();

  const { data: bestaand, error: fetchError } = await service
    .from('quotes')
    .select('id, pdf_path')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !bestaand) {
    return NextResponse.json({ error: 'Prijsopgave niet gevonden.' }, { status: 404 });
  }

  const totalen = computeTotals(invoer.regels, bedrijf.btwPercentage, invoer.btwVerlegd);

  const { error: updateError } = await service
    .from('quotes')
    .update({ ...prijsopgaveKolommen(invoer, totalen), updated_at: new Date().toISOString() })
    .eq('id', id);

  if (updateError) {
    return NextResponse.json(
      { error: `Prijsopgave bijwerken mislukt: ${updateError.message}` },
      { status: 500 }
    );
  }

  const pdfResultaat = await bewaarPrijsopgavePdf(service, {
    prijsopgaveId: id,
    invoer,
    totalen,
    vorigPad: bestaand.pdf_path
  });

  if (pdfResultaat.fout) {
    return NextResponse.json(
      { error: `${pdfResultaat.fout} (de wijzigingen zijn wel opgeslagen, alleen de PDF is nog de oude)` },
      { status: 500 }
    );
  }

  revalidatePath('/prijsopgaven');
  revalidatePath(`/prijsopgaven/${id}/bewerken`);

  return NextResponse.json({ id });
}
