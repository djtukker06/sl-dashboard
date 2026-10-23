import type { SupabaseClient } from '@supabase/supabase-js';
import { kolomOntbreekt, tabelOntbreekt } from '@/lib/db/ontbreekt';
import { projectStatusVan, projectStatusVoor0023, type ProjectRij } from './teaminvoer';
import { bereikMomenten, normTijd, plusDagen } from './datum';
import { verdeelDashboardTaken } from './dashboard';
import type { Afspraak, Project, Subtaak, Taak, TaakDetail, TakenFilter, Tellingen } from './types';

// Database-toegang voor agenda & taken. Altijd met de gebruikerscliënt (RLS), ná een
// sessie-check in de aanroepende route of pagina.
//
// Taken op naam (migratie 0021): een taak hoort bij één of meer teamleden (task_assignees),
// een afspraak bij deelnemers (event_attendees). Elke lijst, de agenda en het dashboard tonen
// alleen wat op JOUW naam staat; wat je voor een ander maakte zie je alleen onder "Uitgezet"
// (en op de projectpagina). Er is geen teamweergave: de RLS van 0022 laat een ander teamlid
// een losse taak van jou niet eens lezen. Zolang 0021 niet is uitgevoerd (bron.team = false) bestaan die tabellen niet:
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

/**
 * Het user-id waarop gefilterd wordt: altijd jijzelf (vóór 0021: null, dan bestaat er geen
 * toewijzing). Er is bewust geen parameter: niemand kan de lijst van een ander opvragen.
 */
export function persoonVoor(bron: AgendaBron): string | null {
  return bron.team ? bron.userId : null;
}

export interface TakenOpties {
  projectId?: string | null;
  klantId?: string | null;
}

/** Hoe lang afgeronde taken onder "Uitgezet" blijven staan (om op te volgen). */
export const UITGEZET_KLAAR_DAGEN = 14;

// ---------------------------------------------------------------------------------
// Taken
// ---------------------------------------------------------------------------------
export async function takenVoorFilter(
  bron: AgendaBron,
  filter: TakenFilter,
  vandaag: string,
  opties: TakenOpties = {}
): Promise<Taak[]> {
  if (filter === 'uitgezet') return uitgezet(bron, vandaag, opties);
  const persoon = persoonVoor(bron);
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
  // Met 0022: één query (database-functie taak_tellingen, RLS geldt). Zonder: vijf.
  if (bron.team) {
    const { data, error } = await bron.sb.rpc('taak_tellingen', {
      p_vandaag: vandaag,
      p_project: opties.projectId ?? null,
      p_klant: opties.klantId ?? null
    });
    if (!error) {
      const r = (Array.isArray(data) ? data[0] : data) as Partial<Tellingen> | null;
      return { vandaag: r?.vandaag ?? 0, telaat: r?.telaat ?? 0, gepland: r?.gepland ?? 0, ooit: r?.ooit ?? 0, uitgezet: r?.uitgezet ?? 0 };
    }
    if (!tabelOntbreekt(error)) throw dbFout(error);
  }
  return tellingenLos(bron, vandaag, opties);
}

/** De tellers met losse count-queries (vóór migratie 0022). */
async function tellingenLos(bron: AgendaBron, vandaag: string, opties: TakenOpties): Promise<Tellingen> {
  const persoon = persoonVoor(bron);
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
  const [a, b, c, d, u] = await Promise.all([
    basis().lte('due_date', vandaag),
    basis().lt('due_date', vandaag),
    basis().gt('due_date', vandaag),
    basis().is('due_date', null),
    uitgezetAantal(bron, opties)
  ]);
  for (const r of [a, b, c, d]) if (r.error) throw dbFout(r.error);
  return { vandaag: a.count ?? 0, telaat: b.count ?? 0, gepland: c.count ?? 0, ooit: d.count ?? 0, uitgezet: u };
}

// ---------------------------------------------------------------------------------
// Uitgezet: taken die jij maakte voor een ander (en waar je zelf niet op staat)
// ---------------------------------------------------------------------------------
// Gefilterd in SQL met een anti-join (PostgREST): de koppeling `mij` bevat alleen jouw
// eigen toewijzing; `mij is null` = je staat er niet op. Zo telt de limiet alleen echte
// uitgezette taken.
function uitgezetQuery(bron: AgendaBron, kolommen: string, opties: TakenOpties, telling = false) {
  let q = bron.sb
    .from('tasks')
    .select(`${kolommen},mij:task_assignees(user_id)`, telling ? { count: 'exact', head: true } : undefined)
    .eq('created_by', bron.userId)
    .eq('mij.user_id', bron.userId)
    .is('mij', null);
  if (opties.projectId) q = q.eq('project_id', opties.projectId);
  if (opties.klantId) q = q.eq('client_id', opties.klantId);
  return q;
}

/**
 * Open uitgezette taken (te laat en eerstvolgende deadline eerst) plus die in de laatste
 * UITGEZET_KLAAR_DAGEN dagen zijn afgerond (nieuwste eerst), zodat je kunt opvolgen.
 */
export async function uitgezet(bron: AgendaBron, vandaag: string, opties: TakenOpties = {}): Promise<Taak[]> {
  if (!bron.team) return [];
  const sinds = bereikMomenten(plusDagen(vandaag, -UITGEZET_KLAAR_DAGEN), vandaag).start;
  const [open, klaar] = await Promise.all([
    uitgezetQuery(bron, taakKolommen(true), opties).is('completed_at', null).limit(300),
    uitgezetQuery(bron, taakKolommen(true), opties)
      .gte('completed_at', sinds)
      .order('completed_at', { ascending: false })
      .limit(50)
  ]);
  if (open.error) throw dbFout(open.error);
  if (klaar.error) throw dbFout(klaar.error);
  const naar = (d: unknown) => ((d ?? []) as unknown as TaakDbRij[]).map(naarTaak);
  return [...naar(open.data).sort(sorteerTaken), ...naar(klaar.data)];
}

/** Aantal open uitgezette taken (tab-teller en de link op het dashboard). */
export async function uitgezetAantal(bron: AgendaBron, opties: TakenOpties = {}): Promise<number> {
  if (!bron.team) return 0;
  const { count, error } = await uitgezetQuery(bron, 'id', opties, true).is('completed_at', null);
  if (error) throw dbFout(error);
  return count ?? 0;
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
  tot: string
): Promise<{ taken: Taak[]; afspraken: Afspraak[] }> {
  const { start, eind } = bereikMomenten(van, tot);
  const persoon = persoonVoor(bron);
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

/** Hoeveel taken het dashboard per extra groep ("Zonder deadline", "Later") meeneemt. */
export const DASHBOARD_EXTRA_MAX = 8;

export interface DashboardPlanning {
  taken: Taak[];
  afspraken: Afspraak[];
  teLaat: Taak[];
  /** Jouw open taken zonder deadline. */
  zonderDeadline: Taak[];
  /** Jouw eerstvolgende open taken met een deadline ná deze 7 dagen. */
  later: Taak[];
  /** Aantal open taken die je voor een ander maakte (link naar "Uitgezet"; geen taakrijen). */
  uitgezet: number;
}

/**
 * Alles voor het eigen dashboard: deze 7 dagen, achterstallige open taken, jouw open taken
 * zonder deadline en de eerstvolgende daarna (zodat elke taak op jouw naam hier te zien
 * is), plus het AANTAL taken dat je voor een ander maakte (die taken zelf niet: die staan
 * niet in jouw lijst, alleen onder "Uitgezet").
 */
export async function dashboardPlanning(bron: AgendaBron, vandaag: string): Promise<DashboardPlanning> {
  // Drie queries tegelijk (waren er vijf): jouw taken die open zijn OF in deze 7 dagen
  // vallen (verdeeld in lib/agenda/dashboard.ts), jouw afspraken, en het aantal uitgezet.
  const tot = plusDagen(vandaag, 6);
  const { start, eind } = bereikMomenten(vandaag, tot);
  const persoon = persoonVoor(bron);
  let tq = bron.sb
    .from('tasks')
    .select(taakKolommen(bron.team, !!persoon))
    .or(`completed_at.is.null,and(due_date.gte.${vandaag},due_date.lte.${tot})`);
  let aq = bron.sb.from('calendar_events').select(afspraakKolommen(bron.team, !!persoon)).lt('starts_at', eind).gt('ends_at', start);
  if (persoon) {
    tq = tq.eq('wie.user_id', persoon);
    aq = aq.eq('wie.user_id', persoon);
  }
  const [t, a, uit] = await Promise.all([tq.limit(1000), aq.order('starts_at').limit(2000), uitgezetAantal(bron)]);
  if (t.error) throw dbFout(t.error);
  if (a.error) throw dbFout(a.error);
  const taken = ((t.data ?? []) as unknown as TaakDbRij[]).map(naarTaak).sort(sorteerTaken);
  return {
    ...verdeelDashboardTaken(taken, vandaag, tot, DASHBOARD_EXTRA_MAX),
    afspraken: ((a.data ?? []) as unknown as AfspraakDbRij[]).map(naarAfspraak),
    uitgezet: uit
  };
}

// ---------------------------------------------------------------------------------
// Projecten
// ---------------------------------------------------------------------------------
// Met migratie 0023: status voorbereiding/bezig/wachten/afgerond en status_sinds. Met 0022:
// status gepland/bezig/afgerond, deadline en eigenaren (geen status_sinds; 'gepland' wordt
// getoond als voorbereiding). Daarvóór (oude modus) bestaan deadline en project_eigenaren
// niet en is de status actief/gearchiveerd; dan lezen we de oude kolommen en tonen we
// 'bezig'/'afgerond'.
const PROJECT_KOLOMMEN_OUD = 'id,naam,client_id,status,notitie,created_by,client:clients(company_name)';
const PROJECT_KOLOMMEN = `${PROJECT_KOLOMMEN_OUD},deadline,eigenaren:project_eigenaren(user_id)`;
const PROJECT_KOLOMMEN_0023 = `${PROJECT_KOLOMMEN},status_sinds`;

// Of 0023 er is, onthouden we even (per serverproces), zodat niet elke query eerst
// mislukt zolang de migratie nog niet is uitgevoerd. Na een minuut kijken we opnieuw.
let zonder0023Tot = 0;

interface ProjectDbRij {
  id: string;
  naam: string;
  client_id: string | null;
  status: string;
  notitie: string | null;
  deadline?: string | null;
  status_sinds?: string | null;
  created_by: string | null;
  client?: Join<{ company_name: string | null }>;
  eigenaren?: { user_id: string }[] | null;
}

export function naarProject(r: ProjectDbRij, taken: { open: number; totaal: number } = { open: 0, totaal: 0 }): Project {
  return {
    id: r.id,
    naam: r.naam,
    klantId: r.client_id,
    klantNaam: eerste(r.client)?.company_name ?? null,
    status: projectStatusVan(r.status) ?? 'bezig',
    statusSinds: r.status_sinds ?? null,
    notitie: r.notitie ?? '',
    deadline: r.deadline ?? null,
    eigenaren: [...new Set((r.eigenaren ?? []).map((x) => x.user_id))],
    openTaken: taken.open,
    totaalTaken: taken.totaal,
    aangemaaktDoor: r.created_by
  };
}

/** Welke projecten: 'lopend' = alles behalve afgerond (de kiezer in de taak-popup). */
export type ProjectSelectie = 'lopend' | 'afgerond' | 'alle';
const AFGEROND = ['afgerond', 'gearchiveerd'];

/**
 * Voert een projectquery uit met de nieuwe kolommen, en zonder 0022 met de oude.
 * strikt (de pagina's Klanten & projecten): zonder 0022 een 503 'tabel_ontbreekt'.
 */
async function metProjectKolommen<T>(
  q: (kolommen: string) => PromiseLike<{ data: T | null; error: unknown }>,
  strikt = false
): Promise<T | null> {
  if (Date.now() >= zonder0023Tot) {
    const n = await q(PROJECT_KOLOMMEN_0023);
    if (!n.error) return n.data;
    if (!kolomOntbreekt(n.error) || tabelOntbreekt(n.error)) throw dbFout(n.error);
    zonder0023Tot = Date.now() + 60_000;
  }
  const r = await q(PROJECT_KOLOMMEN);
  if (!r.error) return r.data;
  if (!kolomOntbreekt(r.error) || tabelOntbreekt(r.error)) throw dbFout(r.error);
  if (strikt) throw new AgendaFout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');
  const oud = await q(PROJECT_KOLOMMEN_OUD);
  if (oud.error) throw dbFout(oud.error);
  return oud.data;
}

/** Open en totaal aantal taken per project (wat jij mag zien; projecttaken: het hele team). */
export async function projectTaakTellingen(
  bron: AgendaBron,
  projectIds?: string[]
): Promise<Map<string, { open: number; totaal: number }>> {
  const uit = new Map<string, { open: number; totaal: number }>();
  if (projectIds && !projectIds.length) return uit;
  // Met 0022: een group by in de database (project_taak_tellingen, RLS geldt).
  const rpc = await bron.sb.rpc('project_taak_tellingen', { p_projecten: projectIds ?? null });
  if (!rpc.error) {
    for (const r of (rpc.data ?? []) as { project_id: string; open: number; totaal: number }[]) {
      uit.set(r.project_id, { open: Number(r.open) || 0, totaal: Number(r.totaal) || 0 });
    }
    return uit;
  }
  if (!tabelOntbreekt(rpc.error)) throw dbFout(rpc.error);
  // Zonder 0022: de taakrijen ophalen en hier tellen.
  let q = bron.sb.from('tasks').select('project_id,completed_at').not('project_id', 'is', null).limit(10000);
  if (projectIds) q = q.in('project_id', projectIds);
  const { data, error } = await q;
  if (error) throw dbFout(error);
  for (const r of data ?? []) {
    const id = r.project_id as string;
    const t = uit.get(id) ?? { open: 0, totaal: 0 };
    t.totaal++;
    if (!r.completed_at) t.open++;
    uit.set(id, t);
  }
  return uit;
}

export async function projectenLijst(
  bron: AgendaBron,
  opties: { selectie?: ProjectSelectie; klantId?: string | null; strikt?: boolean } = {}
): Promise<Project[]> {
  if (!bron.team) throw new AgendaFout(503, NIET_INGERICHT, 'tabel_ontbreekt');
  const selectie = opties.selectie ?? 'alle';
  const haalRijen = () =>
    metProjectKolommen<ProjectDbRij[]>((k) => {
      let q = bron.sb.from('projects').select(k).order('naam').limit(1000);
      if (selectie === 'lopend') q = q.not('status', 'in', `(${AFGEROND.join(',')})`);
      if (selectie === 'afgerond') q = q.in('status', AFGEROND);
      if (opties.klantId) q = q.eq('client_id', opties.klantId);
      return q as unknown as PromiseLike<{ data: ProjectDbRij[] | null; error: unknown }>;
    }, opties.strikt);
  let rijen: ProjectDbRij[] | null;
  let tellingen: Map<string, { open: number; totaal: number }>;
  if (opties.klantId) {
    // Klantpagina: alleen de taken van de projecten van deze klant tellen (meestal 0–3).
    rijen = await haalRijen();
    tellingen = await projectTaakTellingen(bron, (rijen ?? []).map((r) => r.id));
  } else {
    // Projectenoverzicht toont alles: rijen en tellingen parallel.
    [rijen, tellingen] = await Promise.all([haalRijen(), projectTaakTellingen(bron)]);
  }
  return (rijen ?? [])
    .map((r) => naarProject(r, tellingen.get(r.id)))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

export async function projectOphalen(bron: AgendaBron, id: string, strikt = false): Promise<Project | null> {
  const [rij, tellingen] = await Promise.all([
    metProjectKolommen<ProjectDbRij>(
      (k) => bron.sb.from('projects').select(k).eq('id', id).maybeSingle() as unknown as PromiseLike<{ data: ProjectDbRij | null; error: unknown }>,
      strikt
    ),
    projectTaakTellingen(bron, [id])
  ]);
  if (!rij) return null;
  return naarProject(rij, tellingen.get(id));
}

/**
 * Zet de eigenaren van een project op precies deze set (alleen met migratie 0022).
 * RLS: alleen actieve teamleden kunnen eigenaar zijn.
 */
export async function zetProjectEigenaren(bron: AgendaBron, projectId: string, eigenaren: string[]): Promise<void> {
  const weg = bron.sb.from('project_eigenaren').delete().eq('project_id', projectId);
  const { error: e1 } = eigenaren.length
    ? await weg.not('user_id', 'in', `(${eigenaren.join(',')})`)
    : await weg;
  if (e1) throw kolomOntbreekt(e1) ? new AgendaFout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt') : dbFout(e1);
  if (!eigenaren.length) return;
  const { error: e2 } = await bron.sb
    .from('project_eigenaren')
    .upsert(
      eigenaren.map((u) => ({ project_id: projectId, user_id: u })),
      { onConflict: 'project_id,user_id', ignoreDuplicates: true }
    );
  if (e2) {
    if (kolomOntbreekt(e2)) throw new AgendaFout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');
    if ((e2 as { code?: string }).code === '42501') throw new AgendaFout(400, 'Alleen actieve teamleden kunnen eigenaar zijn.');
    throw dbFout(e2);
  }
}

/** Melding als je "Wachten op goedkeuring" kiest vóór migratie 0023. */
export const WACHTEN_NA_0023 = 'De status "Wachten op goedkeuring" werkt zodra migratie 0023 is uitgevoerd (supabase/UITVOEREN_0023.sql).';

/**
 * Schrijft een project (insert of update) en vangt een database van vóór 0023 op: weigert
 * de statuscheck de nieuwe waarde, dan nogmaals met de oude ('voorbereiding' → 'gepland').
 * 'wachten' bestaat vóór 0023 niet: een nette 503.
 */
export async function metStatusTerugval<T>(
  rij: ProjectRij,
  schrijf: (rij: ProjectRij) => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>
): Promise<{ data: T | null; error: { code?: string; message?: string } | null }> {
  const r = await schrijf(rij);
  const statusFout = r.error?.code === '23514' && /projects_status_check/.test(r.error.message ?? '');
  if (!statusFout || !rij.status) return r;
  const oud = projectStatusVoor0023(rij.status);
  if (oud === null) throw new AgendaFout(409, WACHTEN_NA_0023);
  if (oud === rij.status) return r;
  return schrijf({ ...rij, status: oud });
}

/** Melding als migratie 0022 (klanten & projecten) nog niet is uitgevoerd. */
export const CRM_NIET_INGERICHT = 'Klanten & projecten nog niet ingericht (migratie 0022).';

export { PROJECT_KOLOMMEN };
export type { ProjectDbRij };
