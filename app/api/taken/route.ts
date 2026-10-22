import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { parseTaak } from '@/lib/agenda/invoer';
import { dbFout, naarTaak, TAAK_KOLOMMEN, takenVoorFilter, tellingen, type TaakDbRij } from '@/lib/agenda/repo';
import { TAKEN_FILTERS, type TaakInvoer, type TakenFilter } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/taken?filter=vandaag|telaat|gepland|ooit|afgerond → { tasks, tellingen }
export async function GET(request: Request) {
  const s = await metSessie();
  if ('antwoord' in s) return s.antwoord;

  const filter = (new URL(request.url).searchParams.get('filter') || 'vandaag') as TakenFilter;
  if (!TAKEN_FILTERS.includes(filter)) return fout(400, 'Onbekend filter.');

  try {
    const vandaag = vandaagNL();
    const [taken, tel] = await Promise.all([takenVoorFilter(s.sb, filter, vandaag), tellingen(s.sb, vandaag)]);
    return json({ tasks: taken, tellingen: tel, vandaag });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// POST /api/taken  { titel, notitie?, datum?, tijd?, duur?, prioriteit?, klantId? } → { task }
export async function POST(request: Request) {
  const s = await metSessie();
  if ('antwoord' in s) return s.antwoord;

  const body = await leesBody<TaakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const p = parseTaak(body, null);
  if (!p.ok) return fout(400, p.fout);

  try {
    const { data, error } = await s.sb.from('tasks').insert(p.waarde).select(TAAK_KOLOMMEN).single();
    if (error) throw dbFout(error);
    return json({ task: naarTaak(data as unknown as TaakDbRij) }, 201);
  } catch (e) {
    return foutAntwoord(e);
  }
}
