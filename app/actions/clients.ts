'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isUuid, vereisTeamlid } from '@/lib/auth/team';

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
  // Sessie + teamlidmaatschap (lib/auth/team.ts); daarna de gebruikerscliënt (RLS).
  const lid = await vereisTeamlid();
  if (!lid) {
    return { error: 'Geen toegang. Log opnieuw in.' };
  }
  if (!isUuid(id)) {
    return { error: 'Klant niet gevonden.' };
  }
  const supabase = lid.sb;

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

  revalidatePath('/facturen');
  revalidatePath(`/facturen/klanten/${id}`);
  return {};
}

export async function deleteClient(id: string): Promise<KlantActieResultaat> {
  // Sessie + teamlidmaatschap (lib/auth/team.ts); daarna de gebruikerscliënt (RLS).
  const lid = await vereisTeamlid();
  if (!lid) {
    return { error: 'Geen toegang. Log opnieuw in.' };
  }
  if (!isUuid(id)) {
    return { error: 'Klant niet gevonden.' };
  }
  const supabase = lid.sb;

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

  revalidatePath('/facturen');
  redirect('/facturen');
}
