import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { controleerRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { computeTotals } from '@/lib/invoice/calculations';
import { parsePrijsopgaveInvoer, type FactuurInvoerBody } from '@/lib/invoice/invoer';
import { bewaarPrijsopgavePdf } from '@/lib/invoice/opslag';
import { prijsopgaveKolommen } from '@/lib/invoice/prijsopgave';
import { bedrijf } from '@/lib/config';
import { naDrive } from '@/lib/drive/kopieen';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Een bestaande prijsopgave bijwerken: zelfde id, nieuwe gegevens en een nieuwe PDF.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Sessie + teamlidmaatschap (401/403) en bij wijzigen de herkomst (lib/auth/team.ts).
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const lid = toegang.lid;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 });
  }
  const body: FactuurInvoerBody = await request.json();

  const parsed = parsePrijsopgaveInvoer(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.fout }, { status: 400 });
  }
  const invoer = parsed.invoer;

  const service = createServiceRoleClient(lid.bewijs);

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

  revalidatePath('/facturen/prijsopgaven');
  revalidatePath(`/facturen/prijsopgaven/${id}/bewerken`);
  // De nieuwe PDF ook in Google Drive (ná het antwoord, best effort).
  naDrive(lid, 'prijsopgave', id);

  return NextResponse.json({ id });
}
