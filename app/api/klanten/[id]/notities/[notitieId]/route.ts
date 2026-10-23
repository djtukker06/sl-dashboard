import { isUuid } from '@/lib/agenda/invoer';
import { crmFout } from '@/lib/crm/repo';
import { CRM_NIET_INGERICHT } from '@/lib/agenda/repo';
import { fout, foutAntwoord, json, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; notitieId: string }> };

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
