'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export async function deleteQuote(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Niet ingelogd.');
  }

  const service = createServiceRoleClient();

  const { data: prijsopgave } = await service
    .from('quotes')
    .select('pdf_path')
    .eq('id', id)
    .single();

  if (prijsopgave?.pdf_path) {
    await service.storage.from('invoices').remove([prijsopgave.pdf_path]);
  }

  await service.from('quotes').delete().eq('id', id);

  revalidatePath('/prijsopgaven');
}
