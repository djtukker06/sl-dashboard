import { isUuid } from '@/lib/agenda/invoer';
import { parseNotitie } from '@/lib/crm/invoer';
import { crmFout } from '@/lib/crm/repo';
import { CRM_NIET_INGERICHT } from '@/lib/agenda/repo';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/klanten/[id]/notities  { tekst } → { notitie }
// Een korte notitie in de tijdlijn van de klant (maker = jij, afgedwongen door RLS).
export async function POST(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Klant niet gevonden.');
  const body = await leesBody<{ tekst?: unknown }>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const t = parseNotitie(body.tekst);
  if (!t.ok) return fout(400, t.fout);

  try {
    const { data, error } = await s.sb
      .from('client_notes')
      .insert({ client_id: id, tekst: t.waarde, created_by: s.bron.userId })
      .select('id,tekst,created_by,created_at')
      .single();
    if (error) {
      if (error.code === '23503') return fout(404, 'Klant niet gevonden.');
      throw crmFout(error);
    }
    return json(
      { notitie: { id: data.id as string, tekst: data.tekst as string, door: data.created_by as string | null, op: data.created_at as string } },
      201
    );
  } catch (e) {
    return foutAntwoord(e);
  }
}
