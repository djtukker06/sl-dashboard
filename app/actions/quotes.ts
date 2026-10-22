'use server';

import { revalidatePath } from 'next/cache';
import { isUuid, vereisTeamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export async function deleteQuote(id: string) {
  // Sessie + teamlidmaatschap vóór de service-role (lib/auth/team.ts).
  const lid = await vereisTeamlid();
  if (!lid) {
    throw new Error('Geen toegang.');
  }
  if (!isUuid(id)) {
    throw new Error('Niet gevonden.');
  }

  const service = createServiceRoleClient(lid.bewijs);

  const { data: prijsopgave } = await service
    .from('quotes')
    .select('pdf_path')
    .eq('id', id)
    .single();

  if (prijsopgave?.pdf_path) {
    await service.storage.from('invoices').remove([prijsopgave.pdf_path]);
  }

  await service.from('quotes').delete().eq('id', id);

  revalidatePath('/facturen/prijsopgaven');
}
