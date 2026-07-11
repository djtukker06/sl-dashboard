'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');

  // TIJDELIJK diagnose-blok: laat zien welke env-vars aanwezig zijn en toont de echte
  // Supabase-foutmelding. Terugzetten naar de generieke melding zodra dit is opgelost.
  const urlAanwezig = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonAanwezig = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const urlPreview = process.env.NEXT_PUBLIC_SUPABASE_URL || '(leeg)';

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const diagnose = `url_aanwezig=${urlAanwezig} anon_aanwezig=${anonAanwezig} url=${urlPreview} | ${error.message} (status ${error.status})`;
    redirect(`/login?error=${encodeURIComponent(diagnose)}`);
  }

  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
