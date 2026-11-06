import { teamlidRoute, isUuid } from '@/lib/auth/team';
import { leesBody } from '@/lib/agenda/api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { isKleur } from '@/lib/google-agenda/kern';
import { googleStatus } from '@/lib/google-agenda/koppeling';
import { fout, googleFoutAntwoord, json } from '@/lib/google-agenda/api';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/google-agenda/agendas/[id]  { zichtbaar?, inFeed?, kleur? } → GoogleStatus
// Alleen een agenda van jezelf (user_id in de where).
export const PATCH = teamlidRoute<Ctx>(async (request, ctx, lid) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Agenda niet gevonden.');
  const body = await leesBody<{ zichtbaar?: unknown; inFeed?: unknown; kleur?: unknown }>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const rij: { zichtbaar?: boolean; in_feed?: boolean; kleur?: string } = {};
  if ('zichtbaar' in body) {
    if (typeof body.zichtbaar !== 'boolean') return fout(400, 'Ongeldige invoer.');
    rij.zichtbaar = body.zichtbaar;
  }
  if ('inFeed' in body) {
    if (typeof body.inFeed !== 'boolean') return fout(400, 'Ongeldige invoer.');
    rij.in_feed = body.inFeed;
  }
  if ('kleur' in body) {
    if (!isKleur(body.kleur)) return fout(400, 'Ongeldige kleur.');
    rij.kleur = body.kleur;
  }
  if (!Object.keys(rij).length) return fout(400, 'Niets om te wijzigen.');
  const service = createServiceRoleClient(lid.bewijs);
  try {
    const { data, error } = await service.from('google_agendas').update(rij).eq('id', id).eq('user_id', lid.userId).select('id').maybeSingle();
    if (error) {
      if (tabelOntbreekt(error)) return fout(503, 'Voer eerst supabase/UITVOEREN_0035.sql uit.', 'tabel_ontbreekt');
      throw error;
    }
    if (!data) return fout(404, 'Agenda niet gevonden.');
    return json(await googleStatus(service, lid.userId));
  } catch (e) {
    return googleFoutAntwoord(e);
  }
}, { label: 'google-agenda' });
