import { teamlidRoute } from '@/lib/auth/team';
import { leesBody } from '@/lib/agenda/api';
import type { AfspraakInvoer } from '@/lib/agenda/types';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { googleAfspraak, verwijderGoogleAfspraak, wijzigGoogleAfspraak } from '@/lib/google-agenda/afspraken';
import { isGoogleAfspraakId } from '@/lib/google-agenda/kern';
import { fout, googleFoutAntwoord, json } from '@/lib/google-agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// /api/google-agenda/afspraken/g.<agenda-rij-id>.<event-id>
//   GET     → { event }
//   PATCH   AfspraakInvoer (+ toepassen 'deze'|'reeks', meet) → { event }
//   DELETE  ?toepassen=deze|reeks → { ok }
// Alleen in je eigen gekoppelde agenda's (de agenda-rij hoort bij jouw user-id).
async function idVan(ctx: Ctx): Promise<string | null> {
  const { id } = await ctx.params;
  const s = decodeURIComponent(id);
  return isGoogleAfspraakId(s) ? s : null;
}

export const GET = teamlidRoute<Ctx>(async (_request, ctx, lid) => {
  const id = await idVan(ctx);
  if (!id) return fout(404, 'Afspraak niet gevonden.');
  try {
    return json({ event: await googleAfspraak(createServiceRoleClient(lid.bewijs), lid.userId, id) });
  } catch (e) {
    return googleFoutAntwoord(e);
  }
}, { label: 'google-agenda' });

export const PATCH = teamlidRoute<Ctx>(async (request, ctx, lid) => {
  const id = await idVan(ctx);
  if (!id) return fout(404, 'Afspraak niet gevonden.');
  const body = await leesBody<AfspraakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  try {
    return json({ event: await wijzigGoogleAfspraak(createServiceRoleClient(lid.bewijs), lid.userId, id, body) });
  } catch (e) {
    return googleFoutAntwoord(e);
  }
}, { label: 'google-agenda' });

export const DELETE = teamlidRoute<Ctx>(async (request, ctx, lid) => {
  const id = await idVan(ctx);
  if (!id) return fout(404, 'Afspraak niet gevonden.');
  const t = new URL(request.url).searchParams.get('toepassen');
  try {
    await verwijderGoogleAfspraak(createServiceRoleClient(lid.bewijs), lid.userId, id, t === 'deze' || t === 'reeks' ? t : null);
    return json({ ok: true });
  } catch (e) {
    return googleFoutAntwoord(e);
  }
}, { label: 'google-agenda' });
