import { NextResponse } from 'next/server';
import { controleerRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { pdfHeaders, veiligeBestandsnaam } from '@/lib/invoice/bestandsnaam';

export async function GET(
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
  const service = createServiceRoleClient(lid.bewijs);

  const { data: prijsopgave, error: fetchError } = await service
    .from('quotes')
    .select('name, pdf_path')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !prijsopgave || !prijsopgave.pdf_path) {
    return NextResponse.json({ error: 'PDF van de prijsopgave niet gevonden.' }, { status: 404 });
  }

  const { data: bestand, error: downloadError } = await service.storage
    .from('invoices')
    .download(prijsopgave.pdf_path);

  if (downloadError || !bestand) {
    return NextResponse.json({ error: 'Kon de PDF niet ophalen.' }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(await bestand.arrayBuffer()), {
    headers: pdfHeaders(
      veiligeBestandsnaam(prijsopgave.name || '', 'Prijsopgave'),
      new URL(request.url).searchParams.get('download') === '1'
    )
  });
}
