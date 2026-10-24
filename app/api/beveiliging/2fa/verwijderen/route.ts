import { tfaRoute, antwoord, controleerCode, fout, leesJson } from '@/lib/auth/tfa-api';
import { schoneCode } from '@/lib/auth/tfa-kern';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Een apparaat (factor) verwijderen. Vraagt een verse code van dát apparaat (en dus een
// sessie op aal2). Het laatste apparaat verwijderen kan niet zolang 2FA verplicht is: vraag
// dan de eigenaar om een reset (of scripts/2fa-herstel.mjs).
export const POST = tfaRoute(async (request, sessie) => {
  if (sessie.stap !== 'ok' || sessie.tfa.aal !== 'aal2') return fout(403, 'Log eerst in met je code.', 'tfa_nodig');
  const body = await leesJson(request);
  const factor = sessie.tfa.factoren.find((f) => f.id === body.factorId);
  if (!factor) return fout(404, 'Dit apparaat bestaat niet (meer).', 'factor');
  const code = schoneCode(body.code);
  if (!code) return fout(400, 'Vul de 6 cijfers uit de app op dit apparaat in.', 'code');
  if (sessie.tfa.factoren.length <= 1 && sessie.tfa.afdwingen && sessie.tfa.migratie) {
    return fout(400, 'Je laatste apparaat verwijderen kan niet: tweestapsverificatie is verplicht. Voeg eerst een ander apparaat toe.', 'laatste');
  }

  const weigering = await controleerCode(sessie, factor.id, code, request, 'verwijderen');
  if (weigering) return weigering;
  const { error } = await sessie.sb.auth.mfa.unenroll({ factorId: factor.id });
  if (error) return fout(502, 'Verwijderen lukt nu niet. Probeer het zo opnieuw.', 'unenroll');
  await logAudit('2fa_verwijderd', { userId: sessie.userId, details: { factor: factor.id.slice(0, 8), naam: factor.naam } }, request);
  return antwoord({ ok: true });
});
