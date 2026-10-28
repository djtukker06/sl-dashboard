import { NextResponse } from 'next/server';
import { eigenaarRoute } from '@/lib/auth/team';
import { BeheerFout, gebruikerAanmaken, gebruikersLijst } from '@/lib/auth/gebruikers';
import { valideerNieuweGebruiker } from '@/lib/auth/gebruikers-kern';
import { wachtwoordGelekt } from '@/lib/auth/gelekt';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

// Admin (met 2FA-sessie): alle gebruikers, en een nieuwe gebruiker aanmaken met een tijdelijk
// wachtwoord (bij de eerste login verplicht te vervangen).
export const GET = eigenaarRoute(async (_request, _ctx, lid) => {
  return NextResponse.json(await gebruikersLijst(lid), { headers: GEEN_CACHE });
}, { label: 'gebruikers' });

export const POST = eigenaarRoute(async (request, _ctx, lid) => {
  const v = valideerNieuweGebruiker(await request.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400, headers: GEEN_CACHE });
  if (await wachtwoordGelekt(v.waarde.wachtwoord)) {
    return NextResponse.json({ error: 'Dit wachtwoord komt voor in bekende datalekken. Kies een ander.' }, { status: 400, headers: GEEN_CACHE });
  }
  try {
    const id = await gebruikerAanmaken(lid, v.waarde);
    await logAudit('team_gebruiker_aangemaakt', { userId: lid.userId, doel: id, details: { soort: v.waarde.rol, status: v.waarde.boekhouding ? 'boekhouding' : 'beperkt' } }, request);
    return NextResponse.json({ ok: true, id }, { status: 201, headers: GEEN_CACHE });
  } catch (e) {
    if (e instanceof BeheerFout) return NextResponse.json({ error: e.message }, { status: e.status, headers: GEEN_CACHE });
    throw e;
  }
}, { label: 'gebruikers' });
