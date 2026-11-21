import { plusDagen, vandaag as vandaagNL } from '@/lib/agenda/datum';
import { dashboardPlanning } from '@/lib/agenda/repo';
import { foutAntwoord, json, metSessie } from '@/lib/agenda/api';
import { metExterneAfspraken } from '@/lib/agenda/extern-server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/dashboard → { planning, vandaag }
// Jouw planning voor het dashboard (Vandaag, Deze week, Taken en het aantal uitgezet) in
// één verzoek: zelfde gegevens als bij het laden van de pagina (PlanningWidgets). Was vier
// losse verzoeken, elk met een eigen teamcheck. Alleen wat op JOUW naam staat.
export async function GET(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  const vandaag = vandaagNL();
  try {
    const planning = await dashboardPlanning(s.bron, vandaag);
    // Plus je afspraken uit gekoppelde Google- en Apple-agenda's (0035, 0040; best effort, max. 2,5 s).
    planning.afspraken = await metExterneAfspraken(createServiceRoleClient(s.lid.bewijs), s.lid.userId, vandaag, plusDagen(vandaag, 6), planning.afspraken);
    return json({ planning, vandaag });
  } catch (e) {
    return foutAntwoord(e);
  }
}
