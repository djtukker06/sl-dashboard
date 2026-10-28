import { NextResponse } from 'next/server';
import { eigenaarRoute, isUuid } from '@/lib/auth/team';
import { BeheerFout, gebruikerVerwijderen, gebruikerWijzigen } from '@/lib/auth/gebruikers';
import { valideerWijziging } from '@/lib/auth/gebruikers-kern';
import { wachtwoordGelekt } from '@/lib/auth/gelekt';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

function fout(e: unknown): NextResponse {
  if (e instanceof BeheerFout) return NextResponse.json({ error: e.message }, { status: e.status, headers: GEEN_CACHE });
  throw e;
}

// Admin (met 2FA-sessie): gegevens, rol, boekhouding, (de)activeren of een nieuw tijdelijk
// wachtwoord.
export const PATCH = eigenaarRoute<Ctx>(async (request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Onbekende gebruiker.' }, { status: 400, headers: GEEN_CACHE });
  const v = valideerWijziging(await request.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400, headers: GEEN_CACHE });
  if (v.waarde.wachtwoord && (await wachtwoordGelekt(v.waarde.wachtwoord))) {
    return NextResponse.json({ error: 'Dit wachtwoord komt voor in bekende datalekken. Kies een ander.' }, { status: 400, headers: GEEN_CACHE });
  }
  try {
    const velden = await gebruikerWijzigen(lid, id, v.waarde);
    const actie =
      v.waarde.actief === false ? 'team_gebruiker_gedeactiveerd' : v.waarde.actief === true ? 'team_gebruiker_geactiveerd' : 'team_gebruiker_gewijzigd';
    await logAudit(actie, { userId: lid.userId, doel: id, details: { velden: velden.join(',') } }, request);
    return NextResponse.json({ ok: true }, { headers: GEEN_CACHE });
  } catch (e) {
    return fout(e);
  }
}, { label: 'gebruikers' });

// Admin: definitief verwijderen (het scherm vraagt eerst om het e-mailadres ter bevestiging).
export const DELETE = eigenaarRoute<Ctx>(async (request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Onbekende gebruiker.' }, { status: 400, headers: GEEN_CACHE });
  try {
    await gebruikerVerwijderen(lid, id);
    await logAudit('team_gebruiker_verwijderd', { userId: lid.userId, doel: id }, request);
    return NextResponse.json({ ok: true }, { headers: GEEN_CACHE });
  } catch (e) {
    return fout(e);
  }
}, { label: 'gebruikers' });
