import { NextResponse } from 'next/server';
import { eigenaarRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

// Eigenaar (met 2FA-sessie): de tweestapsverificatie van een teamlid resetten, bv. bij een
// kwijtgeraakte telefoon. Alle factoren van dat lid gaan weg; bij de volgende keer inloggen
// stelt hij 2FA opnieuw in. Met reden in de audit-log. Je eigen 2FA reset je hier niet (dat
// gaat via Account, of in nood met scripts/2fa-herstel.mjs).
export const POST = eigenaarRoute<Ctx>(async (request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Onbekend teamlid.' }, { status: 400, headers: GEEN_CACHE });
  if (id === lid.userId) {
    return NextResponse.json({ error: 'Je eigen apparaten beheer je via Account.' }, { status: 400, headers: GEEN_CACHE });
  }
  const body = (await request.json().catch(() => null)) as { reden?: unknown } | null;
  const reden = typeof body?.reden === 'string' ? body.reden.trim().slice(0, 200) : '';
  if (reden.length < 3) return NextResponse.json({ error: 'Geef een korte reden op (bv. "telefoon kwijt").' }, { status: 400, headers: GEEN_CACHE });

  const sb = createServiceRoleClient(lid.bewijs);
  const { data: lidRij } = await sb.from('team_members').select('user_id').eq('user_id', id).maybeSingle();
  if (!lidRij) return NextResponse.json({ error: 'Onbekend teamlid.' }, { status: 404, headers: GEEN_CACHE });

  const { data, error } = await sb.auth.admin.mfa.listFactors({ userId: id });
  if (error) throw error;
  let verwijderd = 0;
  for (const f of data?.factors ?? []) {
    const r = await sb.auth.admin.mfa.deleteFactor({ id: f.id, userId: id });
    if (r.error) throw r.error;
    verwijderd++;
  }
  await logAudit('2fa_reset_door_eigenaar', { userId: lid.userId, doel: id, details: { reden, aantal: verwijderd } }, request);
  return NextResponse.json({ ok: true, verwijderd }, { headers: GEEN_CACHE });
}, { label: 'beveiliging' });
