import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { controleerRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { maakFactuurAan } from '@/lib/invoice/aanmaken';
import { standaardNaam } from '@/lib/invoice/formulier';
import type { FactuurRegelInvoer } from '@/lib/invoice/calculations';
import { vandaagNL, volgendFactuurnummer } from '@/lib/invoice/nummer';
import { naDrive } from '@/lib/drive/kopieen';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface OpgeslagenRegel {
  beschrijving?: string;
  midden?: string;
  totaal?: number;
  teltMeeInOmzet?: boolean;
  gefactureerd?: number;
}

const opCenten = (bedrag: number) => Math.round((bedrag + Number.EPSILON) * 100) / 100;

// Met één klik een factuur voor het resterende bedrag van een aanbetaling: zelfde klant,
// zelfde regels en btw-instellingen, datum vandaag en het eerstvolgende factuurnummer.
// Elke regel krijgt het deel dat nog niet gefactureerd is (volledige prijs min wat er op
// de aanbetaling stond), zodat aanbetaling + restfactuur samen precies de opdracht zijn.
export async function POST(
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

  const { data: aanbetaling } = await service
    .from('invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!aanbetaling) {
    return NextResponse.json({ error: 'Factuur niet gevonden.' }, { status: 404 });
  }

  const percentage = aanbetaling.deposit_percentage;
  if (typeof percentage !== 'number') {
    return NextResponse.json({ error: 'Dit is geen aanbetalingsfactuur.' }, { status: 400 });
  }

  const { data: bestaandeRest } = await service
    .from('invoices')
    .select('invoice_number')
    .eq('remainder_of_invoice_id', id)
    .maybeSingle();

  if (bestaandeRest) {
    return NextResponse.json(
      { error: `Er is al een restfactuur voor deze aanbetaling: ${bestaandeRest.invoice_number}.` },
      { status: 409 }
    );
  }

  const opgeslagen = (Array.isArray(aanbetaling.line_items) ? aanbetaling.line_items : []) as OpgeslagenRegel[];
  const regels: FactuurRegelInvoer[] = opgeslagen.map((regel) => {
    const volledig = typeof regel.totaal === 'number' ? regel.totaal : 0;
    const alGefactureerd =
      typeof regel.gefactureerd === 'number'
        ? regel.gefactureerd
        : opCenten((volledig * percentage) / 100);
    return {
      beschrijving: regel.beschrijving || '',
      midden: regel.midden || '',
      totaal: opCenten(volledig - alGefactureerd),
      teltMeeInOmzet: regel.teltMeeInOmzet !== false
    };
  });

  const vandaag = vandaagNL();
  const nummer = await volgendFactuurnummer(service, Number(vandaag.slice(0, 4)));

  const resultaat = await maakFactuurAan(service, {
    clientId: aanbetaling.client_id,
    invoer: {
      factuurnummer: nummer.factuurnummer,
      jaar: nummer.jaar,
      volgnummer: nummer.volgnummer,
      issuedAt: `${vandaag}T12:00:00Z`,
      naamFactuur: standaardNaam('factuur', nummer.factuurnummer),
      // De klantgegevens zoals ze op de aanbetaling stonden: het is dezelfde opdracht.
      klant: {
        bedrijfsnaam: aanbetaling.client_company_name || '',
        tav: aanbetaling.client_contact_name || '',
        adres: aanbetaling.client_address || '',
        postcode: aanbetaling.client_postal_code || ''
      },
      middenKolomLabel: aanbetaling.mid_column_label || '',
      btwVerlegd: aanbetaling.vat_reverse_charged === true,
      btwVerlegdAls: aanbetaling.vat_reverse_charge_display === 'nvt' ? 'nvt' : 'verlegd',
      btwVerlegdReden: aanbetaling.vat_reverse_charge_reason || '',
      aanbetalingPercentage: null,
      regels
    },
    restVan: { id, factuurnummer: aanbetaling.invoice_number, percentage }
  });

  if (!resultaat.ok) {
    return NextResponse.json({ error: resultaat.fout }, { status: 500 });
  }

  // "Aangemaakt door": create_invoice draait via de service-role, waar auth.uid() leeg is.
  // Alleen deze kolom; de factuur zelf blijft precies zoals create_invoice hem vastlegde.
  const { error: makerFout } = await service
    .from('invoices')
    .update({ created_by: lid.userId })
    .eq('id', resultaat.id)
    .is('created_by', null);
  if (makerFout) console.error('[facturen] maker vastleggen mislukt', makerFout.code ?? '', makerFout.message);

  revalidatePath('/facturen');
  revalidatePath(`/facturen/klanten/${aanbetaling.client_id}`);
  // Kopie van de PDF naar Google Drive (ná het antwoord, best effort).
  naDrive(lid, 'factuur', resultaat.id);

  return NextResponse.json({ id: resultaat.id, invoiceNumber: resultaat.invoiceNumber });
}
