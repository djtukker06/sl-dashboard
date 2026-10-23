import { isUuid, klantBijProject, parsePersonen, parseTaak } from '@/lib/agenda/invoer';
import {
  controleerTeamleden,
  dbFout,
  GEEN_RECHT,
  magTaakWijzigen,
  projectKlant,
  taakDetail,
  taakOphalen,
  zetPersonen
} from '@/lib/agenda/repo';
import type { TaakInvoer } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/taken/[id] → { task } (met subtakenLijst). Alleen wie de taak mag zien (RLS 0022:
// maker, toegewezene, of het team bij een projecttaak); anders 404.
export async function GET(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Taak niet gevonden.');
  try {
    const taak = await taakDetail(s.bron, id);
    if (!taak) return fout(404, 'Taak niet gevonden.');
    return json({ task: taak });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// PATCH /api/taken/[id]  (alle velden optioneel; afgerond: boolean; voorWie vervangt de set)
// → { task }. Alleen de maker of een toegewezene (anders 403).
export async function PATCH(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  const { bron } = s;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Taak niet gevonden.');
  const body = await leesBody<TaakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');

  try {
    const huidig = await s.sb
      .from('tasks')
      .select(bron.team ? 'due_date,due_time,completed_at,client_id,project_id' : 'due_date,due_time,completed_at,client_id')
      .eq('id', id)
      .maybeSingle();
    if (huidig.error) throw dbFout(huidig.error);
    if (!huidig.data) return fout(404, 'Taak niet gevonden.');
    const h = huidig.data as unknown as {
      due_date: string | null;
      due_time: string | null;
      completed_at: string | null;
      client_id: string | null;
      project_id?: string | null;
    };
    if (!(await magTaakWijzigen(bron, id))) return fout(403, GEEN_RECHT, 'geen_recht');

    const p = parseTaak(body, h);
    if (!p.ok) return fout(400, p.fout);
    const rij: Record<string, unknown> = { ...p.waarde };

    let personen: string[] | null = null;
    if ('voorWie' in body) {
      const r = parsePersonen(body.voorWie);
      if (!r.ok) return fout(400, r.fout);
      const teamFout = await controleerTeamleden(bron, r.waarde);
      if (teamFout) return fout(400, teamFout);
      personen = bron.team ? r.waarde : null;
    }

    if (!bron.team) {
      if (rij.project_id) return fout(409, 'Projecten werken pas als migratie 0021 is uitgevoerd.');
      delete rij.project_id;
    } else {
      // Klant en project consistent houden.
      if ('project_id' in rij || 'client_id' in rij) {
        const projectId = 'project_id' in rij ? (rij.project_id as string | null) : (h.project_id ?? null);
        const klantId = 'client_id' in rij ? (rij.client_id as string | null) : h.client_id;
        if (projectId) {
          const project = await projectKlant(bron, projectId);
          if (!project) return fout(400, 'Dat project bestaat niet (meer).');
          const k = klantBijProject(klantId, project);
          if (!k.ok) return fout(400, k.fout);
          if (k.waarde !== h.client_id) rij.client_id = k.waarde;
        }
      }
      // Wie rondde af? (één afronding voor iedereen)
      if ('completed_at' in rij) {
        if (rij.completed_at === null) rij.completed_by = null;
        else if (!h.completed_at) rij.completed_by = bron.userId;
      }
    }

    if (Object.keys(rij).length) {
      const { data, error } = await s.sb.from('tasks').update(rij).eq('id', id).select('id').maybeSingle();
      if (error) throw dbFout(error);
      // RLS: geen rij terug = geen recht (of net verwijderd).
      if (!data) return fout(404, 'Taak niet gevonden.');
    }
    if (personen) await zetPersonen(bron, 'taak', id, personen);

    const taak = await taakOphalen(bron, id);
    if (!taak) {
      // Je hebt de taak aan een ander gegeven (en hij hoort niet bij een project): opgeslagen,
      // maar jij mag hem niet meer zien.
      if (personen && !personen.includes(bron.userId)) return json({ task: null, overgedragen: true });
      return fout(404, 'Taak niet gevonden.');
    }
    return json({ task: taak });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// DELETE /api/taken/[id] → { ok: true }. Alleen de maker of een toegewezene.
export async function DELETE(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Taak niet gevonden.');
  try {
    const bestaat = await s.sb.from('tasks').select('id').eq('id', id).maybeSingle();
    if (bestaat.error) throw dbFout(bestaat.error);
    if (!bestaat.data) return fout(404, 'Taak niet gevonden.');
    if (!(await magTaakWijzigen(s.bron, id))) return fout(403, GEEN_RECHT, 'geen_recht');

    const { data, error } = await s.sb.from('tasks').delete().eq('id', id).select('id');
    if (error) throw dbFout(error);
    if (!data?.length) return fout(404, 'Taak niet gevonden.');
    return json({ ok: true });
  } catch (e) {
    return foutAntwoord(e);
  }
}
