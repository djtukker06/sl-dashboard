import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { bucketOntbreekt, tabelOntbreekt } from '@/lib/db/ontbreekt';

// Gedeelde stukken voor de uitgaven-API (/api/uitgaven/**). Elke route:
//   1. controleert zelf de Supabase-sessie (401 zonder sessie);
//   2. bij wijzigende verzoeken: Origin moet de eigen site zijn (zoals de mail-API);
//   3. gebruikt voor de tabellen de gebruikerscliënt (RLS) en alleen voor Storage de
//      service-role (lib/uitgaven/opslag.ts), ná die sessiecheck;
//   4. geeft vóór de migratie een 503 met code tabel_ontbreekt / opslag_ontbreekt.

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export const NIET_INGERICHT =
  'Uitgaven is nog niet ingericht: voer in Supabase het bestand supabase/UITVOEREN_0020_UITGAVEN.sql uit.';
export const OPSLAG_NIET_INGERICHT =
  'De opslag voor bonnetjes (bucket "uitgaven") bestaat nog niet: voer in Supabase supabase/UITVOEREN_0020_UITGAVEN.sql uit.';

export class UitgavenFout extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, error: string, code?: string) {
  return json(code ? { error, code } : { error }, status);
}

/** Zet een Supabase-fout om naar een UitgavenFout (503 als de tabellen nog niet bestaan). */
export function dbFout(error: unknown): UitgavenFout {
  if (tabelOntbreekt(error)) return new UitgavenFout(503, NIET_INGERICHT, 'tabel_ontbreekt');
  if (bucketOntbreekt(error)) return new UitgavenFout(503, OPSLAG_NIET_INGERICHT, 'opslag_ontbreekt');
  console.error('[uitgaven]', error);
  const code = (error as { code?: string } | null)?.code;
  if (code === '23503') return new UitgavenFout(400, 'Die klant bestaat niet (meer).');
  if (code === '23514') return new UitgavenFout(400, 'De invoer voldoet niet aan de regels. Controleer de velden.');
  if (code === '22P02' || code === '22003') return new UitgavenFout(400, 'Ongeldige invoer.');
  if (code === '23505') return new UitgavenFout(409, 'Dit bestand is al gekoppeld.');
  return new UitgavenFout(500, 'Er ging iets mis bij het opslaan of ophalen van de uitgaven.');
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

type Handler<C> = (request: Request, ctx: C, sb: SupabaseClient) => Promise<Response>;

/**
 * Wikkelt een uitgaven-route: sessiecheck (eerste stap, vóór alles), herkomstcheck bij
 * muterende verzoeken en nette foutafhandeling. De handler krijgt de gebruikerscliënt.
 */
export function uitgavenRoute<C>(fn: Handler<C>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const sb = await createClient();
    const {
      data: { user }
    } = await sb.auth.getUser();
    if (!user) return fout(401, 'Niet ingelogd.', 'niet_ingelogd');
    if (request.method !== 'GET' && request.method !== 'HEAD' && !eigenHerkomst(request)) {
      return fout(403, 'Ongeldige herkomst.');
    }
    try {
      return await fn(request, ctx, sb);
    } catch (e) {
      if (e instanceof UitgavenFout) return fout(e.status, e.message, e.code);
      console.error('[uitgaven]', e);
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

/** Content-Disposition voor een download (ASCII-fallback + UTF-8). */
export function contentDisposition(naam: string, soort: 'attachment' | 'inline' = 'attachment') {
  const ascii = naam.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${soort}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(naam)}`;
}
