import { afspraakAlsInvoer, isUuid, parseAfspraak } from '@/lib/agenda/invoer';
import { AFSPRAAK_KOLOMMEN, dbFout, naarAfspraak, type AfspraakDbRij } from '@/lib/agenda/repo';
import type { AfspraakInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/afspraken/[id] → { event }
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Afspraak niet gevonden.');
  try {
    const { data, error } = await s.sb.from('calendar_events').select(AFSPRAAK_KOLOMMEN).eq('id', id).maybeSingle();
    if (error) throw dbFout(error);
    if (!data) return fout(404, 'Afspraak niet gevonden.');
    return json({ event: naarAfspraak(data as unknown as AfspraakDbRij) });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// PATCH /api/afspraken/[id]  (velden als bij POST, allemaal optioneel) → { event }
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Afspraak niet gevonden.');
  const body = await leesBody<AfspraakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');

  try {
    const huidig = await s.sb.from('calendar_events').select('starts_at,ends_at,all_day').eq('id', id).maybeSingle();
    if (huidig.error) throw dbFout(huidig.error);
    if (!huidig.data) return fout(404, 'Afspraak niet gevonden.');

    const p = parseAfspraak(body, afspraakAlsInvoer(huidig.data));
    if (!p.ok) return fout(400, p.fout);

    const { data, error } = await s.sb
      .from('calendar_events')
      .update(p.waarde)
      .eq('id', id)
      .select(AFSPRAAK_KOLOMMEN)
      .maybeSingle();
    if (error) throw dbFout(error);
    if (!data) return fout(404, 'Afspraak niet gevonden.');
    return json({ event: naarAfspraak(data as unknown as AfspraakDbRij) });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// DELETE /api/afspraken/[id] → { ok: true }
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Afspraak niet gevonden.');
  try {
    const { data, error } = await s.sb.from('calendar_events').delete().eq('id', id).select('id');
    if (error) throw dbFout(error);
    if (!data?.length) return fout(404, 'Afspraak niet gevonden.');
    return json({ ok: true });
  } catch (e) {
    return foutAntwoord(e);
  }
}
