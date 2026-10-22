import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { controleerRoute, type Teamlid } from '@/lib/auth/team';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
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
 * Eerste stap van elke agenda-route: sessie + teamlidmaatschap controleren (lib/auth/team.ts)
 * en bij wijzigende verzoeken de herkomst. Geeft de gebruikerscliënt (RLS) en het teamlid
 * terug, of een kant-en-klaar 401/403/503-antwoord.
 */
export async function metSessie(
  request: Request
): Promise<{ sb: SupabaseClient; lid: Teamlid } | { antwoord: NextResponse }> {
  const c = await controleerRoute(request);
  if ('antwoord' in c) return c;
  return { sb: c.lid.sb, lid: c.lid };
}

/**
 * Brug tot de taken-popup (stap 3): een nieuwe taak/afspraak hoort bij de maker. Zonder
 * migratie 0021 (geen koppeltabel) wordt dit stil overgeslagen.
 */
export async function koppelAanMaker(
  sb: SupabaseClient,
  soort: 'taak' | 'afspraak',
  id: string,
  userId: string
): Promise<void> {
  const { error } =
    soort === 'taak'
      ? await sb.from('task_assignees').insert({ task_id: id, user_id: userId })
      : await sb.from('event_attendees').insert({ event_id: id, user_id: userId });
  if (error && !tabelOntbreekt(error) && error.code !== '23505') {
    console.error('[agenda] koppelen aan maker mislukt', error.code ?? '', error.message);
  }
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
