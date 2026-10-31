import { isUuid, parseProject } from '@/lib/agenda/invoer';
import { CRM_NIET_INGERICHT, dbFout, metStatusTerugval, NIET_INGERICHT, projectOphalen, zetProjectEigenaren } from '@/lib/agenda/repo';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import type { ProjectInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';
import { parseKlantNaam } from '@/lib/crm/invoer';
import { vindOfMaakKlant } from '@/lib/crm/repo';
import { naProjectWijziging } from '@/lib/drive/na';

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

// PATCH /api/projecten/[id]  { naam?, klantId?, klantNaam?, status?, deadline?, notitie?, eigenaren? }
//   → { project, klantAangemaakt }
// klantNaam (zonder klantId): koppelt de klant met die naam (hoofdletterongevoelig) of maakt
// hem aan met status 'actief', net als bij POST /api/projecten.
// Alles op de projectpagina slaat direct op via deze route. (Verwijderen kan bewust niet:
// 'afgerond' houdt de koppeling met oude taken intact.)
export async function PATCH(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, NIET_INGERICHT, 'tabel_ontbreekt');

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Project niet gevonden.');
  const body = await leesBody<ProjectInvoer & { klantNaam?: unknown }>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const kn = parseKlantNaam(body.klantNaam);
  if (!kn.ok) return fout(400, kn.fout);
  const p = parseProject(body, false);
  if (!p.ok) return fout(400, p.fout);

  // Alleen een klant die hier net is aangemaakt, wordt bij een fout weer opgeruimd.
  let klantAangemaakt: { id: string; naam: string } | null = null;
  const opruimen = async () => {
    if (klantAangemaakt) await s.sb.from('clients').delete().eq('id', klantAangemaakt.id);
  };

  try {
    if (kn.waarde && !p.waarde.client_id) {
      const k = await vindOfMaakKlant(s.bron, kn.waarde);
      p.waarde.client_id = k.id;
      if (k.nieuw) klantAangemaakt = { id: k.id, naam: k.naam };
    }
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
        await opruimen();
        return fout(400, `Er ${count === 1 ? 'hoort 1 taak' : `horen ${count} taken`} bij dit project voor een andere klant. Pas die eerst aan.`);
      }
    }
    if (Object.keys(p.waarde).length) {
      // Vóór 0023 kent de database 'voorbereiding' nog als 'gepland' (metStatusTerugval).
      const { data, error } = await metStatusTerugval<{ id: string }>(p.waarde, (rij) => s.sb.from('projects').update(rij).eq('id', id).select('id').maybeSingle());
      if (error) {
        await opruimen();
        if (error.code === '23505') return fout(409, 'Er bestaat al een project met die naam (bij deze klant).');
        if (kolomOntbreekt(error) || error.code === '23514') return fout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');
        throw dbFout(error);
      }
      if (!data) {
        await opruimen();
        return fout(404, 'Project niet gevonden.');
      }
    } else {
      const { data, error } = await s.sb.from('projects').select('id').eq('id', id).maybeSingle();
      if (error) throw dbFout(error);
      if (!data) return fout(404, 'Project niet gevonden.');
    }
    if (p.eigenaren !== undefined) await zetProjectEigenaren(s.bron, id, p.eigenaren);
    const project = await projectOphalen(s.bron, id);
    if (!project) return fout(404, 'Project niet gevonden.');
    // Andere naam of klant: de projectmap in Google Drive meenemen (ná het antwoord, best effort).
    if ('naam' in p.waarde || 'client_id' in p.waarde) naProjectWijziging(s.lid, id);
    return json({ project, klantAangemaakt });
  } catch (e) {
    await opruimen();
    return foutAntwoord(e);
  }
}
