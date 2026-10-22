import { isUuid, parseTaak } from '@/lib/agenda/invoer';
import { dbFout, naarTaak, TAAK_KOLOMMEN, type TaakDbRij } from '@/lib/agenda/repo';
import type { TaakInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/taken/[id] → { task }
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await metSessie();
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Taak niet gevonden.');
  try {
    const { data, error } = await s.sb.from('tasks').select(TAAK_KOLOMMEN).eq('id', id).maybeSingle();
    if (error) throw dbFout(error);
    if (!data) return fout(404, 'Taak niet gevonden.');
    return json({ task: naarTaak(data as unknown as TaakDbRij) });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// PATCH /api/taken/[id]  (alle velden optioneel, plus afgerond: boolean) → { task }
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await metSessie();
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Taak niet gevonden.');
  const body = await leesBody<TaakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');

  try {
    const huidig = await s.sb.from('tasks').select('due_date,due_time,completed_at').eq('id', id).maybeSingle();
    if (huidig.error) throw dbFout(huidig.error);
    if (!huidig.data) return fout(404, 'Taak niet gevonden.');

    const p = parseTaak(body, huidig.data);
    if (!p.ok) return fout(400, p.fout);

    const { data, error } = await s.sb.from('tasks').update(p.waarde).eq('id', id).select(TAAK_KOLOMMEN).maybeSingle();
    if (error) throw dbFout(error);
    if (!data) return fout(404, 'Taak niet gevonden.');
    return json({ task: naarTaak(data as unknown as TaakDbRij) });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// DELETE /api/taken/[id] → { ok: true }
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await metSessie();
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Taak niet gevonden.');
  try {
    const { data, error } = await s.sb.from('tasks').delete().eq('id', id).select('id');
    if (error) throw dbFout(error);
    if (!data?.length) return fout(404, 'Taak niet gevonden.');
    return json({ ok: true });
  } catch (e) {
    return foutAntwoord(e);
  }
}
