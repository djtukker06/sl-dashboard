import { tfaRoute, antwoord, fout, leesJson } from '@/lib/auth/tfa-api';
import { apparaatNaam, MAX_FACTOREN, veiligeQr } from '@/lib/auth/tfa-kern';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stap 1 van 2FA instellen: een nieuwe (nog onbevestigde) TOTP-factor bij Supabase. Geeft de
// QR-code (SVG als data-URI, van Supabase zelf) en de geheime sleutel om met de hand in te
// voeren. Pas na een goede code (…/bevestigen) telt de factor. Oude, nooit bevestigde
// pogingen ruimen we eerst op.
export const POST = tfaRoute(async (request, sessie) => {
  if (sessie.stap === 'uitdaging') return fout(403, 'Vul eerst je code in.', 'tfa_nodig');
  if (sessie.tfa.factoren.length >= MAX_FACTOREN) {
    return fout(400, `Je hebt al ${MAX_FACTOREN} apparaten. Verwijder er eerst één.`, 'te_veel_factoren');
  }
  const body = await leesJson(request);

  const { data: lijst } = await sessie.sb.auth.mfa.listFactors();
  for (const f of lijst?.all ?? []) {
    if (f.status !== 'verified') await sessie.sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => null);
  }

  const naam = apparaatNaam(body.naam, sessie.tfa.factoren.map((f) => f.naam));
  const { data, error } = await sessie.sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: naam, issuer: 'Studio Levant' });
  if (error || !data || data.type !== 'totp') {
    return fout(502, 'Tweestapsverificatie instellen lukt nu niet. Staat MFA (TOTP) aan in Supabase? Probeer het zo opnieuw.', 'enroll');
  }
  return antwoord({
    factorId: data.id,
    naam,
    qr: veiligeQr(data.totp.qr_code),
    geheim: data.totp.secret
  });
});
