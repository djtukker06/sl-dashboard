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

  // Bewust alle kolommen: draait de deploy even voor op de migratie die "name" toevoegt,
  // dan blijft de PDF gewoon werken (met de factuurnummer-terugval) in plaats van te falen
  // op een kolom die nog niet bestaat.
  const { data: invoice, error: fetchError } = await service
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !invoice || !invoice.pdf_path) {
    return NextResponse.json({ error: 'Factuur-PDF niet gevonden.' }, { status: 404 });
  }

  // De PDF loopt via deze route in plaats van een redirect naar Supabase, zodat we de
  // bestandsnaam zelf kunnen meegeven. "inline" houdt het gedrag zoals het was: de PDF
  // opent gewoon in de browser, en bij opslaan staat de juiste naam er al klaar.
  const { data: bestand, error: downloadError } = await service.storage
    .from('invoices')
    .download(invoice.pdf_path);

  if (downloadError || !bestand) {
    return NextResponse.json({ error: 'Kon de factuur-PDF niet ophalen.' }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(await bestand.arrayBuffer()), {
    headers: pdfHeaders(
      veiligeBestandsnaam(invoice.name || '', `Factuur ${invoice.invoice_number}`)
    )
  });
}
