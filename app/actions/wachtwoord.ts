'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const MIN_LENGTE = 8;

// Stuurt een herstelmail. De link daarin komt binnen op /auth/callback, die de
// sessie opent en doorstuurt naar /nieuw-wachtwoord. We melden altijd hetzelfde,
// zodat je via dit formulier niet kunt uitzoeken welke e-mailadressen bestaan.
export async function vraagHerstelAan(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  if (!email) {
    redirect(`/wachtwoord-vergeten?error=${encodeURIComponent('Vul je e-mailadres in.')}`);
  }

  const h = await headers();
  const origin =
    h.get('origin') ||
    `${h.get('x-forwarded-proto') || 'http'}://${h.get('x-forwarded-host') || h.get('host')}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/nieuw-wachtwoord`
  });

  if (error && error.status === 429) {
    redirect(
      `/wachtwoord-vergeten?error=${encodeURIComponent('Er zijn net al herstelmails verstuurd. Wacht een minuut en probeer het opnieuw.')}`
    );
  }

  redirect('/wachtwoord-vergeten?verstuurd=1');
}

// Zet een nieuw wachtwoord voor de ingelogde gebruiker (na de herstellink, of
// gewoon vanuit het dashboard).
export async function zetNieuwWachtwoord(formData: FormData) {
  const wachtwoord = String(formData.get('password') || '');
  const herhaling = String(formData.get('password2') || '');

  const fout = (melding: string) =>
    redirect(`/nieuw-wachtwoord?error=${encodeURIComponent(melding)}`);

  if (wachtwoord.length < MIN_LENGTE) fout(`Kies een wachtwoord van minstens ${MIN_LENGTE} tekens.`);
  if (wachtwoord !== herhaling) fout('De twee wachtwoorden zijn niet gelijk.');

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?error=${encodeURIComponent('Je sessie is verlopen. Vraag een nieuwe herstelmail aan.')}`);
  }

  const { error } = await supabase.auth.updateUser({ password: wachtwoord });
  if (error) {
    fout(
      error.code === 'same_password'
        ? 'Dit is je huidige wachtwoord. Kies een ander wachtwoord.'
        : 'Wachtwoord opslaan is mislukt. Probeer het opnieuw.'
    );
  }

  redirect('/nieuw-wachtwoord?gelukt=1');
}
