import 'server-only';
import { NextResponse } from 'next/server';
import { logFout } from '@/lib/log';
import { logAudit } from '@/lib/audit';
import { eigenHerkomst, isWijzigend } from './herkomst';
import { tfaSessie, type TfaSessie } from './team';
import { controleerLimieten, registreerPoging, sleutels } from './inlogpogingen';
import { LIMIETEN, wachtTekst } from './limiet-kern';

// Gedeelde stukken voor de 2FA-routes (app/api/beveiliging/2fa/*). Die werken met de
// gebruikerscliënt met cookies (geen service-role): na een goede code zet Supabase een sessie
// op aal2 en schrijft @supabase/ssr die via de cookies terug.

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export function antwoord(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, melding: string, code?: string): NextResponse {
  return antwoord({ error: melding, ...(code ? { code } : {}) }, status);
}

export async function leesJson(request: Request): Promise<Record<string, unknown>> {
  const d = await request.json().catch(() => null);
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

/** Wikkelt een 2FA-route: herkomstcheck, sessie van een teamlid (ook vóór de code), nette 500. */
export function tfaRoute(fn: (request: Request, sessie: TfaSessie) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    if (isWijzigend(request.method) && !eigenHerkomst(request)) return fout(403, 'Ongeldige herkomst.', 'herkomst');
    const sessie = await tfaSessie();
    if (!sessie) return fout(401, 'Niet ingelogd.', 'niet_ingelogd');
    try {
      return await fn(request, sessie);
    } catch (e) {
      logFout('[2fa]', e);
      return fout(500, 'Er ging iets mis. Probeer het opnieuw.');
    }
  };
}

/**
 * Controleert een code met de pogingenlimiet (5 fout per 5 minuten per persoon). Bij
 * succes staat de sessie daarna op aal2.
 */
export async function controleerCode(
  sessie: TfaSessie,
  factorId: string,
  code: string,
  request: Request,
  doel: 'inschrijven' | 'inloggen' | 'verwijderen'
): Promise<NextResponse | null> {
  const sleutel = sleutels.tfa(sessie.userId);
  const blok = await controleerLimieten([{ sleutel, ...LIMIETEN.tfaCode }]);
  if (blok.geblokkeerd) {
    await logAudit('2fa_geblokkeerd', { userId: sessie.userId, details: { soort: doel } }, request);
    return fout(429, `Te veel foute codes. Probeer het ${wachtTekst(blok.wachtMs)} opnieuw.`, 'te_veel');
  }
  const { error } = await sessie.sb.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    await registreerPoging([sleutel], false);
    await logAudit('2fa_mislukt', { userId: sessie.userId, details: { soort: doel, reden: error.code ?? '' } }, request);
    return fout(400, 'Deze code klopt niet (of is verlopen). Probeer de nieuwste code uit je app.', 'code_fout');
  }
  await registreerPoging([sleutel], true);
  return null;
}
