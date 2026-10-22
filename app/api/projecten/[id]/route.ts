import { isUuid, parseProject } from '@/lib/agenda/invoer';
import { dbFout, NIET_INGERICHT, projectOphalen } from '@/lib/agenda/repo';
import type { ProjectInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/projecten/[id] → { project }
export async function GET(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, NIET_INGERICHT, 'tabel_ontbreekt');

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Project niet gevonden.');
  try {
    const project = await projectOphalen(s.bron, id);
    if (!project) return fout(404, 'Project niet gevonden.');
    return json({ project });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// PATCH /api/projecten/[id]  { naam?, klantId?, status?, notitie? } → { project }
// Hernoemen, klant koppelen, archiveren of terugzetten. (Verwijderen kan bewust niet:
// archiveren houdt de koppeling met oude taken intact.)
export async function PATCH(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, NIET_INGERICHT, 'tabel_ontbreekt');

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Project niet gevonden.');
  const body = await leesBody<ProjectInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const p = parseProject(body, false);
  if (!p.ok) return fout(400, p.fout);

  try {
    if ('client_id' in p.waarde && p.waarde.client_id) {
      // Een andere klant koppelen kan niet als er taken van een andere klant aan hangen.
      const { count, error } = await s.sb
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', id)
        .not('client_id', 'is', null)
        .neq('client_id', p.waarde.client_id);
      if (error) throw dbFout(error);
      if (count) {
        return fout(400, `Er ${count === 1 ? 'hoort 1 taak' : `horen ${count} taken`} bij dit project voor een andere klant. Pas die eerst aan.`);
      }
    }
    const { data, error } = await s.sb.from('projects').update(p.waarde).eq('id', id).select('id').maybeSingle();
    if (error) {
      if (error.code === '23505') return fout(409, 'Er bestaat al een project met die naam (bij deze klant).');
      throw dbFout(error);
    }
    if (!data) return fout(404, 'Project niet gevonden.');
    const project = await projectOphalen(s.bron, id);
    if (!project) return fout(404, 'Project niet gevonden.');
    return json({ project });
  } catch (e) {
    return foutAntwoord(e);
  }
}
