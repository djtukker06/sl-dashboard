import 'server-only';
import { NextResponse } from 'next/server';
import { controleerRoute, metTeamlid, type Teamlid } from '@/lib/auth/team';
import { logFout } from '@/lib/log';
import { kiesRepo } from './modus';
import { BoekhoudFout, type BoekhoudRepo } from './repo/types';

// Gedeelde stukken voor de boekhoud-API (/api/boekhouding/**). Elke route:
//   1. controleert sessie + teamlidmaatschap (lib/auth/team.ts; 401/403) als eerste stap;
//   2. bij wijzigende verzoeken: Origin moet de eigen site zijn (lib/auth/herkomst.ts);
//   3. kiest de opslag (live met RLS of de demo; lib/boekhouding/modus.ts);
//   4. vertaalt fouten naar een nette JSON-melding (vergrendelde periode → 409).

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, error: string, code?: string) {
  return json(code ? { error, code } : { error }, status);
}

export interface BkContext {
  lid: Teamlid;
  repo: BoekhoudRepo;
}

type Handler<C> = (request: Request, ctx: C, bk: BkContext) => Promise<Response>;

/** Wikkelt een boekhoud-route: teamlidcontrole, herkomst, opslag kiezen en fouten vertalen. */
export function bkRoute<C>(fn: Handler<C>, opties: { alleenEigenaar?: boolean } = {}) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const c = await controleerRoute(request);
    if ('antwoord' in c) return c.antwoord;
    const lid = c.lid;
    if (opties.alleenEigenaar && (lid.rol !== 'eigenaar' || lid.tfa.aal !== 'aal2')) {
      return fout(403, 'Alleen de eigenaar (ingelogd met 2FA) kan dit.', 'geen_eigenaar');
    }
    try {
      return await metTeamlid(lid, async () => fn(request, ctx, { lid, repo: await kiesRepo(lid) }));
    } catch (e) {
      if (e instanceof BoekhoudFout) return fout(e.status, e.message, e.code);
      logFout('[boekhouding]', e);
      return fout(500, 'Er ging iets mis. Probeer het opnieuw.');
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
