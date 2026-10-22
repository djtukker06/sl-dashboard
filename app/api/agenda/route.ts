import { dagenTussen, isDag } from '@/lib/agenda/datum';
import { agendaBereik } from '@/lib/agenda/repo';
import { fout, foutAntwoord, json, leesWie, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/agenda?van=YYYY-MM-DD&tot=YYYY-MM-DD&wie=ik|team|<user-id> → { tasks, events }
// Taken met een datum in het bereik (open én afgerond) en afspraken die die dagen raken.
// Standaard alleen die van jou (toegewezen / deelnemer); wie=team toont het hele team.
export async function GET(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { searchParams } = new URL(request.url);
  const wie = leesWie(searchParams.get('wie'));
  if (!wie) return fout(400, 'Ongeldige persoon.');
  const van = searchParams.get('van');
  const tot = searchParams.get('tot');
  if (!isDag(van) || !isDag(tot)) return fout(400, 'Geef van en tot op als YYYY-MM-DD.');
  const dagen = dagenTussen(van, tot);
  if (dagen < 0) return fout(400, '"tot" ligt vóór "van".');
  if (dagen > 61) return fout(400, 'Vraag maximaal 62 dagen tegelijk op.');

  try {
    const { taken, afspraken } = await agendaBereik(s.bron, van, tot, wie);
    return json({ tasks: taken, events: afspraken });
  } catch (e) {
    return foutAntwoord(e);
  }
}
