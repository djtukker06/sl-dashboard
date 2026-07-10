'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export async function deleteInvoice(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Niet ingelogd.');
  }

  const service = createServiceRoleClient();

  const { data: invoice } = await service
    .from('invoices')
    .select('pdf_path')
    .eq('id', id)
    .single();

  if (invoice?.pdf_path) {
    await service.storage.from('invoices').remove([invoice.pdf_path]);
  }

  // Factuurnummer wordt bewust niet vrijgegeven — de teller blijft doortellen.
  await service.from('invoices').delete().eq('id', id);

  revalidatePath('/');
}
