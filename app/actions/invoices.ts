'use server';

import { revalidatePath } from 'next/cache';
import { isUuid, vereisTeamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { logAudit } from '@/lib/audit';

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

  // Eerst de rij; mislukt dat, dan blijft de factuur mét PDF staan (net als de API-route).
  // Het factuurnummer komt daarna weer vrij als voorstel (zie migratie 0005).
  const { error } = await service.from('invoices').delete().eq('id', id);
  if (error) {
    console.error('[facturen] verwijderen mislukt', error.code ?? '');
    throw new Error('Verwijderen is mislukt. Probeer het opnieuw.');
  }

  if (invoice?.pdf_path) {
    await service.storage.from('invoices').remove([invoice.pdf_path]);
  }
  await logAudit('verwijderd_factuur', { lid, doel: id });

  revalidatePath('/facturen');
}
