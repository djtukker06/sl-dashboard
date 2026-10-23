import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { controleerRoute } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { computeTotals } from '@/lib/invoice/calculations';
import { parsePrijsopgaveInvoer, type FactuurInvoerBody } from '@/lib/invoice/invoer';
import { bewaarPrijsopgavePdf } from '@/lib/invoice/opslag';
import { prijsopgaveKolommen } from '@/lib/invoice/prijsopgave';
import { bedrijf } from '@/lib/config';
import { naDrive } from '@/lib/drive/kopieen';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Een prijsopgave aanmaken. Anders dan bij een factuur wordt de klant hier bewust níet
// in de klantenlijst gezet: de gegevens staan alleen op de prijsopgave zelf.
export async function POST(request: Request) {
  // Sessie + teamlidmaatschap (401/403) en bij wijzigen de herkomst (lib/auth/team.ts).
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const lid = toegang.lid;

  const body: FactuurInvoerBody = await request.json();
  const parsed = parsePrijsopgaveInvoer(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.fout }, { status: 400 });
  }
  const invoer = parsed.invoer;

  const totalen = computeTotals(invoer.regels, bedrijf.btwPercentage, invoer.btwVerlegd);
  const service = createServiceRoleClient(lid.bewijs);

  const { data: prijsopgave, error } = await service
    .from('quotes')
    .insert({ ...prijsopgaveKolommen(invoer, totalen), created_by: lid.userId })
    .select('id')
    .single();

  if (error || !prijsopgave) {
    return NextResponse.json(
      { error: `Prijsopgave aanmaken mislukt: ${error?.message}` },
      { status: 500 }
    );
  }

  const pdfResultaat = await bewaarPrijsopgavePdf(service, {
    prijsopgaveId: prijsopgave.id,
    invoer,
    totalen
  });

  if (pdfResultaat.fout) {
    return NextResponse.json(
      { error: `${pdfResultaat.fout} (de prijsopgave is wel opgeslagen)` },
      { status: 500 }
    );
  }

  revalidatePath('/facturen/prijsopgaven');
  // Kopie van de PDF naar Google Drive (ná het antwoord, best effort).
  naDrive(lid, 'prijsopgave', prijsopgave.id);

  return NextResponse.json({ id: prijsopgave.id });
}
