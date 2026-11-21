import { after } from 'next/server';
import { teamlidRoute } from '@/lib/auth/team';
import { dagenTussen, isDag } from '@/lib/agenda/datum';
import { leesBody } from '@/lib/agenda/api';
import { isUuid } from '@/lib/agenda/invoer';
import type { AfspraakInvoer } from '@/lib/agenda/types';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { appleBereik, maakAppleAfspraak } from '@/lib/apple-agenda/afspraken';
import { verversLijsten } from '@/lib/apple-agenda/koppeling';
import { appleFoutAntwoord, fout, json } from '@/lib/apple-agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/apple-agenda/afspraken?van=YYYY-MM-DD&tot=YYYY-MM-DD → ExternBereik
// Afspraken uit je zichtbare Apple-agenda's die die dagen raken (herhalende als losse
// voorkomens), plus je accounts en agenda's. Zonder migratie 0040: status.apple.tabellen=false.
export const GET = teamlidRoute(async (request, _ctx, lid) => {
  const { searchParams } = new URL(request.url);
  const van = searchParams.get('van');
  const tot = searchParams.get('tot');
  if (!isDag(van) || !isDag(tot)) return fout(400, 'Geef van en tot op als YYYY-MM-DD.');
  const dagen = dagenTussen(van, tot);
  if (dagen < 0 || dagen > 61) return fout(400, 'Vraag maximaal 62 dagen tegelijk op.');
  const service = createServiceRoleClient(lid.bewijs);
  try {
    const { verouderd, ...uit } = await appleBereik(service, lid.userId, van, tot);
    // Agendalijst lang niet ververst (nieuwe of verwijderde agenda's in iCloud): na het antwoord.
    if (verouderd.length) after(() => verversLijsten(service, verouderd));
    return json(uit);
  } catch (e) {
    return appleFoutAntwoord(e);
  }
}, { label: 'apple-agenda' });

// POST /api/apple-agenda/afspraken  { agendaId, …AfspraakInvoer } → { event }
export const POST = teamlidRoute(async (request, _ctx, lid) => {
  const body = await leesBody<AfspraakInvoer & { agendaId?: unknown }>(request);
  if (!body || !isUuid(body.agendaId)) return fout(400, 'Kies een Apple-agenda.');
  try {
    const event = await maakAppleAfspraak(createServiceRoleClient(lid.bewijs), lid.userId, body.agendaId, body);
    return json({ event }, 201);
  } catch (e) {
    return appleFoutAntwoord(e);
  }
}, { label: 'apple-agenda' });
