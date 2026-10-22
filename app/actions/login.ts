'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { controleerLid } from '@/lib/auth/lidcheck';
import { veiligVervolg } from '@/lib/vervolg';

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  // Terug naar de pagina waar je vandaan kwam (proxy.ts zet ?next=); alleen interne paden.
  const vervolg = veiligVervolg(formData.get('next'));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  const terug = vervolg !== '/' ? `&next=${encodeURIComponent(vervolg)}` : '';
  if (error) {
    redirect(`/login?error=${encodeURIComponent('Inloggen mislukt. Controleer e-mailadres en wachtwoord.')}${terug}`);
  }

  // Alleen actieve teamleden komen erin (migratie 0021). Een geldig account zonder
  // lidmaatschap wordt meteen weer uitgelogd.
  const lid = await controleerLid(supabase);
  if (lid === 'geen' || lid === 'storing') {
    await supabase.auth.signOut();
    const melding =
      lid === 'geen'
        ? 'Dit account heeft geen toegang tot de backoffice.'
        : 'Inloggen lukt nu even niet. Probeer het zo opnieuw.';
    redirect(`/login?error=${encodeURIComponent(melding)}${terug}`);
  }

  redirect(vervolg);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
