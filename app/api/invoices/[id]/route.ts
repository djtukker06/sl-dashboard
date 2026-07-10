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

  // Let op: het factuurnummer wordt hier bewust NIET vrijgegeven — de teller in
  // invoice_counters telt gewoon door, ook na verwijdering.
  const { error: deleteError } = await service.from('invoices').delete().eq('id', id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
