import { NextResponse } from 'next/server';
import { controleerRoute, metTeamlid, type Teamlid } from '@/lib/auth/team';
import { mailConfigVoor, type MailConfig } from './config';
import { MailFout } from './fout';

// Gedeelde stukken voor de mail-API-routes (/api/mail/**). Elke route:
//   1. controleert sessie + teamlidmaatschap (lib/auth/team.ts; 401/403);
//   2. bij ELK wijzigend verzoek (niet-GET): Origin moet de eigen site zijn (CSRF);
//   3. krijgt de mailbox van DIT teamlid (mailConfigVoor), nooit die van een ander;
//   4. geeft altijd Cache-Control: private, no-store (mail komt nooit in een gedeelde cache).

export const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, error: string, code?: string) {
  return json(code ? { error, code } : { error }, status);
}

/** Wat elke mail-handler meekrijgt: het teamlid en zijn eigen mailbox (null = niet gekoppeld). */
export interface MailContext {
  lid: Teamlid;
  cfg: MailConfig | null;
}

type Handler<C> = (request: Request, ctx: C, mail: MailContext) => Promise<Response>;

/** Wikkelt een mail-route: teamlidcontrole, herkomstcheck (elk niet-GET) en nette foutafhandeling. */
export function mailRoute<C>(fn: Handler<C>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const c = await controleerRoute(request);
    if ('antwoord' in c) return c.antwoord;
    try {
      const cfg = await mailConfigVoor(c.lid);
      return await metTeamlid(c.lid, () => fn(request, ctx, { lid: c.lid, cfg }));
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
