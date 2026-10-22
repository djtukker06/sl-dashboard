import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { bereikMomenten, normTijd, plusDagen } from './datum';
import type { Afspraak, Project, Subtaak, Taak, TaakDetail, TakenFilter, Tellingen, Wie } from './types';

// Database-toegang voor agenda & taken. Altijd met de gebruikerscliënt (RLS), ná een
// sessie-check in de aanroepende route of pagina.
//
// Taken op naam (migratie 0021): een taak hoort bij één of meer teamleden (task_assignees),
// een afspraak bij deelnemers (event_attendees). "Mijn" lijsten filteren daarop; "Heel team"
// toont alles. Zolang 0021 niet is uitgevoerd (bron.team = false) bestaan die tabellen niet:
// dan werkt alles zoals vóór de teamaccounts (geen toewijzing, geen subtaken, geen projecten).

export class AgendaFout extends Error {
  status: number;
  code?: 'tabel_ontbreekt' | 'geen_recht';
  constructor(status: number, message: string, code?: 'tabel_ontbreekt' | 'geen_recht') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const NIET_INGERICHT = 'Agenda nog niet ingericht';
export const GEEN_RECHT = 'Alleen de maker of iemand voor wie het is, kan dit wijzigen.';

/** Met wie en hoe we de database aanspreken. team = migratie 0021 is uitgevoerd. */
export interface AgendaBron {
  sb: SupabaseClient;
  userId: string;
  team: boolean;
}

// Eigen meldingen uit de functies van 0021 (raise exception … using errcode).
const EIGEN_MELDINGEN = new Set([
  'Dat project bestaat niet (meer).',
  'Het project hoort bij een andere klant.',
  'Kies minstens één persoon.',
  'Geen toegang.'
]);

/** Zet een Supabase-fout om naar een AgendaFout (503 als de tabellen nog niet bestaan). */
export function dbFout(error: unknown): AgendaFout {
  if (tabelOntbreekt(error)) return new AgendaFout(503, NIET_INGERICHT, 'tabel_ontbreekt');
  const e = (error ?? {}) as { code?: string; message?: string };
  if (e.message && EIGEN_MELDINGEN.has(e.message)) {
    return new AgendaFout(e.code === '42501' ? 403 : 400, e.message, e.code === '42501' ? 'geen_recht' : undefined);
  }
  console.error('[agenda]', e.code ?? '', e.message ?? error);
  if (e.code === '42501') return new AgendaFout(403, GEEN_RECHT, 'geen_recht');
  if (e.code === '23505') return new AgendaFout(409, 'Dat bestaat al.');
  if (e.code === '23503') return new AgendaFout(400, 'Die klant, dat project of die persoon bestaat niet (meer).');
  if (e.code === '23514') return new AgendaFout(400, 'De invoer voldoet niet aan de regels (controleer datum, tijd en duur).');
  if (e.code === '22P02') return new AgendaFout(400, 'Ongeldige invoer.');
  return new AgendaFout(500, 'Er ging iets mis bij het opslaan of ophalen van de agenda.');
}

// ---------------------------------------------------------------------------------
// Kolommen
// ---------------------------------------------------------------------------------
const TAAK_BASIS =
  'id,title,notes,due_date,due_time,duration_minutes,priority,client_id,completed_at,created_at,created_by,client:clients(company_name)';
const TAAK_TEAM =
  TAAK_BASIS +
  ',project_id,completed_by,project:projects(naam),toegewezen:task_assignees(user_id),subtaken:task_subtasks(klaar_op)';
const AFSPRAAK_BASIS =
  'id,title,notes,location,starts_at,ends_at,all_day,client_id,created_by,client:clients(company_name)';
const AFSPRAAK_TEAM = AFSPRAAK_BASIS + ',deelnemers:event_attendees(user_id)';

/**
 * Kolommen voor een taak. Met `filterOpPersoon` komt er een tweede koppeling `wie` bij
 * (!inner): daarop filtert de query, terwijl `toegewezen` alle toegewezenen blijft geven.
 */
export function taakKolommen(team: boolean, filterOpPersoon = false): string {
  if (!team) return TAAK_BASIS;
  return filterOpPersoon ? `${TAAK_TEAM},wie:task_assignees!inner(user_id)` : TAAK_TEAM;
}

export function afspraakKolommen(team: boolean, filterOpPersoon = false): string {
  if (!team) return AFSPRAAK_BASIS;
  return filterOpPersoon ? `${AFSPRAAK_TEAM},wie:event_attendees!inner(user_id)` : AFSPRAAK_TEAM;
}

type Join<T> = T | T[] | null;
function eerste<T>(j: Join<T> | undefined): T | null {
  if (!j) return null;
  return Array.isArray(j) ? (j[0] ?? null) : j;
}

export interface TaakDbRij {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  due_time: string | null;
  duration_minutes: number | null;
  priority: number;
  client_id: string | null;
  completed_at: string | null;
  created_at: string;
  created_by?: string | null;
  project_id?: string | null;
  completed_by?: string | null;
  client?: Join<{ company_name: string | null }>;
  project?: Join<{ naam: string | null }>;
  toegewezen?: { user_id: string }[] | null;
  subtaken?: { klaar_op: string | null }[] | null;
}

export interface AfspraakDbRij {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  client_id: string | null;
  created_by?: string | null;
  client?: Join<{ company_name: string | null }>;
  deelnemers?: { user_id: string }[] | null;
}

export function naarTaak(r: TaakDbRij): Taak {
  const sub = r.subtaken ?? [];
  return {
    id: r.id,
    titel: r.title,
    notitie: r.notes ?? '',
    datum: r.due_date,
    tijd: normTijd(r.due_time),
    duur: r.duration_minutes,
    prioriteit: (r.priority === 1 || r.priority === 3 ? r.priority : 2) as Taak['prioriteit'],
    klantId: r.client_id,
    klantNaam: eerste(r.client)?.company_name ?? null,
    afgerond: !!r.completed_at,
    afgerondOp: r.completed_at,
    aangemaakt: r.created_at,
    toegewezen: [...new Set((r.toegewezen ?? []).map((x) => x.user_id))],
    subtaken: { totaal: sub.length, klaar: sub.filter((x) => !!x.klaar_op).length },
    projectId: r.project_id ?? null,
    projectNaam: eerste(r.project)?.naam ?? null,
    aangemaaktDoor: r.created_by ?? null,
    afgerondDoor: r.completed_by ?? null
  };
}

export function naarAfspraak(r: AfspraakDbRij): Afspraak {
  return {
    id: r.id,
    titel: r.title,
    notitie: r.notes ?? '',
    locatie: r.location ?? '',
    start: new Date(r.starts_at).toISOString(),
    eind: new Date(r.ends_at).toISOString(),
    heleDag: r.all_day,
    klantId: r.client_id,
    klantNaam: eerste(r.client)?.company_name ?? null,
    deelnemers: [...new Set((r.deelnemers ?? []).map((x) => x.user_id))],
    aangemaaktDoor: r.created_by ?? null
  };
}

/** Sorteert taken: datum (zonder datum achteraan), tijd (zonder tijd eerst), prioriteit, aanmaak. */
export function sorteerTaken(a: Taak, b: Taak): number {
  if (a.datum !== b.datum) {
    if (!a.datum) return 1;
    if (!b.datum) return -1;
    return a.datum < b.datum ? -1 : 1;
  }
  if (a.tijd !== b.tijd) {
    if (!a.tijd) return -1;
    if (!b.tijd) return 1;
    return a.tijd < b.tijd ? -1 : 1;
  }
  if (a.prioriteit !== b.prioriteit) return a.prioriteit - b.prioriteit;
  return a.aangemaakt < b.aangemaakt ? -1 : 1;
}

/** Het user-id waarop gefilterd wordt, of null (heel team / vóór 0021). */
export function persoonVoor(bron: AgendaBron, wie: Wie | null | undefined): string | null {
  if (!bron.team) return null;
  if (!wie || wie === 'ik') return bron.userId;
  if (wie === 'team') return null;
  return wie;
}

export interface TakenOpties {
  wie?: Wie | null;
  projectId?: string | null;
  klantId?: string | null;
}

// ---------------------------------------------------------------------------------
// Taken
// ---------------------------------------------------------------------------------
export async function takenVoorFilter(
  bron: AgendaBron,
  filter: TakenFilter,
  vandaag: string,
  opties: TakenOpties = {}
): Promise<Taak[]> {
  const persoon = persoonVoor(bron, opties.wie);
  let q = bron.sb.from('tasks').select(taakKolommen(bron.team, !!persoon));
  if (persoon) q = q.eq('wie.user_id', persoon);
  if (bron.team && opties.projectId) q = q.eq('project_id', opties.projectId);
  if (opties.klantId) q = q.eq('client_id', opties.klantId);
  switch (filter) {
    case 'vandaag': // te laat + vandaag: wat er vandaag (nog) moet gebeuren
      q = q.is('completed_at', null).lte('due_date', vandaag);
      break;
    case 'telaat':
      q = q.is('completed_at', null).lt('due_date', vandaag);
      break;
    case 'gepland':
      q = q.is('completed_at', null).gt('due_date', vandaag);
      break;
    case 'ooit':
      q = q.is('completed_at', null).is('due_date', null);
      break;
    case 'afgerond':
      q = q.not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(100);
      break;
  }
  if (filter !== 'afgerond') q = q.limit(500);
  const { data, error } = await q;
  if (error) throw dbFout(error);
  const taken = ((data ?? []) as unknown as TaakDbRij[]).map(naarTaak);
  return filter === 'afgerond' ? taken : taken.sort(sorteerTaken);
}

export async function tellingen(bron: AgendaBron, vandaag: string, opties: TakenOpties = {}): Promise<Tellingen> {
  const persoon = persoonVoor(bron, opties.wie);
  function basis() {
    let q = bron.sb
      .from('tasks')
      .select(persoon ? 'id,wie:task_assignees!inner(user_id)' : 'id', { count: 'exact', head: true })
      .is('completed_at', null);
    if (persoon) q = q.eq('wie.user_id', persoon);
    if (bron.team && opties.projectId) q = q.eq('project_id', opties.projectId);
    if (opties.klantId) q = q.eq('client_id', opties.klantId);
    return q;
  }
  const [a, b, c, d] = await Promise.all([
    basis().lte('due_date', vandaag),
    basis().lt('due_date', vandaag),
    basis().gt('due_date', vandaag),
    basis().is('due_date', null)
  ]);
  for (const r of [a, b, c, d]) if (r.error) throw dbFout(r.error);
  return { vandaag: a.count ?? 0, telaat: b.count ?? 0, gepland: c.count ?? 0, ooit: d.count ?? 0 };
}

/** Eén taak (of null). */
export async function taakOphalen(bron: AgendaBron, id: string): Promise<Taak | null> {
  const { data, error } = await bron.sb.from('tasks').select(taakKolommen(bron.team)).eq('id', id).maybeSingle();
  if (error) throw dbFout(error);
  return data ? naarTaak(data as unknown as TaakDbRij) : null;
}

/** Eén afspraak (of null). */
export async function afspraakOphalen(bron: AgendaBron, id: string): Promise<Afspraak | null> {
  const { data, error } = await bron.sb.from('calendar_events').select(afspraakKolommen(bron.team)).eq('id', id).maybeSingle();
  if (error) throw dbFout(error);
  return data ? naarAfspraak(data as unknown as AfspraakDbRij) : null;
}

/** Eén taak mét de subtaken zelf. */
export async function taakDetail(bron: AgendaBron, id: string): Promise<TaakDetail | null> {
  const taak = await taakOphalen(bron, id);
  if (!taak) return null;
  return { ...taak, subtakenLijst: bron.team ? await subtakenVan(bron, id) : [] };
}

export async function subtakenVan(bron: AgendaBron, taakId: string): Promise<Subtaak[]> {
  const { data, error } = await bron.sb
    .from('task_subtasks')
    .select('id,titel,klaar_op,klaar_door,sort_order')
    .eq('task_id', taakId)
    .order('sort_order')
    .order('created_at');
  if (error) throw dbFout(error);
  return (data ?? []).map(naarSubtaak);
}

export function naarSubtaak(r: { id: string; titel: string; klaar_op: string | null; klaar_door: string | null; sort_order: number }): Subtaak {
  return { id: r.id, titel: r.titel, klaar: !!r.klaar_op, klaarDoor: r.klaar_door, volgorde: r.sort_order };
}

/**
 * Mag de ingelogde gebruiker deze taak wijzigen? (maker of toegewezene; zelfde regel als
 * de RLS-policy, via public.taak_betrokken). Vóór 0021: ja (oude regels).
 */
export async function magTaakWijzigen(bron: AgendaBron, id: string): Promise<boolean> {
  if (!bron.team) return true;
  const { data, error } = await bron.sb.rpc('taak_betrokken', { p_task: id });
  if (error) throw dbFout(error);
  return data === true;
}

export async function magAfspraakWijzigen(bron: AgendaBron, id: string): Promise<boolean> {
  if (!bron.team) return true;
  const { data, error } = await bron.sb.rpc('afspraak_betrokken', { p_event: id });
  if (error) throw dbFout(error);
  return data === true;
}

/**
 * Zijn dit allemaal actieve teamleden? Geeft een foutmelding of null. (De RLS-policy op
 * task_assignees/event_attendees controleert dit ook; dit geeft een nette melding.)
 */
export async function controleerTeamleden(bron: AgendaBron, ids: string[]): Promise<string | null> {
  if (!bron.team) {
    return ids.every((id) => id === bron.userId) ? null : 'Toewijzen aan anderen kan pas na migratie 0021.';
  }
  const { data, error } = await bron.sb.from('team_members').select('user_id').eq('actief', true).in('user_id', ids);
  if (error) throw dbFout(error);
  const actief = new Set((data ?? []).map((r) => r.user_id as string));
  return ids.every((id) => actief.has(id)) ? null : 'Iemand in de lijst is geen (actief) teamlid meer.';
}

/**
 * Vervangt de set toegewezenen/deelnemers: eerst de nieuwe erbij, dan de oude eraf (zo
 * verlies je onderweg nooit je eigen recht om de taak te wijzigen).
 */
export async function zetPersonen(
  bron: AgendaBron,
  soort: 'taak' | 'afspraak',
  id: string,
  nieuw: string[]
): Promise<void> {
  const tabel = soort === 'taak' ? 'task_assignees' : 'event_attendees';
  const kolom = soort === 'taak' ? 'task_id' : 'event_id';
  const huidig = await bron.sb.from(tabel).select('user_id').eq(kolom, id);
  if (huidig.error) throw dbFout(huidig.error);
  const oud = new Set((huidig.data ?? []).map((r) => r.user_id as string));
  const erbij = nieuw.filter((u) => !oud.has(u));
  const eraf = [...oud].filter((u) => !nieuw.includes(u));
  if (erbij.length) {
    const r = await bron.sb.from(tabel).upsert(
      erbij.map((u) => ({ [kolom]: id, user_id: u })),
      { onConflict: `${kolom},user_id`, ignoreDuplicates: true }
    );
    if (r.error) throw dbFout(r.error);
  }
  if (eraf.length) {
    const r = await bron.sb.from(tabel).delete().eq(kolom, id).in('user_id', eraf);
    if (r.error) throw dbFout(r.error);
  }
}

/** Het project (bestaat het, bij welke klant hoort het)? */
export async function projectKlant(bron: AgendaBron, projectId: string): Promise<{ klantId: string | null } | null> {
  const { data, error } = await bron.sb.from('projects').select('client_id').eq('id', projectId).maybeSingle();
  if (error) throw dbFout(error);
  return data ? { klantId: (data.client_id as string | null) ?? null } : null;
}

// ---------------------------------------------------------------------------------
// Agenda en dashboard
// ---------------------------------------------------------------------------------

/** Alle taken (open en afgerond) met een datum in [van, tot] en alle afspraken die die dagen raken. */
export async function agendaBereik(
  bron: AgendaBron,
  van: string,
  tot: string,
  wie: Wie | null = 'ik'
): Promise<{ taken: Taak[]; afspraken: Afspraak[] }> {
  const { start, eind } = bereikMomenten(van, tot);
  const persoon = persoonVoor(bron, wie);
  let tq = bron.sb.from('tasks').select(taakKolommen(bron.team, !!persoon)).gte('due_date', van).lte('due_date', tot);
  let aq = bron.sb.from('calendar_events').select(afspraakKolommen(bron.team, !!persoon)).lt('starts_at', eind).gt('ends_at', start);
  if (persoon) {
    tq = tq.eq('wie.user_id', persoon);
    aq = aq.eq('wie.user_id', persoon);
  }
  const [t, a] = await Promise.all([tq.limit(2000), aq.order('starts_at').limit(2000)]);
  if (t.error) throw dbFout(t.error);
  if (a.error) throw dbFout(a.error);
  return {
    taken: ((t.data ?? []) as unknown as TaakDbRij[]).map(naarTaak).sort(sorteerTaken),
    afspraken: ((a.data ?? []) as unknown as AfspraakDbRij[]).map(naarAfspraak)
  };
}

/** Open taken die jij maakte voor anderen (en waar je zelf niet bij hoort). */
export async function uitgedeeld(bron: AgendaBron, max = 50): Promise<Taak[]> {
  if (!bron.team) return [];
  const { data, error } = await bron.sb
    .from('tasks')
    .select(taakKolommen(true))
    .eq('created_by', bron.userId)
    .is('completed_at', null)
    .order('created_at', { ascending: false })
    .limit(max);
  if (error) throw dbFout(error);
  return ((data ?? []) as unknown as TaakDbRij[])
    .map(naarTaak)
    .filter((t) => t.toegewezen.length > 0 && !t.toegewezen.includes(bron.userId))
    .sort(sorteerTaken);
}

/** Alles voor het eigen dashboard: deze 7 dagen + achterstallige open taken + uitgedeeld. */
export async function dashboardPlanning(
  bron: AgendaBron,
  vandaag: string
): Promise<{ taken: Taak[]; afspraken: Afspraak[]; teLaat: Taak[]; uitgedeeld: Taak[] }> {
  const [bereik, teLaat, uit] = await Promise.all([
    agendaBereik(bron, vandaag, plusDagen(vandaag, 6), 'ik'),
    takenVoorFilter(bron, 'telaat', vandaag, { wie: 'ik' }),
    uitgedeeld(bron)
  ]);
  return { ...bereik, teLaat, uitgedeeld: uit };
}

// ---------------------------------------------------------------------------------
// Projecten
// ---------------------------------------------------------------------------------
const PROJECT_KOLOMMEN = 'id,naam,client_id,status,notitie,created_by,client:clients(company_name)';

interface ProjectDbRij {
  id: string;
  naam: string;
  client_id: string | null;
  status: string;
  notitie: string | null;
  created_by: string | null;
  client?: Join<{ company_name: string | null }>;
}

export function naarProject(r: ProjectDbRij, openTaken = 0): Project {
  return {
    id: r.id,
    naam: r.naam,
    klantId: r.client_id,
    klantNaam: eerste(r.client)?.company_name ?? null,
    status: r.status === 'gearchiveerd' ? 'gearchiveerd' : 'actief',
    notitie: r.notitie ?? '',
    openTaken,
    aangemaaktDoor: r.created_by
  };
}

export async function projectenLijst(
  bron: AgendaBron,
  opties: { status?: 'actief' | 'gearchiveerd' | 'alle'; klantId?: string | null } = {}
): Promise<Project[]> {
  if (!bron.team) throw new AgendaFout(503, NIET_INGERICHT, 'tabel_ontbreekt');
  let q = bron.sb.from('projects').select(PROJECT_KOLOMMEN).order('naam').limit(1000);
  if (opties.status && opties.status !== 'alle') q = q.eq('status', opties.status);
  if (opties.klantId) q = q.eq('client_id', opties.klantId);
  const [p, t] = await Promise.all([
    q,
    bron.sb.from('tasks').select('project_id').not('project_id', 'is', null).is('completed_at', null).limit(5000)
  ]);
  if (p.error) throw dbFout(p.error);
  if (t.error) throw dbFout(t.error);
  const open = new Map<string, number>();
  for (const r of t.data ?? []) {
    const id = r.project_id as string;
    open.set(id, (open.get(id) ?? 0) + 1);
  }
  return ((p.data ?? []) as unknown as ProjectDbRij[])
    .map((r) => naarProject(r, open.get(r.id) ?? 0))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

export async function projectOphalen(bron: AgendaBron, id: string): Promise<Project | null> {
  const { data, error } = await bron.sb.from('projects').select(PROJECT_KOLOMMEN).eq('id', id).maybeSingle();
  if (error) throw dbFout(error);
  if (!data) return null;
  const { count } = await bron.sb
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', id)
    .is('completed_at', null);
  return naarProject(data as unknown as ProjectDbRij, count ?? 0);
}

export { PROJECT_KOLOMMEN };
export type { ProjectDbRij };
