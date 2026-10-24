import { tfaRoute, antwoord, controleerCode, fout, leesJson } from '@/lib/auth/tfa-api';
import { schoneCode } from '@/lib/auth/tfa-kern';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// De code bij het inloggen (/login/2fa): zet de sessie van aal1 (wachtwoord) op aal2.
export const POST = tfaRoute(async (request, sessie) => {
  if (!sessie.tfa.factoren.length) return fout(400, 'Er is geen tweestapsverificatie ingesteld.', 'geen_factor');
  const body = await leesJson(request);
  const code = schoneCode(body.code);
  if (!code) return fout(400, 'Vul de 6 cijfers uit je authenticator-app in.', 'code');
  const factor = sessie.tfa.factoren.find((f) => f.id === body.factorId) ?? sessie.tfa.factoren[0];

  const weigering = await controleerCode(sessie, factor.id, code, request, 'inloggen');
  if (weigering) return weigering;
  await logAudit('2fa_gelukt', { userId: sessie.userId, details: { factor: factor.id.slice(0, 8) } }, request);
  return antwoord({ ok: true });
});
