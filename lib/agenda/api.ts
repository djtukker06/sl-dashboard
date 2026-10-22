import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { AgendaFout } from './repo';

// Gedeelde stukken voor de agenda-API-routes (/api/agenda, /api/taken, /api/afspraken).

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, error: string, code?: string) {
  return json(code ? { error, code } : { error }, status);
}

/**
 * Eerste stap van elke agenda-route: de Supabase-sessie controleren. Geeft de
 * gebruikerscliënt (RLS) terug, of een 401-antwoord.
 */
export async function metSessie(): Promise<{ sb: SupabaseClient } | { antwoord: NextResponse }> {
  const sb = await createClient();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) return { antwoord: fout(401, 'Niet ingelogd.', 'niet_ingelogd') };
  return { sb };
}

/** Vangt fouten af tot een nette JSON-fout (503 tabel_ontbreekt vóór de migratie). */
export function foutAntwoord(e: unknown) {
  if (e instanceof AgendaFout) return fout(e.status, e.message, e.code);
  console.error('[agenda]', e);
  return fout(500, 'Er ging iets mis. Probeer het opnieuw.');
}

/** Leest de JSON-body; ongeldige JSON geeft null. */
export async function leesBody<T>(request: Request): Promise<T | null> {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as T) : null;
  } catch {
    return null;
  }
}
