import { isUuid, MAX_SUBTAKEN, parseSubtaakTitel } from '@/lib/agenda/invoer';
import { AgendaFout, dbFout, GEEN_RECHT, magTaakWijzigen, naarSubtaak, NIET_INGERICHT } from '@/lib/agenda/repo';
import type { SubtaakInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/taken/[id]/subtaken  { titel } → { subtaak }   (maximaal 50 per taak)
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, NIET_INGERICHT, 'tabel_ontbreekt');

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Taak niet gevonden.');
  const body = await leesBody<SubtaakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const titel = parseSubtaakTitel(body.titel);
  if (!titel.ok) return fout(400, titel.fout);

  try {
    const bestaat = await s.sb.from('tasks').select('id').eq('id', id).maybeSingle();
    if (bestaat.error) throw dbFout(bestaat.error);
    if (!bestaat.data) return fout(404, 'Taak niet gevonden.');
    if (!(await magTaakWijzigen(s.bron, id))) return fout(403, GEEN_RECHT, 'geen_recht');

    const huidig = await s.sb.from('task_subtasks').select('sort_order').eq('task_id', id);
    if (huidig.error) throw dbFout(huidig.error);
    const rijen = huidig.data ?? [];
    if (rijen.length >= MAX_SUBTAKEN) return fout(400, `Maximaal ${MAX_SUBTAKEN} subtaken per taak.`);
    const volgorde = rijen.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0) + 1;

    const { data, error } = await s.sb
      .from('task_subtasks')
      .insert({ task_id: id, titel: titel.waarde, sort_order: volgorde })
      .select('id,titel,klaar_op,klaar_door,sort_order')
      .single();
    if (error) throw dbFout(error);
    if (!data) throw new AgendaFout(500, 'De subtaak is niet opgeslagen.');
    return json({ subtaak: naarSubtaak(data) }, 201);
  } catch (e) {
    return foutAntwoord(e);
  }
}
