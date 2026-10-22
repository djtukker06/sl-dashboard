import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { controleerRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { computeTotals } from '@/lib/invoice/calculations';
import { parseFactuurInvoer, type FactuurInvoerBody } from '@/lib/invoice/invoer';
import { bewaarFactuurPdf, upsertKlant } from '@/lib/invoice/opslag';
import { bedrijf } from '@/lib/config';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Bewerken van een bestaande factuur: dezelfde factuur (zelfde id, zelfde plek in het
// archief) krijgt bijgewerkte gegevens, een nieuw bedrag en een nieuwe PDF. De oude PDF
// wordt vervangen — die is na het bewerken immers niet meer de factuur die geldt.
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

  const parsed = parseFactuurInvoer(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.fout }, { status: 400 });
  }
  const invoer = parsed.invoer;

  const service = createServiceRoleClient(lid.bewijs);

  const { data: bestaand, error: fetchError } = await service
    .from('invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !bestaand) {
    return NextResponse.json({ error: 'Factuur niet gevonden.' }, { status: 404 });
  }

  const klantResultaat = await upsertKlant(service, invoer.klant);
  if (!klantResultaat.ok) {
    return NextResponse.json({ error: klantResultaat.fout }, { status: 500 });
  }
  const clientId = klantResultaat.id;

  const totalen = computeTotals(
    invoer.regels,
    bedrijf.btwPercentage,
    invoer.btwVerlegd,
    invoer.aanbetalingPercentage
  );

  const { data: invoice, error: updateError } = await service
    .rpc('update_invoice', {
      p_id: id,
      p_year: invoer.jaar,
      p_sequence_number: invoer.volgnummer,
      p_issued_at: invoer.issuedAt,
      p_name: invoer.naamFactuur,
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

  if (updateError || !invoice) {
    return NextResponse.json(
      { error: `Factuur bijwerken mislukt: ${updateError?.message}` },
      { status: 500 }
    );
  }

  const factuur = invoice as { id: string; invoice_number: string; issued_at: string };

  // Los van update_invoice, zodat die functie niet opnieuw aangemaakt hoeft te worden.
  await service
    .from('invoices')
    .update({ vat_reverse_charge_display: invoer.btwVerlegdAls })
    .eq('id', factuur.id);

  // Het aanbetalingspercentage staat los van de databasefunctie, net als de btw-weergave.
  // Mislukt dit bij een aanbetaling (bijv. omdat migratie 0012 nog niet gedraaid is), dan
  // stoppen we: anders zou de factuur straks als reguliere factuur te bewerken zijn,
  // terwijl de opgeslagen bedragen die van de aanbetaling zijn.
  const { error: aanbetalingError } = await service
    .from('invoices')
    .update({ deposit_percentage: invoer.aanbetalingPercentage })
    .eq('id', factuur.id);

  if (aanbetalingError && invoer.aanbetalingPercentage !== null) {
    return NextResponse.json(
      { error: `Aanbetalingspercentage opslaan mislukt: ${aanbetalingError.message}` },
      { status: 500 }
    );
  }

  const pdfResultaat = await bewaarFactuurPdf(service, {
    factuurId: factuur.id,
    clientId,
    factuurnummer: factuur.invoice_number,
    datum: new Date(factuur.issued_at),
    invoer,
    totalen,
    vorigPad: bestaand.pdf_path,
    // Een restfactuur blijft bij het aanpassen een restfactuur, met dezelfde vermelding.
    restbetaling:
      typeof bestaand.remainder_percentage === 'number' && bestaand.remainder_of_number
        ? {
            percentage: bestaand.remainder_percentage,
            aanbetalingNummer: bestaand.remainder_of_number
          }
        : null
  });

  if (pdfResultaat.fout) {
    // De gegevens staan al goed in het archief; alleen de PDF is nog de oude. Zeg dat
    // erbij, zodat duidelijk is dat opnieuw opslaan genoeg is om het recht te trekken.
    return NextResponse.json(
      { error: `${pdfResultaat.fout} (de wijzigingen zijn wel opgeslagen, alleen de PDF is nog de oude)` },
      { status: 500 }
    );
  }

  revalidatePath('/facturen');
  revalidatePath(`/facturen/klanten/${clientId}`);
  revalidatePath(`/facturen/${id}/bewerken`);

  return NextResponse.json({ id: factuur.id, invoiceNumber: factuur.invoice_number });
}

export async function DELETE(
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

  const { data: invoice, error: fetchError } = await service
    .from('invoices')
    .select('pdf_path')
    .eq('id', id)
    .single();

  if (fetchError || !invoice) {
    return NextResponse.json({ error: 'Factuur niet gevonden.' }, { status: 404 });
  }

  if (invoice.pdf_path) {
    await service.storage.from('invoices').remove([invoice.pdf_path]);
  }

  // Het factuurnummer komt door verwijderen weer vrij: het voorstel voor een nieuwe
  // factuur is "hoogste bestaande nummer + 1" (zie migratie 0005). Verwijder je de
  // laatste factuur, dan wordt dat nummer dus opnieuw voorgesteld.
  const { error: deleteError } = await service.from('invoices').delete().eq('id', id);

  if (deleteError) {
    console.error('[facturen] verwijderen mislukt', deleteError.code ?? '', deleteError.message);
    return NextResponse.json({ error: 'Verwijderen is mislukt. Probeer het opnieuw.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
