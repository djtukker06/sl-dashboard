'use server';

import { revalidatePath } from 'next/cache';
import { isUuid, vereisTeamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export async function deleteInvoice(id: string) {
  // Sessie + teamlidmaatschap vóór de service-role (lib/auth/team.ts).
  const lid = await vereisTeamlid();
  if (!lid) {
    throw new Error('Geen toegang.');
  }
  if (!isUuid(id)) {
    throw new Error('Niet gevonden.');
  }

  const service = createServiceRoleClient(lid.bewijs);

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

  revalidatePath('/facturen');
}
