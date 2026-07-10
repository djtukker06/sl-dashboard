'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // TIJDELIJK: toont de echte Supabase-foutmelding i.p.v. een generieke tekst, om een
    // productieprobleem te kunnen diagnosticeren. Zet terug naar een generieke melding
    // zodra het probleem is opgelost.
    redirect(`/login?error=${encodeURIComponent(`Inloggen mislukt: ${error.message} (status ${error.status})`)}`);
  }

  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
