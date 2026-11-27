import 'server-only';
import { NextResponse } from 'next/server';

// Gedeelde stukken voor de routes van de Meta-koppeling. Fouten als `{ fout, code? }` met een
// Nederlandse melding (het contract in lib/social/types.ts).

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

export function fout(status: number, melding: string, code?: string) {
  return json(code ? { fout: melding, code } : { fout: melding }, status);
}
