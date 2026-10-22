import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { controleerRoute, type Teamlid } from '@/lib/auth/team';
import { isUuid } from './invoer';
import { AgendaFout, type AgendaBron } from './repo';
import type { Wie } from './types';

// Gedeelde stukken voor de agenda-API-routes (/api/agenda, /api/taken, /api/afspraken).

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, error: string, code?: string) {
  return json(code ? { error, code } : { error }, status);
}

/**
 * Eerste stap van elke agenda-route: sessie + teamlidmaatschap controleren (lib/auth/team.ts)
 * en bij wijzigende verzoeken de herkomst. Geeft de gebruikerscliënt (RLS) en het teamlid
 * terug, of een kant-en-klaar 401/403/503-antwoord.
 */
export async function metSessie(
  request: Request
): Promise<{ sb: SupabaseClient; lid: Teamlid; bron: AgendaBron } | { antwoord: NextResponse }> {
  const c = await controleerRoute(request);
  if ('antwoord' in c) return c;
  return { sb: c.lid.sb, lid: c.lid, bron: bronVan(c.lid) };
}

/** De databasebron voor de agenda-repo: gebruikerscliënt (RLS), wie, en of 0021 er is. */
export function bronVan(lid: Teamlid): AgendaBron {
  return { sb: lid.sb, userId: lid.userId, team: !lid.overgang };
}

/** ?wie=ik|team|<user-id> (standaard: ik). Ongeldig → null. */
export function leesWie(v: string | null): Wie | null {
  if (!v || v === 'ik') return 'ik';
  if (v === 'team') return 'team';
  return isUuid(v) ? v.toLowerCase() : null;
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
