import type { computeTotals } from './calculations';
import type { PrijsopgaveInvoer } from './invoer';

// De kolommen van de quotes-tabel, zoals aanmaken en bewerken ze allebei wegschrijven.
// Lege velden worden null, zodat "niet ingevuld" in de database ook echt leeg is.
export function prijsopgaveKolommen(
  invoer: PrijsopgaveInvoer,
  totalen: ReturnType<typeof computeTotals>
) {
  return {
    quote_number: invoer.nummer || null,
    name: invoer.naam,
    issued_at: invoer.issuedAt,
    client_company_name: invoer.klant.bedrijfsnaam || null,
    client_contact_name: invoer.klant.tav || null,
    client_address: invoer.klant.adres || null,
    client_postal_code: invoer.klant.postcode || null,
    mid_column_label: invoer.middenKolomLabel || null,
    line_items: totalen.regels,
    subtotal: totalen.subtotaal,
    vat_percentage: totalen.btwPercentage,
    vat_amount: totalen.btw,
    total: totalen.totaal,
    vat_reverse_charged: invoer.btwVerlegd,
    vat_reverse_charge_display: invoer.btwVerlegdAls,
    vat_reverse_charge_reason: invoer.btwVerlegdReden || null
  };
}
