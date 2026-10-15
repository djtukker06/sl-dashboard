import type { SupabaseClient } from '@supabase/supabase-js';
import type { computeTotals } from './calculations';
import type { FactuurInvoer, PrijsopgaveInvoer } from './invoer';
import { renderInvoiceHtml, type FactuurVoorRender, type Restbetaling } from './render';
import { renderPdf } from './pdf';
import { BTW_VERLEGD_TEKST } from './formulier';

type Totalen = ReturnType<typeof computeTotals>;

// Legt de klantgegevens vast (of werkt ze bij) en geeft de klant-id terug. De factuur
// bewaart daarnaast een eigen snapshot van deze gegevens, zodat een latere wijziging
// bij de klant oude facturen nooit met terugwerkende kracht verandert.
export async function upsertKlant(
  service: SupabaseClient,
  klant: FactuurInvoer['klant']
): Promise<{ ok: false; fout: string } | { ok: true; id: string }> {
  const { data, error } = await service
    .from('clients')
    .upsert(
      {
        company_name: klant.bedrijfsnaam,
        contact_name: klant.tav,
        address: klant.adres,
        postal_code: klant.postcode,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'company_name_normalized' }
    )
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, fout: `Klant opslaan mislukt: ${error?.message}` };
  }
  return { ok: true, id: data.id as string };
}

// Rendert de PDF, zet hem in de opslag en legt het pad vast op de factuur.
//
// vorigPad: het pad van de PDF die vervangen wordt (bij het bewerken van een factuur).
// De nieuwe versie krijgt dan bewust een eigen pad met een tijdstempel in plaats van
// hetzelfde bestand te overschrijven — zo kan een gecachte oude versie nooit alsnog
// gedownload worden. Pas als het nieuwe pad is vastgelegd, gaat de oude eraf.
export async function bewaarFactuurPdf(
  service: SupabaseClient,
  opties: {
    factuurId: string;
    clientId: string;
    factuurnummer: string;
    datum: Date;
    invoer: FactuurInvoer;
    totalen: Totalen;
    vorigPad?: string | null;
    restbetaling?: Restbetaling | null;
  }
): Promise<{ fout?: string }> {
  const { factuurId, clientId, factuurnummer, datum, invoer, totalen, vorigPad, restbetaling } =
    opties;

  return bewaarPdf(service, {
    tabel: 'invoices',
    id: factuurId,
    render: { factuurnummer, datum, ...renderVelden(invoer, totalen), restbetaling },
    pdfPath: vorigPad
      ? `${clientId}/${factuurnummer}-${Date.now().toString(36)}.pdf`
      : `${clientId}/${factuurnummer}.pdf`,
    vorigPad
  });
}

// Hetzelfde voor een prijsopgave. Die PDF's staan in dezelfde privé-bucket, maar in een
// eigen map, los van de klantmappen van de facturen.
export async function bewaarPrijsopgavePdf(
  service: SupabaseClient,
  opties: {
    prijsopgaveId: string;
    invoer: PrijsopgaveInvoer;
    totalen: Totalen;
    vorigPad?: string | null;
  }
): Promise<{ fout?: string }> {
  const { prijsopgaveId, invoer, totalen, vorigPad } = opties;

  return bewaarPdf(service, {
    tabel: 'quotes',
    id: prijsopgaveId,
    render: {
      soort: 'prijsopgave',
      factuurnummer: invoer.nummer,
      datum: new Date(invoer.issuedAt),
      ...renderVelden(invoer, totalen)
    },
    pdfPath: vorigPad
      ? `prijsopgaven/${prijsopgaveId}-${Date.now().toString(36)}.pdf`
      : `prijsopgaven/${prijsopgaveId}.pdf`,
    vorigPad
  });
}

function renderVelden(invoer: FactuurInvoer | PrijsopgaveInvoer, totalen: Totalen) {
  return {
    klant: invoer.klant,
    middenKolomLabel: invoer.middenKolomLabel,
    regels: totalen.regels,
    subtotaalWeergave: totalen.subtotaalWeergave,
    btwPercentage: totalen.btwPercentage,
    btwVerlegd: totalen.btwVerlegd,
    btwVerlegdTekst: BTW_VERLEGD_TEKST[invoer.btwVerlegdAls],
    btwVerlegdReden: invoer.btwVerlegdReden,
    btwWeergave: totalen.btwWeergave,
    totaalWeergave: totalen.totaalWeergave,
    aanbetalingPercentage: totalen.aanbetalingPercentage,
    volledigSubtotaalWeergave: totalen.volledigSubtotaalWeergave,
    restantWeergave: totalen.restantWeergave
  };
}

async function bewaarPdf(
  service: SupabaseClient,
  opties: {
    tabel: 'invoices' | 'quotes';
    id: string;
    render: FactuurVoorRender;
    pdfPath: string;
    vorigPad?: string | null;
  }
): Promise<{ fout?: string }> {
  const { tabel, id, render, pdfPath, vorigPad } = opties;
  const html = renderInvoiceHtml(render);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderPdf(html);
  } catch (err) {
    const bericht = err instanceof Error ? err.message : String(err);
    return { fout: `PDF genereren mislukt: ${bericht}` };
  }

  const { error: uploadError } = await service.storage
    .from('invoices')
    .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

  if (uploadError) {
    return { fout: `PDF opslaan mislukt: ${uploadError.message}` };
  }

  const { error: updateError } = await service
    .from(tabel)
    .update({ pdf_path: pdfPath })
    .eq('id', id);

  if (updateError) {
    return { fout: `PDF vastleggen mislukt: ${updateError.message}` };
  }

  if (vorigPad && vorigPad !== pdfPath) {
    await service.storage.from('invoices').remove([vorigPad]);
  }

  return {};
}
