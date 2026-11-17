import { isUuid } from '@/lib/agenda/invoer';
import { parseNotitie } from '@/lib/crm/invoer';
import { NOTITIE_BEWERKEN_NA_0036, NOTITIE_KOLOMMEN, crmFout, naarNotitie, type NotitieDbRij } from '@/lib/crm/repo';
import { CRM_NIET_INGERICHT } from '@/lib/agenda/repo';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; notitieId: string }> };

// PATCH /api/klanten/[id]/notities/[notitieId]  { tekst } → { notitie }
// Een zelf geschreven notitie (soort 'notitie') bewerken; elk teamlid mag dat (RLS van 0036),
// de automatische statusregels niet. Zelfde regels als nieuw (1–2000 tekens). Vóór 0036
// (geen kolom bewerkt_op of geen updaterecht): een nette 503 'kolom_ontbreekt'.
export async function PATCH(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');

  const { id, notitieId } = await ctx.params;
  if (!isUuid(id) || !isUuid(notitieId)) return fout(404, 'Notitie niet gevonden.');
  const body = await leesBody<{ tekst?: unknown }>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const t = parseNotitie(body.tekst);
  if (!t.ok) return fout(400, t.fout);

  try {
    const { data, error } = await s.sb
      .from('client_notes')
      .update({ tekst: t.waarde, bewerkt_op: new Date().toISOString() })
      .eq('id', notitieId)
      .eq('client_id', id)
      .eq('soort', 'notitie')
      .select(NOTITIE_KOLOMMEN + ',bewerkt_op')
      .maybeSingle();
    if (error) {
      // 42501: nog geen updaterecht op tekst/bewerkt_op (vóór 0036).
      if (kolomOntbreekt(error) || error.code === '42501') return fout(503, NOTITIE_BEWERKEN_NA_0036, 'kolom_ontbreekt');
      throw crmFout(error);
    }
    if (!data) return fout(404, 'Notitie niet gevonden (statusregels kun je niet bewerken).');
    return json({ notitie: naarNotitie(data as unknown as NotitieDbRij) });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// DELETE /api/klanten/[id]/notities/[notitieId] → { ok }
// Alleen je eigen notitie (RLS); die van een ander geeft 404.
export async function DELETE(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');

  const { id, notitieId } = await ctx.params;
  if (!isUuid(id) || !isUuid(notitieId)) return fout(404, 'Notitie niet gevonden.');
  try {
    const { data, error } = await s.sb
      .from('client_notes')
      .delete()
      .eq('id', notitieId)
      .eq('client_id', id)
      .eq('created_by', s.bron.userId)
      .select('id');
    if (error) throw crmFout(error);
    if (!data?.length) return fout(404, 'Notitie niet gevonden (je kunt alleen je eigen notities verwijderen).');
    return json({ ok: true });
  } catch (e) {
    return foutAntwoord(e);
  }
}
