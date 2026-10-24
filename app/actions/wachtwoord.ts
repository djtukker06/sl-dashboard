'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { toegangStatus } from '@/lib/auth/lidcheck';
import { siteUrl } from '@/lib/auth/site';
import { controleerLimieten, registreerPoging, sleutels } from '@/lib/auth/inlogpogingen';
import { LIMIETEN } from '@/lib/auth/limiet-kern';
import { logAudit } from '@/lib/audit';
import { wachtwoordGelekt } from '@/lib/auth/gelekt';

// Minstens 12 tekens (lengte telt het meest; een zin van een paar woorden is prima).
const MIN_LENGTE = 12;

// Stuurt een herstelmail. De link daarin komt binnen op /auth/callback, die de
// sessie opent en doorstuurt naar /nieuw-wachtwoord. We melden altijd hetzelfde,
// zodat je via dit formulier niet kunt uitzoeken welke e-mailadressen bestaan.
export async function vraagHerstelAan(formData: FormData) {
  const email = String(formData.get('email') || '').trim().slice(0, 320);
  if (!email) {
    redirect(`/wachtwoord-vergeten?error=${encodeURIComponent('Vul je e-mailadres in.')}`);
  }

  // Basis-URL uit een vaste instelling of een vaste lijst, nooit uit de Host-kop (lib/auth/site.ts).
  const h = await headers();

  // Hooguit 3 herstelmails per uur per adres. Daarboven melden we gewoon "verstuurd" (zelfde
  // antwoord als altijd), zodat dit formulier niets prijsgeeft en geen mailbom wordt.
  const sleutel = sleutels.herstel(email);
  const blok = await controleerLimieten([{ sleutel, ...LIMIETEN.wachtwoordVergeten }]);
  if (blok.geblokkeerd) redirect('/wachtwoord-vergeten?verstuurd=1');
  await registreerPoging([sleutel], false);
  await logAudit('wachtwoord_herstel_aangevraagd', {}, h);
  const basis = siteUrl(h.get('origin'));

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    email,
    basis ? { redirectTo: `${basis}/auth/callback?next=/nieuw-wachtwoord` } : undefined
  );

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
  if (wachtwoord.length > 200) fout('Kies een wachtwoord van hooguit 200 tekens.');
  if (wachtwoord !== herhaling) fout('De twee wachtwoorden zijn niet gelijk.');

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?error=${encodeURIComponent('Je sessie is verlopen. Vraag een nieuwe herstelmail aan.')}`);
  }

  // Alleen teamleden (migratie 0021); anders direct uitloggen. Heeft het account 2FA, dan
  // eerst de code (een herstellink alleen is niet genoeg om het wachtwoord te wijzigen).
  const toegang = await toegangStatus(supabase);
  if (toegang.lid === 'geen' || toegang.lid === 'storing') {
    await supabase.auth.signOut();
    redirect('/geen-toegang');
  }
  const heeftFactor = toegang.heeftFactor || (user.factors ?? []).some((f) => f.status === 'verified');
  if (heeftFactor && toegang.aal !== 'aal2') {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== 'aal2') redirect('/login/2fa?next=/nieuw-wachtwoord');
  }

  if (await wachtwoordGelekt(wachtwoord)) {
    fout('Dit wachtwoord komt voor in bekende datalekken. Kies een ander (bv. een zin van een paar woorden).');
  }

  const { error } = await supabase.auth.updateUser({ password: wachtwoord });
  if (error) {
    fout(
      error.code === 'same_password'
        ? 'Dit is je huidige wachtwoord. Kies een ander wachtwoord.'
        : 'Wachtwoord opslaan is mislukt. Probeer het opnieuw.'
    );
  }

  await logAudit('wachtwoord_gewijzigd', { userId: user.id }, await headers());
  redirect('/nieuw-wachtwoord?gelukt=1');
}
