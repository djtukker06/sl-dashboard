'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { veiligVervolg } from '@/lib/vervolg';

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  // Terug naar de pagina waar je vandaan kwam (proxy.ts zet ?next=); alleen interne paden.
  const vervolg = veiligVervolg(formData.get('next'));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const terug = vervolg !== '/' ? `&next=${encodeURIComponent(vervolg)}` : '';
    redirect(`/login?error=${encodeURIComponent('Inloggen mislukt. Controleer e-mailadres en wachtwoord.')}${terug}`);
  }

  redirect(vervolg);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
