import { parseAfspraak } from '@/lib/agenda/invoer';
import { AFSPRAAK_KOLOMMEN, dbFout, naarAfspraak, type AfspraakDbRij } from '@/lib/agenda/repo';
import type { AfspraakInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/afspraken  { titel, datum, start?, eind?, duur?, heleDag?, eindDatum?, locatie?, notitie?, klantId? }
// Tijden zijn Amsterdamse wandkloktijd; de server rekent ze om naar UTC. → { event }
export async function POST(request: Request) {
  const s = await metSessie();
  if ('antwoord' in s) return s.antwoord;

  const body = await leesBody<AfspraakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const p = parseAfspraak(body, null);
  if (!p.ok) return fout(400, p.fout);

  try {
    const { data, error } = await s.sb.from('calendar_events').insert(p.waarde).select(AFSPRAAK_KOLOMMEN).single();
    if (error) throw dbFout(error);
    return json({ event: naarAfspraak(data as unknown as AfspraakDbRij) }, 201);
  } catch (e) {
    return foutAntwoord(e);
  }
}
