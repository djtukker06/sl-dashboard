import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { computeTotals, type FactuurRegelInvoer } from '@/lib/invoice/calculations';
import { renderInvoiceHtml } from '@/lib/invoice/render';
import { renderPdf } from '@/lib/invoice/pdf';
import { bedrijf } from '@/lib/config';
import { parseBedrag } from '@/lib/format';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface InvoiceRequestBody {
  klantBedrijfsnaam: string;
  klantTav: string;
  klantAdres: string;
  klantPostcode: string;
  middenKolomLabel: string;
  regels: { beschrijving: string; midden?: string; totaal: string }[];
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }

  const body: InvoiceRequestBody = await request.json();

  const klantBedrijfsnaam = (body.klantBedrijfsnaam || '').trim();
  const klantTav = (body.klantTav || '').trim();
  const klantAdres = (body.klantAdres || '').trim();
  const klantPostcode = (body.klantPostcode || '').trim();
  const middenKolomLabel = (body.middenKolomLabel || '').trim();

  const regelsInvoer: FactuurRegelInvoer[] = (body.regels || [])
    .map((r) => ({
      beschrijving: (r.beschrijving || '').trim(),
      midden: (r.midden || '').trim(),
      totaal: parseBedrag(r.totaal || '0')
    }))
    .filter((r) => r.beschrijving !== '');

  if (!klantBedrijfsnaam || regelsInvoer.length === 0) {
    return NextResponse.json(
      { error: 'Vul een klantnaam in en voeg minimaal 1 factuurregel toe.' },
      { status: 400 }
    );
  }

  const service = createServiceRoleClient();

  const { data: client, error: clientError } = await service
    .from('clients')
    .upsert(
      {
        company_name: klantBedrijfsnaam,
        contact_name: klantTav,
        address: klantAdres,
        postal_code: klantPostcode,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'company_name_normalized' }
    )
    .select()
    .single();

  if (clientError || !client) {
    return NextResponse.json({ error: `Klant opslaan mislukt: ${clientError?.message}` }, { status: 500 });
  }

  const totalen = computeTotals(regelsInvoer, bedrijf.btwPercentage);

  const { data: invoice, error: invoiceError } = await service
    .rpc('create_invoice', {
      p_client_id: client.id,
      p_client_company_name: klantBedrijfsnaam,
      p_client_contact_name: klantTav,
      p_client_address: klantAdres,
      p_client_postal_code: klantPostcode,
      p_mid_column_label: middenKolomLabel || null,
      p_line_items: totalen.regels,
      p_subtotal: totalen.subtotaal,
      p_vat_percentage: bedrijf.btwPercentage,
      p_vat_amount: totalen.btw,
      p_total: totalen.totaal
    })
    .single();

  if (invoiceError || !invoice) {
    return NextResponse.json({ error: `Factuur aanmaken mislukt: ${invoiceError?.message}` }, { status: 500 });
  }

  const factuur = invoice as { id: string; invoice_number: string; issued_at: string };

  const html = renderInvoiceHtml({
    factuurnummer: factuur.invoice_number,
    datum: new Date(factuur.issued_at),
    klant: { bedrijfsnaam: klantBedrijfsnaam, tav: klantTav, adres: klantAdres, postcode: klantPostcode },
    middenKolomLabel,
    regels: totalen.regels,
    subtotaalWeergave: totalen.subtotaalWeergave,
    btwWeergave: totalen.btwWeergave,
    totaalWeergave: totalen.totaalWeergave
  });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderPdf(html);
  } catch (err) {
    // Factuurnummer en klant zijn al vastgelegd op dit punt (bewuste keuze, zie
    // create_invoice: nummers worden nooit hergebruikt) — meld duidelijk dat alleen
    // de PDF zelf niet is gelukt, zodat dit niet als "niets is gebeurd" overkomt.
    const bericht = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `PDF genereren mislukt (factuur ${factuur.invoice_number} is wel aangemaakt): ${bericht}` },
      { status: 500 }
    );
  }
  const pdfPath = `${client.id}/${factuur.invoice_number}.pdf`;

  const { error: uploadError } = await service.storage
    .from('invoices')
    .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

  if (uploadError) {
    return NextResponse.json({ error: `PDF opslaan mislukt: ${uploadError.message}` }, { status: 500 });
  }

  await service.from('invoices').update({ pdf_path: pdfPath }).eq('id', factuur.id);

  return NextResponse.json({ id: factuur.id, invoiceNumber: factuur.invoice_number });
}
