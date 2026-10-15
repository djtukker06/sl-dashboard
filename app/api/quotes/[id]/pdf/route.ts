import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { pdfHeaders, veiligeBestandsnaam } from '@/lib/invoice/bestandsnaam';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }

  const { id } = await params;
  const service = createServiceRoleClient();

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
    headers: pdfHeaders(veiligeBestandsnaam(prijsopgave.name || '', 'Prijsopgave'))
  });
}
