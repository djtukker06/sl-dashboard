import { isUuid, parseSubtaakWijziging } from '@/lib/agenda/invoer';
import { dbFout, GEEN_RECHT, magTaakWijzigen, naarSubtaak, NIET_INGERICHT } from '@/lib/agenda/repo';
import type { SubtaakInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; sid: string }> };

// PATCH /api/taken/[id]/subtaken/[sid]  { titel?, klaar?, volgorde? } → { subtaak }
export async function PATCH(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, NIET_INGERICHT, 'tabel_ontbreekt');

  const { id, sid } = await ctx.params;
  if (!isUuid(id) || !isUuid(sid)) return fout(404, 'Subtaak niet gevonden.');
  const body = await leesBody<SubtaakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const p = parseSubtaakWijziging(body, s.bron.userId);
  if (!p.ok) return fout(400, p.fout);

  try {
    if (!(await magTaakWijzigen(s.bron, id))) return fout(403, GEEN_RECHT, 'geen_recht');
    const { data, error } = await s.sb
      .from('task_subtasks')
      .update(p.waarde)
      .eq('id', sid)
      .eq('task_id', id)
      .select('id,titel,klaar_op,klaar_door,sort_order')
      .maybeSingle();
    if (error) throw dbFout(error);
    if (!data) return fout(404, 'Subtaak niet gevonden.');
    return json({ subtaak: naarSubtaak(data) });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// DELETE /api/taken/[id]/subtaken/[sid] → { ok: true }
export async function DELETE(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, NIET_INGERICHT, 'tabel_ontbreekt');

  const { id, sid } = await ctx.params;
  if (!isUuid(id) || !isUuid(sid)) return fout(404, 'Subtaak niet gevonden.');
  try {
    if (!(await magTaakWijzigen(s.bron, id))) return fout(403, GEEN_RECHT, 'geen_recht');
    const { data, error } = await s.sb.from('task_subtasks').delete().eq('id', sid).eq('task_id', id).select('id');
    if (error) throw dbFout(error);
    if (!data?.length) return fout(404, 'Subtaak niet gevonden.');
    return json({ ok: true });
  } catch (e) {
    return foutAntwoord(e);
  }
}
