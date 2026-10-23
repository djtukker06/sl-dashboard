import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isUuid, klantBijProject, parsePersonen, parseSubtaken, parseTaak } from '@/lib/agenda/invoer';
import {
  AgendaFout,
  controleerTeamleden,
  dbFout,
  projectKlant,
  taakKolommen,
  taakOphalen,
  takenVoorFilter,
  tellingen,
  naarTaak,
  type TaakDbRij
} from '@/lib/agenda/repo';
import { TAKEN_FILTERS, type TaakInvoer, type TakenFilter } from '@/lib/agenda/types';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/taken?filter=vandaag|telaat|gepland|ooit|afgerond|uitgezet&project=<id>&klant=<id>
//   → { tasks, tellingen, vandaag }. Altijd alleen taken op JOUW naam; 'uitgezet' = taken die
//   jij voor een ander maakte (open + de laatste 14 dagen afgerond). Een parameter om de lijst
//   van een ander op te vragen bestaat bewust niet (een oude ?wie=… wordt genegeerd).
export async function GET(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const sp = new URL(request.url).searchParams;
  const filter = (sp.get('filter') || 'vandaag') as TakenFilter;
  if (!TAKEN_FILTERS.includes(filter)) return fout(400, 'Onbekend filter.');
  const project = sp.get('project');
  const klant = sp.get('klant');
  if ((project && !isUuid(project)) || (klant && !isUuid(klant))) return fout(400, 'Ongeldig filter.');

  try {
    const vandaag = vandaagNL();
    const opties = { projectId: project, klantId: klant };
    const [taken, tel] = await Promise.all([
      takenVoorFilter(s.bron, filter, vandaag, opties),
      tellingen(s.bron, vandaag, opties)
    ]);
    return json({ tasks: taken, tellingen: tel, vandaag });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// POST /api/taken
//   { titel, notitie?, datum?, tijd?, duur?, prioriteit?, klantId?, projectId?, voorWie?: [id], subtaken?: [titel] }
//   → { task }. Zonder voorWie is de taak voor jezelf.
export async function POST(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  const { bron } = s;

  const body = await leesBody<TaakInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const p = parseTaak(body, null);
  if (!p.ok) return fout(400, p.fout);
  const personen = parsePersonen(body.voorWie ?? [bron.userId]);
  if (!personen.ok) return fout(400, personen.fout);
  const subtaken = parseSubtaken(body.subtaken);
  if (!subtaken.ok) return fout(400, subtaken.fout);
  const rij = p.waarde;

  try {
    const teamFout = await controleerTeamleden(bron, personen.waarde);
    if (teamFout) return fout(400, teamFout);

    if (!bron.team) {
      // Vóór migratie 0021: geen subtaken/projecten; de taak is van de maker.
      if (subtaken.waarde.length || rij.project_id) {
        return fout(409, 'Subtaken en projecten werken pas als migratie 0021 is uitgevoerd.');
      }
      delete rij.project_id;
      const { data, error } = await s.sb.from('tasks').insert(rij).select(taakKolommen(false)).single();
      if (error) throw dbFout(error);
      return json({ task: naarTaak(data as unknown as TaakDbRij) }, 201);
    }

    if (rij.project_id) {
      const project = await projectKlant(bron, rij.project_id);
      if (!project) return fout(400, 'Dat project bestaat niet (meer).');
      const k = klantBijProject(rij.client_id ?? null, project);
      if (!k.ok) return fout(400, k.fout);
      rij.client_id = k.waarde;
    }

    // Eén transactie: taak + toegewezenen + subtaken (RLS geldt, maker = jij).
    const { data: id, error } = await s.sb.rpc('taak_aanmaken', {
      p: {
        titel: rij.title,
        notities: rij.notes ?? '',
        datum: rij.due_date ?? null,
        tijd: rij.due_date ? (rij.due_time ?? null) : null,
        duur: rij.duration_minutes ?? null,
        prioriteit: rij.priority ?? 2,
        klantId: rij.client_id ?? null,
        projectId: rij.project_id ?? null,
        voorWie: personen.waarde,
        subtaken: subtaken.waarde
      }
    });
    if (error) throw dbFout(error);
    if (typeof id !== 'string') throw new AgendaFout(500, 'De taak is niet aangemaakt.');
    const taak = await taakOphalen(bron, id);
    if (!taak) throw new AgendaFout(500, 'De taak is aangemaakt maar kon niet worden gelezen.');
    return json({ task: taak }, 201);
  } catch (e) {
    return foutAntwoord(e);
  }
}
