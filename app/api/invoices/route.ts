import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { controleerRoute } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { parseFactuurInvoer, type FactuurInvoerBody } from '@/lib/invoice/invoer';
import { upsertKlant } from '@/lib/invoice/opslag';
import { maakFactuurAan } from '@/lib/invoice/aanmaken';
import { naDrive } from '@/lib/drive/kopieen';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  // Sessie + teamlidmaatschap (401/403) en bij wijzigen de herkomst (lib/auth/team.ts).
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const lid = toegang.lid;

  const body: FactuurInvoerBody = await request.json();
  const parsed = parseFactuurInvoer(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.fout }, { status: 400 });
  }
  const invoer = parsed.invoer;

  const service = createServiceRoleClient(lid.bewijs);

  const klantResultaat = await upsertKlant(service, invoer.klant);
  if (!klantResultaat.ok) {
    return NextResponse.json({ error: klantResultaat.fout }, { status: 500 });
  }
  const clientId = klantResultaat.id;

  const resultaat = await maakFactuurAan(service, { invoer, clientId });
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
  // Kopie van de PDF naar Google Drive, ná het antwoord en best effort (lib/drive/kopieen.ts).
  naDrive(lid, 'factuur', resultaat.id);

  return NextResponse.json({ id: resultaat.id, invoiceNumber: resultaat.invoiceNumber });
}
