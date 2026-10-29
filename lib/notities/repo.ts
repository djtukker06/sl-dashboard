import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import {
  dbZoekTermen,
  LEGE_INHOUD,
  type Notitie,
  type NotitieFilter,
  type NotitieRij,
  type NotitieSamenvatting,
  type TiptapKnoop
} from './kern';

// Database-kant van de Scratchpad (tabel public.notities, migratie 0031). Altijd met de
// gebruikerscliënt van het teamlid (lid.sb): RLS bepaalt wat iemand ziet (gedeeld + eigen
// privé) en schrijft; de database zet updated_by/updated_at en houdt created_by vast.

export const SCRATCHPAD_NIET_INGERICHT = 'De Scratchpad werkt zodra migratie 0031 is uitgevoerd (supabase/UITVOEREN_0031.sql).';

export class NotitieFout extends Error {
  status: number;
  code?: string;
  /** Bij een conflict (409): de huidige versie in de database. */
  huidig?: Notitie;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isScratchpadNietIngericht(e: unknown): boolean {
  return e instanceof NotitieFout && e.code === 'tabel_ontbreekt';
}

type DbFout = { code?: string; message?: string };

function dbFout(error: DbFout): NotitieFout {
  if (tabelOntbreekt(error)) return new NotitieFout(503, SCRATCHPAD_NIET_INGERICHT, 'tabel_ontbreekt');
  if (error.code === '23514') return new NotitieFout(400, 'Deze notitie is te groot of ongeldig.');
  if (error.code === '23503') return new NotitieFout(400, 'Die klant of dat project bestaat niet (meer).');
  if (error.code === '42501') return new NotitieFout(403, error.message?.startsWith('Alleen de maker') ? error.message : 'Dit mag je niet wijzigen.', 'geen_recht');
  const f = new NotitieFout(500, 'Er ging iets mis. Probeer het opnieuw.');
  f.cause = error;
  return f;
}

const LIJST_KOLOMMEN =
  'id, titel, emoji, fragment, client_id, project_id, prive, vastgepind, created_by, updated_by, created_at, updated_at, clients(company_name, status), projects(naam)';
const VOLLEDIG = `${LIJST_KOLOMMEN}, inhoud`;

interface DbRij {
  id: string;
  titel: string;
  emoji: string | null;
  fragment: string | null;
  client_id: string | null;
  project_id: string | null;
  prive: boolean;
  vastgepind: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  clients: { company_name: string; status?: string | null } | { company_name: string; status?: string | null }[] | null;
  projects: { naam: string } | { naam: string }[] | null;
  inhoud?: TiptapKnoop;
}

const een = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function naarSamenvatting(r: DbRij): NotitieSamenvatting {
  const klant = een(r.clients);
  const project = een(r.projects);
  return {
    id: r.id,
    titel: r.titel ?? '',
    emoji: r.emoji,
    fragment: r.fragment ?? '',
    klant: r.client_id ? { id: r.client_id, naam: klant?.company_name ?? 'Klant', lead: klant?.status === 'lead' } : null,
    project: r.project_id ? { id: r.project_id, naam: project?.naam ?? 'Project' } : null,
    prive: r.prive,
    vastgepind: r.vastgepind,
    gemaaktDoor: r.created_by,
    bewerktDoor: r.updated_by,
    gemaaktOp: r.created_at,
    bewerktOp: r.updated_at
  };
}

function naarNotitie(r: DbRij): Notitie {
  return { ...naarSamenvatting(r), inhoud: r.inhoud && typeof r.inhoud === 'object' ? r.inhoud : LEGE_INHOUD };
}

export interface LijstOpties {
  q?: string;
  filter?: NotitieFilter;
  klantId?: string | null;
  projectId?: string | null;
  mijnId: string;
  limiet?: number;
}

/** Notities (niet verwijderd): vastgepind eerst, dan laatst bewerkt. */
export async function notitiesLijst(sb: SupabaseClient, o: LijstOpties): Promise<NotitieSamenvatting[]> {
  let q = sb.from('notities').select(LIJST_KOLOMMEN).is('verwijderd_op', null);
  if (o.klantId) q = q.eq('client_id', o.klantId);
  if (o.projectId) q = q.eq('project_id', o.projectId);
  if (o.filter === 'mijn') q = q.eq('created_by', o.mijnId);
  else if (o.filter === 'klant') q = q.not('client_id', 'is', null);
  else if (o.filter === 'project') q = q.not('project_id', 'is', null);
  else if (o.filter === 'prive') q = q.eq('prive', true);
  // Zoeken in titel en volledige tekst: elke term moet ergens voorkomen (EN tussen termen).
  for (const t of dbZoekTermen(o.q ?? '')) q = q.or(`titel.ilike.*${t}*,inhoud_tekst.ilike.*${t}*`);
  const { data, error } = await q
    .order('vastgepind', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, o.limiet ?? 300));
  if (error) throw dbFout(error);
  return ((data ?? []) as unknown as DbRij[]).map(naarSamenvatting);
}

export async function notitieOphalen(sb: SupabaseClient, id: string): Promise<Notitie | null> {
  const { data, error } = await sb.from('notities').select(VOLLEDIG).eq('id', id).is('verwijderd_op', null).maybeSingle();
  if (error) throw dbFout(error);
  return data ? naarNotitie(data as unknown as DbRij) : null;
}

/** Klant van een project (om een notitie bij een project ook aan de klant te hangen). */
async function klantVanProject(sb: SupabaseClient, projectId: string): Promise<string | null | undefined> {
  const { data, error } = await sb.from('projects').select('client_id').eq('id', projectId).maybeSingle();
  if (error) throw dbFout(error);
  if (!data) return undefined;
  return (data as { client_id: string | null }).client_id;
}

async function vulKlantBijProject(sb: SupabaseClient, rij: NotitieRij): Promise<void> {
  if (!rij.project_id || rij.client_id !== undefined) return;
  const klant = await klantVanProject(sb, rij.project_id);
  if (klant === undefined) throw new NotitieFout(400, 'Dat project bestaat niet (meer).');
  if (klant) rij.client_id = klant;
}

export async function notitieMaken(sb: SupabaseClient, rij: NotitieRij): Promise<Notitie> {
  await vulKlantBijProject(sb, rij);
  const { data, error } = await sb.from('notities').insert(rij).select(VOLLEDIG).single();
  if (error) throw dbFout(error);
  return naarNotitie(data as unknown as DbRij);
}

/**
 * Wijzigt een notitie. Met `sinds` alleen als niemand hem intussen heeft gewijzigd; anders
 * een 409 met de huidige versie (zo overschrijft autosave nooit het werk van een ander).
 * Ook een zacht verwijderde notitie is te wijzigen (terugzetten via verwijderd_op = null).
 */
export async function notitieWijzigen(sb: SupabaseClient, id: string, rij: NotitieRij, sinds: string | null): Promise<NotitieSamenvatting> {
  await vulKlantBijProject(sb, rij);
  let q = sb.from('notities').update(rij).eq('id', id);
  if (sinds) q = q.eq('updated_at', sinds);
  const { data, error } = await q.select(LIJST_KOLOMMEN).maybeSingle();
  if (error) throw dbFout(error);
  if (data) return naarSamenvatting(data as unknown as DbRij);

  const huidig = sinds ? await notitieOphalen(sb, id) : null;
  if (huidig) {
    const f = new NotitieFout(409, 'Deze notitie is intussen ook door iemand anders bewerkt.', 'conflict');
    f.huidig = huidig;
    throw f;
  }
  throw new NotitieFout(404, 'Deze notitie bestaat niet (meer).', 'niet_gevonden');
}

/** Zacht verwijderen (ongedaan te maken met PATCH { verwijderd: false }). */
export async function notitieVerwijderen(sb: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await sb.from('notities').update({ verwijderd_op: new Date().toISOString() }).eq('id', id).is('verwijderd_op', null).select('id');
  if (error) throw dbFout(error);
  if (!data?.length) throw new NotitieFout(404, 'Deze notitie bestaat niet (meer).', 'niet_gevonden');
}
