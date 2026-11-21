import { teamlidRoute } from '@/lib/auth/team';
import { leesBody } from '@/lib/agenda/api';
import type { AfspraakInvoer } from '@/lib/agenda/types';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { appleAfspraak, verwijderAppleAfspraak, wijzigAppleAfspraak } from '@/lib/apple-agenda/afspraken';
import { isAppleAfspraakId } from '@/lib/apple-agenda/id-kern';
import { appleFoutAntwoord, fout, json } from '@/lib/apple-agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// [id] = "a.<agenda>.<bestand>[~<voorkomen>]" (lib/apple-agenda/id-kern.ts)

// GET /api/apple-agenda/afspraken/[id] → { event }
export const GET = teamlidRoute<Ctx>(async (_request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isAppleAfspraakId(id)) return fout(404, 'Afspraak niet gevonden.');
  try {
    return json({ event: await appleAfspraak(createServiceRoleClient(lid.bewijs), lid.userId, id) });
  } catch (e) {
    return appleFoutAntwoord(e);
  }
}, { label: 'apple-agenda' });

// PATCH /api/apple-agenda/afspraken/[id]  (velden als AfspraakInvoer; toepassen 'deze'|'reeks') → { event }
export const PATCH = teamlidRoute<Ctx>(async (request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isAppleAfspraakId(id)) return fout(404, 'Afspraak niet gevonden.');
  const body = await leesBody<AfspraakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  try {
    return json({ event: await wijzigAppleAfspraak(createServiceRoleClient(lid.bewijs), lid.userId, id, body) });
  } catch (e) {
    return appleFoutAntwoord(e);
  }
}, { label: 'apple-agenda' });

// DELETE /api/apple-agenda/afspraken/[id]?toepassen=deze|reeks → { ok: true }
export const DELETE = teamlidRoute<Ctx>(async (request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isAppleAfspraakId(id)) return fout(404, 'Afspraak niet gevonden.');
  const t = new URL(request.url).searchParams.get('toepassen');
  try {
    await verwijderAppleAfspraak(createServiceRoleClient(lid.bewijs), lid.userId, id, t === 'deze' || t === 'reeks' ? t : null);
    return json({ ok: true });
  } catch (e) {
    return appleFoutAntwoord(e);
  }
}, { label: 'apple-agenda' });
