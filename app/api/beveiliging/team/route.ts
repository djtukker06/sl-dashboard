import { NextResponse } from 'next/server';
import { eigenaarRoute } from '@/lib/auth/team';
import { teamBeveiliging } from '@/lib/auth/beveiliging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Eigenaar: overzicht van het team met 2FA-status en laatste login.
export const GET = eigenaarRoute(async (_request, _ctx, lid) => {
  const leden = await teamBeveiliging(lid);
  return NextResponse.json({ leden }, { headers: { 'Cache-Control': 'private, no-store' } });
}, { label: 'beveiliging' });
