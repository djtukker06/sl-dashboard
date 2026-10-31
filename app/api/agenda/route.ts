import { dagenTussen, isDag } from '@/lib/agenda/datum';
import { agendaBereik } from '@/lib/agenda/repo';
import { fout, foutAntwoord, json, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/agenda?van=YYYY-MM-DD&tot=YYYY-MM-DD → { tasks, events, herhaling }
// Taken met een datum in het bereik (open én afgerond) en afspraken die die dagen raken
// (herhalende als losse voorkomens). herhaling: of migratie 0034 (herhalen) er is.
// Alleen die van jou (toegewezen / deelnemer). Er is geen teamweergave; een oude ?wie=…
// wordt genegeerd.
export async function GET(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { searchParams } = new URL(request.url);
  const van = searchParams.get('van');
  const tot = searchParams.get('tot');
  if (!isDag(van) || !isDag(tot)) return fout(400, 'Geef van en tot op als YYYY-MM-DD.');
  const dagen = dagenTussen(van, tot);
  if (dagen < 0) return fout(400, '"tot" ligt vóór "van".');
  if (dagen > 61) return fout(400, 'Vraag maximaal 62 dagen tegelijk op.');

  try {
    const { taken, afspraken, herhaling } = await agendaBereik(s.bron, van, tot);
    return json({ tasks: taken, events: afspraken, herhaling });
  } catch (e) {
    return foutAntwoord(e);
  }
}
