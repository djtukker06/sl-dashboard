import 'server-only';
import { NextResponse } from 'next/server';
import { logFout } from '@/lib/log';
import type { NotitieInvoer } from './kern';
import { NotitieFout } from './repo';

// Gedeelde stukken voor de Scratchpad-routes (/api/notities en /api/notities/[id]).

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, error: string, code?: string) {
  return json(code ? { error, code } : { error }, status);
}

/** Vangt fouten af tot een nette JSON-fout (503 tabel_ontbreekt vóór de migratie, 409 met de huidige versie). */
export function foutAntwoord(e: unknown) {
  if (e instanceof NotitieFout) {
    const body: Record<string, unknown> = { error: e.message };
    if (e.code) body.code = e.code;
    if (e.huidig) body.huidig = e.huidig;
    return json(body, e.status);
  }
  logFout('[notities]', e);
  return fout(500, 'Er ging iets mis. Probeer het opnieuw.');
}

/** Max. grootte van een verzoek: de inhoud (1 MB) plus wat ruimte voor de rest. */
const MAX_BODY = 1_600_000;

/** Leest de JSON-body; ongeldig of te groot geeft null. */
export async function leesBody(request: Request): Promise<NotitieInvoer | null> {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return null;
  try {
    const tekst = await request.text();
    if (tekst.length > MAX_BODY) return null;
    const b = JSON.parse(tekst);
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as NotitieInvoer) : null;
  } catch {
    return null;
  }
}
