import { isUuid, parseProject } from '@/lib/agenda/invoer';
import { AgendaFout, dbFout, NIET_INGERICHT, projectenLijst, projectOphalen } from '@/lib/agenda/repo';
import type { ProjectInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BESTAAT_AL = 'Er bestaat al een project met die naam (bij deze klant).';

// GET /api/projecten?status=actief|gearchiveerd|alle&klant=<id> → { projecten }
// Gedeeld met het hele team.
export async function GET(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const sp = new URL(request.url).searchParams;
  const status = sp.get('status') || 'actief';
  if (!['actief', 'gearchiveerd', 'alle'].includes(status)) return fout(400, 'Onbekende status.');
  const klant = sp.get('klant');
  if (klant && !isUuid(klant)) return fout(400, 'Ongeldige klant.');

  try {
    const projecten = await projectenLijst(s.bron, { status: status as 'actief' | 'gearchiveerd' | 'alle', klantId: klant });
    return json({ projecten });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// POST /api/projecten  { naam, klantId?, notitie? } → { project }
export async function POST(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, NIET_INGERICHT, 'tabel_ontbreekt');

  const body = await leesBody<ProjectInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const p = parseProject(body, true);
  if (!p.ok) return fout(400, p.fout);

  try {
    const { data, error } = await s.sb
      .from('projects')
      .insert({ ...p.waarde, status: p.waarde.status ?? 'actief', created_by: s.bron.userId })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return fout(409, BESTAAT_AL);
      throw dbFout(error);
    }
    const project = await projectOphalen(s.bron, data.id as string);
    if (!project) throw new AgendaFout(500, 'Het project is aangemaakt maar kon niet worden gelezen.');
    return json({ project }, 201);
  } catch (e) {
    return foutAntwoord(e);
  }
}
