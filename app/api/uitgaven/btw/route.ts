import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { fout, json, uitgavenRoute } from '@/lib/uitgaven/api';
import { btwOverzicht } from '@/lib/uitgaven/btw';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/uitgaven/btw?jaar=2026 → { overzicht }
// Per kwartaal: voorbelasting (uitgaven) en btw op verstuurde facturen (alleen gelezen).
// Een indicatie, geen aangifte.
export const GET = uitgavenRoute(async (request, _ctx, sb) => {
  const ruw = new URL(request.url).searchParams.get('jaar');
  const jaar = ruw ? Number(ruw) : Number(vandaagNL().slice(0, 4));
  if (!Number.isInteger(jaar) || jaar < 2000 || jaar > 2100) return fout(400, 'Ongeldig jaar.');
  return json({ overzicht: await btwOverzicht(sb, jaar) });
});
