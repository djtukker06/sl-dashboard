import { after } from 'next/server';
import { teamlidRoute } from '@/lib/auth/team';
import { dagenTussen, isDag } from '@/lib/agenda/datum';
import { leesBody } from '@/lib/agenda/api';
import type { AfspraakInvoer } from '@/lib/agenda/types';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { googleBereik, maakGoogleAfspraak, verversLijsten } from '@/lib/google-agenda/afspraken';
import { GoogleAgendaFout, ingericht } from '@/lib/google-agenda/koppeling';
import { fout, googleFoutAntwoord, json } from '@/lib/google-agenda/api';
import { isUuid } from '@/lib/agenda/invoer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/google-agenda/afspraken?van=YYYY-MM-DD&tot=YYYY-MM-DD → GoogleBereik
// Afspraken uit je zichtbare Google-agenda's die die dagen raken (herhalende als losse
// voorkomens), plus je accounts en agenda's. Zonder migratie 0035: status.tabellen=false.
export const GET = teamlidRoute(async (request, _ctx, lid) => {
  const { searchParams } = new URL(request.url);
  const van = searchParams.get('van');
  const tot = searchParams.get('tot');
  if (!isDag(van) || !isDag(tot)) return fout(400, 'Geef van en tot op als YYYY-MM-DD.');
  const dagen = dagenTussen(van, tot);
  if (dagen < 0 || dagen > 61) return fout(400, 'Vraag maximaal 62 dagen tegelijk op.');
  const service = createServiceRoleClient(lid.bewijs);
  try {
    const { verouderd, ...uit } = await googleBereik(service, lid.userId, van, tot);
    // Agendalijst lang niet ververst (nieuwe of verwijderde agenda's in Google): na het antwoord.
    if (verouderd.length) after(() => verversLijsten(service, lid.userId, verouderd));
    return json(uit);
  } catch (e) {
    if (e instanceof GoogleAgendaFout && e.code === 'tabel_ontbreekt') {
      return json({ status: { ingericht: ingericht(), tabellen: false, accounts: [] }, events: [], fouten: [] });
    }
    return googleFoutAntwoord(e);
  }
}, { label: 'google-agenda' });

// POST /api/google-agenda/afspraken  { agendaId, …AfspraakInvoer, meet? } → { event }
export const POST = teamlidRoute(async (request, _ctx, lid) => {
  const body = await leesBody<AfspraakInvoer & { agendaId?: unknown }>(request);
  if (!body || !isUuid(body.agendaId)) return fout(400, 'Kies een Google-agenda.');
  try {
    const event = await maakGoogleAfspraak(createServiceRoleClient(lid.bewijs), lid.userId, body.agendaId, body);
    return json({ event }, 201);
  } catch (e) {
    return googleFoutAntwoord(e);
  }
}, { label: 'google-agenda' });
