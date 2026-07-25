import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export async function DELETE(
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
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
