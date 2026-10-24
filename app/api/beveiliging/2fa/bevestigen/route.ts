import { tfaRoute, antwoord, controleerCode, fout, leesJson } from '@/lib/auth/tfa-api';
import { schoneCode } from '@/lib/auth/tfa-kern';
import { isUuid } from '@/lib/auth/team';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stap 2 van 2FA instellen: de eerste code uit de app bevestigt de factor. Daarna staat de
// sessie op aal2 (cookies via @supabase/ssr).
export const POST = tfaRoute(async (request, sessie) => {
  if (sessie.stap === 'uitdaging') return fout(403, 'Vul eerst je code in.', 'tfa_nodig');
  const body = await leesJson(request);
  const code = schoneCode(body.code);
  if (!isUuid(body.factorId)) return fout(400, 'Begin opnieuw met instellen.', 'factor');
  if (!code) return fout(400, 'Vul de 6 cijfers uit je authenticator-app in.', 'code');

  const weigering = await controleerCode(sessie, body.factorId, code, request, 'inschrijven');
  if (weigering) return weigering;
  await logAudit('2fa_ingeschreven', { userId: sessie.userId, details: { factor: body.factorId.slice(0, 8), aantal: sessie.tfa.factoren.length + 1 } }, request);
  return antwoord({ ok: true });
});
