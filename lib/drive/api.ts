import 'server-only';
import { NextResponse } from 'next/server';
import { controleerRoute, metTeamlid, type Teamlid } from '@/lib/auth/team';
import { DriveFout } from './kern';

// Gedeelde stukken voor /api/drive/**. Elke route:
//   1. controleert eerst sessie + teamlidmaatschap (lib/auth/team.ts: 401/403/503) en bij
//      wijzigende verzoeken de herkomst (403);
//   2. werkt daarna met de Drive-koppeling (lib/drive/koppeling.ts, service-role met bewijs);
//   3. zet een DriveFout om naar een nette JSON-fout met code (bv. 'opnieuw_koppelen').

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, error: string, code?: string) {
  return json(code ? { error, code } : { error }, status);
}

type Handler<C> = (request: Request, ctx: C, lid: Teamlid) => Promise<Response>;

export function driveRoute<C>(fn: Handler<C>, opties: { alleenEigenaar?: boolean } = {}) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const c = await controleerRoute(request);
    if ('antwoord' in c) return c.antwoord;
    if (opties.alleenEigenaar && c.lid.rol !== 'eigenaar') {
      return fout(403, 'Alleen de eigenaar kan dit doen.', 'geen_eigenaar');
    }
    try {
      return await metTeamlid(c.lid, () => fn(request, ctx, c.lid));
    } catch (e) {
      if (e instanceof DriveFout) {
        if (e.code === 'google') console.warn('[drive]', e.message);
        return fout(e.status, e.message, e.code);
      }
      console.error('[drive]', e);
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

/** Content-Disposition (ASCII-terugval + UTF-8). */
export function contentDisposition(naam: string, soort: 'attachment' | 'inline') {
  const ascii = naam.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${soort}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(naam)}`;
}
