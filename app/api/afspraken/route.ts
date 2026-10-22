import { parseAfspraak, parsePersonen } from '@/lib/agenda/invoer';
import { afspraakOphalen, AgendaFout, controleerTeamleden, dbFout, zetPersonen } from '@/lib/agenda/repo';
import type { AfspraakInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/afspraken  { titel, datum, start?, eind?, duur?, heleDag?, eindDatum?, locatie?, notitie?, klantId?, deelnemers? }
// Tijden zijn Amsterdamse wandkloktijd; de server rekent ze om naar UTC. Zonder deelnemers
// is de afspraak van jezelf. → { event }
export async function POST(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  const { bron } = s;

  const body = await leesBody<AfspraakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const p = parseAfspraak(body, null);
  if (!p.ok) return fout(400, p.fout);
  const personen = parsePersonen(body.deelnemers ?? [bron.userId], 'deelnemer');
  if (!personen.ok) return fout(400, personen.fout);

  try {
    const teamFout = await controleerTeamleden(bron, personen.waarde);
    if (teamFout) return fout(400, teamFout);

    const { data, error } = await s.sb.from('calendar_events').insert(p.waarde).select('id').single();
    if (error) throw dbFout(error);
    const id = data.id as string;
    if (bron.team) {
      try {
        await zetPersonen(bron, 'afspraak', id, personen.waarde);
      } catch (e) {
        // Geen halve afspraak achterlaten.
        await s.sb.from('calendar_events').delete().eq('id', id);
        throw e;
      }
    }
    const afspraak = await afspraakOphalen(bron, id);
    if (!afspraak) throw new AgendaFout(500, 'De afspraak is opgeslagen maar kon niet worden gelezen.');
    return json({ event: afspraak }, 201);
  } catch (e) {
    return foutAntwoord(e);
  }
}
