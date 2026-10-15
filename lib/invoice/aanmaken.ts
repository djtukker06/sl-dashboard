import type { SupabaseClient } from '@supabase/supabase-js';
import { computeTotals } from './calculations';
import type { FactuurInvoer } from './invoer';
import { bewaarFactuurPdf } from './opslag';
import { bedrijf } from '@/lib/config';

export type AanmaakResultaat =
  | { ok: true; id: string; invoiceNumber: string }
  | { ok: false; fout: string };

// Maakt een factuur aan: vastleggen via create_invoice() (die het nummer bewaakt), de
// losse kolommen bijwerken en de PDF genereren. Zowel het formulier als de knop
// "Restfactuur maken" gaan hierlangs, zodat beide precies dezelfde controles doorlopen.
export async function maakFactuurAan(
  service: SupabaseClient,
  opties: {
    invoer: FactuurInvoer;
    clientId: string;
    // Alleen bij een restfactuur: de aanbetaling waar hij bij hoort.
    restVan?: { id: string; factuurnummer: string; percentage: number };
  }
): Promise<AanmaakResultaat> {
  const { invoer, clientId, restVan } = opties;

  const totalen = computeTotals(
    invoer.regels,
    bedrijf.btwPercentage,
    invoer.btwVerlegd,
    invoer.aanbetalingPercentage
  );

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
    return { ok: false, fout: `Factuur aanmaken mislukt: ${invoiceError?.message}` };
  }

  const factuur = invoice as { id: string; invoice_number: string; issued_at: string };

  // Direct vastleggen, niet pas samen met pdf_path: mislukt de PDF-generatie, dan is de
  // zelfgekozen naam anders kwijt terwijl de factuur wel bestaat.
  await service.from('invoices').update({ name: invoer.naamFactuur }).eq('id', factuur.id);
  // Apart van de naam: draait de deploy even voor op migratie 0010, dan mislukt alleen
  // dit en blijft de naam gewoon bewaard.
  await service
    .from('invoices')
    .update({ vat_reverse_charge_display: invoer.btwVerlegdAls })
    .eq('id', factuur.id);

  // Het aanbetalingspercentage en de koppeling met een aanbetaling staan los van de
  // databasefunctie. Mislukt dit terwijl het ertoe doet, dan stoppen we: anders zou de
  // factuur straks verkeerd te bewerken zijn, of zou een aanbetaling twee restfacturen
  // kunnen krijgen.
  const { error: extraError } = await service
    .from('invoices')
    .update({
      deposit_percentage: invoer.aanbetalingPercentage,
      ...(restVan
        ? {
            remainder_of_invoice_id: restVan.id,
            remainder_percentage: 100 - restVan.percentage,
            remainder_of_number: restVan.factuurnummer
          }
        : {})
    })
    .eq('id', factuur.id);

  if (extraError && (invoer.aanbetalingPercentage !== null || restVan)) {
    if (restVan) {
      // Zonder koppeling hoort deze restfactuur er niet te zijn: weer weg, zodat het
      // nummer vrijkomt en je het gewoon opnieuw kunt proberen.
      await service.from('invoices').delete().eq('id', factuur.id);
      return { ok: false, fout: `Restfactuur aanmaken mislukt: ${extraError.message}` };
    }
    return {
      ok: false,
      fout: `Aanbetalingspercentage opslaan mislukt: ${extraError.message} (factuur ${factuur.invoice_number} is wel aangemaakt, maar nog zonder PDF)`
    };
  }

  const pdfResultaat = await bewaarFactuurPdf(service, {
    factuurId: factuur.id,
    clientId,
    factuurnummer: factuur.invoice_number,
    datum: new Date(factuur.issued_at),
    invoer,
    totalen,
    restbetaling: restVan
      ? { percentage: 100 - restVan.percentage, aanbetalingNummer: restVan.factuurnummer }
      : null
  });

  if (pdfResultaat.fout) {
    // Factuurnummer en klant zijn al vastgelegd op dit punt — meld duidelijk dat alleen
    // de PDF zelf niet is gelukt, zodat dit niet als "niets is gebeurd" overkomt.
    return {
      ok: false,
      fout: `${pdfResultaat.fout} (factuur ${factuur.invoice_number} is wel aangemaakt)`
    };
  }

  return { ok: true, id: factuur.id, invoiceNumber: factuur.invoice_number };
}
