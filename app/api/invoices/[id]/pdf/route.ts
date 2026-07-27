import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

// Maakt van een zelfgekozen factuurnaam een bruikbare bestandsnaam: stuurtekens eruit,
// tekens die Windows/macOS niet in bestandsnamen toestaan vervangen door een streepje.
function veiligeBestandsnaam(naam: string, terugvalNummer: string): string {
  const zonderStuurtekens = [...naam]
    .filter((teken) => {
      const code = teken.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');

  const opgeschoond = zonderStuurtekens
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    // Een punt aan het eind is op Windows niet toegestaan.
    .replace(/\.+$/, '')
    .trim();

  return `${opgeschoond || `Factuur ${terugvalNummer}`}.pdf`;
}

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

  const bestandsnaam = veiligeBestandsnaam(invoice.name || '', invoice.invoice_number);
  const asciiNaam = bestandsnaam.replace(/[^ -~]/g, '_');

  return new NextResponse(new Uint8Array(await bestand.arrayBuffer()), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${asciiNaam}"; filename*=UTF-8''${encodeURIComponent(bestandsnaam)}`,
      'Cache-Control': 'private, no-store'
    }
  });
}
