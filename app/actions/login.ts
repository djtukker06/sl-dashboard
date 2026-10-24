'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { toegangStatus } from '@/lib/auth/lidcheck';
import { veiligVervolg } from '@/lib/vervolg';
import { clientIp } from '@/lib/auth/hash';
import { alarmInloggen, controleerLimieten, limietenInloggen, registreerPoging } from '@/lib/auth/inlogpogingen';
import { wachtTekst } from '@/lib/auth/limiet-kern';
import { verseSessieCookie } from '@/lib/auth/sessie';
import { SESSIE_COOKIE } from '@/lib/auth/sessie-kern';
import { logAudit } from '@/lib/audit';

// Inloggen met e-mail + wachtwoord.
//   1. pogingenlimiet (per e-mailadres+IP 5 en per IP 20 mislukte pogingen per 15 minuten;
//      lib/auth/inlogpogingen.ts). Niet per e-mailadres alleen, zodat een aanvaller de
//      eigenaar niet kan buitensluiten; veel pogingen op één adres geven wel een alarm
//      ('inlog_verdacht') in de audit-log. De melding blijft algemeen: hij verraadt niet of
//      een adres bestaat. Dit is een extra drempel voor het formulier; de echte bescherming
//      tegen raden zit in de limieten van Supabase Auth (zie docs/BEVEILIGING.md);
//   2. alleen actieve teamleden (migratie 0021); een geldig account zonder lidmaatschap
//      wordt meteen weer uitgelogd;
//   3. heeft het account tweestapsverificatie: door naar /login/2fa voor de code.
//   Alles komt in de audit-log (mislukt alleen met een hash van het e-mailadres, intern).
export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '').trim().slice(0, 320);
  const password = String(formData.get('password') || '').slice(0, 1000);
  // Terug naar de pagina waar je vandaan kwam (proxy.ts zet ?next=); alleen interne paden.
  const vervolg = veiligVervolg(formData.get('next'));
  const terug = vervolg !== '/' ? `&next=${encodeURIComponent(vervolg)}` : '';

  const h = await headers();
  const ip = clientIp(h);
  const limieten = limietenInloggen(email, ip);
  const blok = await controleerLimieten(limieten);
  if (blok.geblokkeerd) {
    await logAudit('inlog_geblokkeerd', { bron: 'app' }, h);
    redirect(
      `/login?error=${encodeURIComponent(`Te veel inlogpogingen. Probeer het ${wachtTekst(blok.wachtMs)} opnieuw.`)}${terug}`
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    const alarm = alarmInloggen(email);
    await registreerPoging([...limieten.map((l) => l.sleutel), alarm.sleutel], false);
    await logAudit('inloggen_mislukt', { details: { reden: error?.code ?? 'onbekend' } }, h);
    // Veel mislukte pogingen op één adres (vanaf allerlei IP's): niet blokkeren, wel melden.
    if ((await controleerLimieten([alarm])).geblokkeerd) await logAudit('inlog_verdacht', { details: { reden: 'veel_pogingen_op_adres' } }, h);
    redirect(`/login?error=${encodeURIComponent('Inloggen mislukt. Controleer e-mailadres en wachtwoord.')}${terug}`);
  }

  // Alleen actieve teamleden komen erin (migratie 0021). Een geldig account zonder
  // lidmaatschap wordt meteen weer uitgelogd.
  const toegang = await toegangStatus(supabase);
  if (toegang.lid === 'geen' || toegang.lid === 'storing') {
    await supabase.auth.signOut();
    if (toegang.lid === 'geen') await logAudit('inloggen_mislukt', { userId: data.user.id, details: { reden: 'geen_teamlid' } }, h);
    const melding =
      toegang.lid === 'geen'
        ? 'Dit account heeft geen toegang tot de backoffice.'
        : 'Inloggen lukt nu even niet. Probeer het zo opnieuw.';
    redirect(`/login?error=${encodeURIComponent(melding)}${terug}`);
  }

  await registreerPoging([limieten[0].sleutel, alarmInloggen(email).sleutel], true);
  // Nieuwe sessie: het sessiebeleid (12 uur inactief / 14 dagen) begint opnieuw.
  const cookie = await verseSessieCookie();
  const jar = await cookies();
  if (cookie) jar.set(cookie);
  else jar.delete(SESSIE_COOKIE);

  // Factor uit de gebruiker zelf (werkt ook vóór 0026); toegang_status vult aan.
  const heeftFactor = toegang.heeftFactor || (data.user.factors ?? []).some((f) => f.status === 'verified');
  await logAudit('inloggen', { userId: data.user.id, details: { methode: heeftFactor ? 'wachtwoord+2fa' : 'wachtwoord' } }, h);
  if (heeftFactor) {
    redirect(`/login/2fa${vervolg !== '/' ? `?next=${encodeURIComponent(vervolg)}` : ''}`);
  }
  redirect(vervolg);
}

export async function signOut() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  (await cookies()).delete(SESSIE_COOKIE);
  if (user) await logAudit('uitloggen', { userId: user.id }, await headers());
  redirect('/login');
}
