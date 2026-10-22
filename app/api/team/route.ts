import { teamProfielen } from '@/lib/team/profielen';
import { json, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/team → { mijnId, leden: [{ id, naam, voornaam, initialen, kleur, actief }] }
// Alleen weergavegegevens (geen e-mailadressen of rollen). Ook oud-teamleden komen mee
// (actief: false), zodat "aangemaakt door" bij oude items een naam houdt.
export async function GET(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  return json({ mijnId: s.lid.userId, leden: await teamProfielen(s.lid) });
}
