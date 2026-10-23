import { isUuid, parseProject } from '@/lib/agenda/invoer';
import {
  AgendaFout,
  CRM_NIET_INGERICHT,
  dbFout,
  metStatusTerugval,
  NIET_INGERICHT,
  projectenLijst,
  projectOphalen,
  zetProjectEigenaren,
  type ProjectSelectie
} from '@/lib/agenda/repo';
import type { ProjectInvoer } from '@/lib/agenda/types';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BESTAAT_AL = 'Er bestaat al een project met die naam (bij deze klant).';

// Oude namen (actief/gearchiveerd) blijven werken voor bestaande links en de kiezer.
const SELECTIE: Record<string, ProjectSelectie> = {
  actief: 'lopend',
  lopend: 'lopend',
  afgerond: 'afgerond',
  gearchiveerd: 'afgerond',
  alle: 'alle'
};

// GET /api/projecten?status=lopend|afgerond|alle&klant=<id> → { projecten }
// Gedeeld met het hele team. 'lopend' (of 'actief') = alles behalve afgerond.
export async function GET(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;

  const sp = new URL(request.url).searchParams;
  const selectie = SELECTIE[sp.get('status') || 'lopend'];
  if (!selectie) return fout(400, 'Onbekende status.');
  const klant = sp.get('klant');
  if (klant && !isUuid(klant)) return fout(400, 'Ongeldige klant.');

  try {
    const projecten = await projectenLijst(s.bron, { selectie, klantId: klant });
    return json({ projecten });
  } catch (e) {
    return foutAntwoord(e);
  }
}

// POST /api/projecten  { naam, klantId?, status?, deadline?, notitie?, eigenaren? }
//   → { project, klantWeerActief }
// Zonder status: de standaard van de database ('voorbereiding'; vóór 0023 'bezig', vóór
// 0022 'actief'). Zonder eigenaren: jijzelf (vanaf 0022). Een nieuw (niet-afgerond) project
// bij een afgeronde klant zet die klant terug op 'actief' (klantWeerActief: true).
export async function POST(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, NIET_INGERICHT, 'tabel_ontbreekt');

  const body = await leesBody<ProjectInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const p = parseProject(body, true);
  if (!p.ok) return fout(400, p.fout);

  try {
    const { data, error } = await metStatusTerugval<{ id: string }>(p.waarde, (rij) =>
      s.sb
        .from('projects')
        .insert({ ...rij, created_by: s.bron.userId })
        .select('id')
        .single()
    );
    if (error) {
      if (error.code === '23505') return fout(409, BESTAAT_AL);
      if (kolomOntbreekt(error) || error.code === '23514') {
        // Status gepland/bezig/afgerond of een deadline vóór migratie 0022.
        return fout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');
      }
      throw dbFout(error);
    }
    if (!data) throw new AgendaFout(500, 'Het project kon niet worden aangemaakt.');
    const id = data.id as string;

    try {
      await zetProjectEigenaren(s.bron, id, p.eigenaren ?? [s.bron.userId]);
    } catch (e) {
      const oudeModus = e instanceof AgendaFout && e.code === 'tabel_ontbreekt';
      if (!(oudeModus && p.eigenaren === undefined)) {
        await s.sb.from('projects').delete().eq('id', id);
        throw e;
      }
    }

    // Afgeronde klant krijgt een nieuw project: weer actief (blijft verder ongemoeid).
    let klantWeerActief = false;
    if (p.waarde.client_id && p.waarde.status !== 'afgerond') {
      const k = await s.sb
        .from('clients')
        .update({ status: 'actief' })
        .eq('id', p.waarde.client_id)
        .eq('status', 'afgerond')
        .select('id');
      if (k.error && !kolomOntbreekt(k.error)) throw dbFout(k.error);
      klantWeerActief = !k.error && (k.data ?? []).length > 0;
    }

    const project = await projectOphalen(s.bron, id);
    if (!project) throw new AgendaFout(500, 'Het project is aangemaakt maar kon niet worden gelezen.');
    return json({ project, klantWeerActief }, 201);
  } catch (e) {
    return foutAntwoord(e);
  }
}
