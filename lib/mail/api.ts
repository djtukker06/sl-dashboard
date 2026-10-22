import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MailFout } from './fout';

// Gedeelde stukken voor de mail-API-routes (/api/mail/**). Elke route:
//   1. controleert zelf de Supabase-sessie (401 zonder sessie);
//   2. bij wijzigende verzoeken: Origin moet de eigen site zijn (CSRF);
//   3. geeft altijd Cache-Control: private, no-store (mail komt nooit in een gedeelde cache).

export const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, error: string, code?: string) {
  return json(code ? { error, code } : { error }, status);
}

function eigenHerkomst(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin GET/HEAD of oudere browsers; cookies zijn SameSite=Lax
  if (origin === new URL(request.url).origin) return true;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Handler<C> = (request: Request, ctx: C) => Promise<Response>;

/** Wikkelt een mail-route: sessiecheck, herkomstcheck (bij POST) en nette foutafhandeling. */
export function mailRoute<C>(fn: Handler<C>, opties: { muterend?: boolean } = {}): Handler<C> {
  return async (request, ctx) => {
    const sb = await createClient();
    const { data, error } = await sb.auth.getClaims();
    if (error || !data?.claims?.sub) return fout(401, 'Niet ingelogd.', 'niet_ingelogd');
    if (opties.muterend && !eigenHerkomst(request)) return fout(403, 'Ongeldige herkomst.');
    try {
      return await fn(request, ctx);
    } catch (e) {
      if (e instanceof MailFout) return fout(e.status, e.message, e.code);
      console.error('[mail]', (e as Error)?.message ?? e);
      return fout(500, 'Er ging iets mis met de mail. Probeer het opnieuw.');
    }
  };
}

/** Leest de JSON-body; ongeldige JSON geeft {}. */
export async function leesJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
