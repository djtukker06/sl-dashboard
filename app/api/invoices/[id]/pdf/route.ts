import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

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

  const { data: invoice, error: fetchError } = await service
    .from('invoices')
    .select('pdf_path')
    .eq('id', id)
    .single();

  if (fetchError || !invoice || !invoice.pdf_path) {
    return NextResponse.json({ error: 'Factuur-PDF niet gevonden.' }, { status: 404 });
  }

  const { data: signed, error: signError } = await service.storage
    .from('invoices')
    .createSignedUrl(invoice.pdf_path, 60);

  if (signError || !signed) {
    return NextResponse.json({ error: 'Kon geen downloadlink maken.' }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
