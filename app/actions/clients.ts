'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface KlantGegevens {
  company_name: string;
  contact_name: string;
  address: string;
  postal_code: string;
}

export interface KlantActieResultaat {
  error?: string;
}

export async function updateClient(
  id: string,
  gegevens: KlantGegevens
): Promise<KlantActieResultaat> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Niet ingelogd.' };
  }

  const bedrijfsnaam = gegevens.company_name.trim();
  if (!bedrijfsnaam) {
    return { error: 'Bedrijfsnaam mag niet leeg zijn.' };
  }

  const { data, error } = await supabase
    .from('clients')
    .update({
      company_name: bedrijfsnaam,
      contact_name: gegevens.contact_name.trim() || null,
      address: gegevens.address.trim() || null,
      postal_code: gegevens.postal_code.trim() || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select('id');

  if (error) {
    if (error.code === '23505') {
      return { error: `Er bestaat al een klant met de naam "${bedrijfsnaam}".` };
    }
    return { error: `Opslaan mislukt: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return { error: 'Klant niet gevonden.' };
  }

  revalidatePath('/');
  revalidatePath(`/klanten/${id}`);
  return {};
}

export async function deleteClient(id: string): Promise<KlantActieResultaat> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Niet ingelogd.' };
  }

  // Facturen zijn de administratie — een klant met facturen mag nooit zomaar
  // verdwijnen (de database blokkeert dit ook zelf via on delete restrict).
  const { count } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', id);

  if (count && count > 0) {
    return {
      error: `Deze klant heeft nog ${count} factu${count === 1 ? 'ur' : 'ren'} in het archief. Verwijder die eerst via het overzicht als je de klant echt wilt weghalen.`
    };
  }

  const { error } = await supabase.from('clients').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      return { error: 'Deze klant heeft nog facturen in het archief en kan daarom niet verwijderd worden.' };
    }
    return { error: `Verwijderen mislukt: ${error.message}` };
  }

  revalidatePath('/');
  redirect('/');
}
