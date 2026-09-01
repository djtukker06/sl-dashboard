import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { computeTotals } from '@/lib/invoice/calculations';
import { parseFactuurInvoer, type FactuurInvoerBody } from '@/lib/invoice/invoer';
import { bewaarFactuurPdf, upsertKlant } from '@/lib/invoice/opslag';
import { bedrijf } from '@/lib/config';

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

  const totalen = computeTotals(invoer.regels, bedrijf.btwPercentage, invoer.btwVerlegd);

  const { data: invoice, error: invoiceError } = await service
    .rpc('create_invoice', {
      p_year: invoer.jaar,
      p_sequence_number: invoer.volgnummer,
      p_issued_at: invoer.issuedAt,
      p_client_id: clientId,
      p_client_company_name: invoer.klant.bedrijfsnaam,
      p_client_contact_name: invoer.klant.tav,
      p_client_address: invoer.klant.adres,
      p_client_postal_code: invoer.klant.postcode,
      p_mid_column_label: invoer.middenKolomLabel || null,
      p_line_items: totalen.regels,
      p_subtotal: totalen.subtotaal,
      p_revenue_subtotal: totalen.omzet,
      p_vat_percentage: totalen.btwPercentage,
      p_vat_amount: totalen.btw,
      p_total: totalen.totaal,
      p_vat_reverse_charged: invoer.btwVerlegd,
      p_vat_reverse_charge_reason: invoer.btwVerlegdReden || null
    })
    .single();

  if (invoiceError || !invoice) {
    return NextResponse.json({ error: `Factuur aanmaken mislukt: ${invoiceError?.message}` }, { status: 500 });
  }

  const factuur = invoice as { id: string; invoice_number: string; issued_at: string };

  // Direct vastleggen, niet pas samen met pdf_path: mislukt de PDF-generatie, dan is de
  // zelfgekozen naam anders kwijt terwijl de factuur wel bestaat.
  await service.from('invoices').update({ name: invoer.naamFactuur }).eq('id', factuur.id);

  const pdfResultaat = await bewaarFactuurPdf(service, {
    factuurId: factuur.id,
    clientId,
    factuurnummer: factuur.invoice_number,
    datum: new Date(factuur.issued_at),
    invoer,
    totalen
  });

  if (pdfResultaat.fout) {
    // Factuurnummer en klant zijn al vastgelegd op dit punt — meld duidelijk dat alleen
    // de PDF zelf niet is gelukt, zodat dit niet als "niets is gebeurd" overkomt.
    return NextResponse.json(
      { error: `${pdfResultaat.fout} (factuur ${factuur.invoice_number} is wel aangemaakt)` },
      { status: 500 }
    );
  }

  revalidatePath('/');

  return NextResponse.json({ id: factuur.id, invoiceNumber: factuur.invoice_number });
}
