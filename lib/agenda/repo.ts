import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { bereikMomenten, normTijd, plusDagen } from './datum';
import type { Afspraak, Taak, TakenFilter, Tellingen } from './types';

// Database-toegang voor agenda & taken. Altijd met de gebruikerscliënt (RLS), ná een
// sessie-check in de aanroepende route of pagina.

export class AgendaFout extends Error {
  status: number;
  code?: 'tabel_ontbreekt';
  constructor(status: number, message: string, code?: 'tabel_ontbreekt') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const NIET_INGERICHT = 'Agenda nog niet ingericht';

/** Zet een Supabase-fout om naar een AgendaFout (503 als de tabellen nog niet bestaan). */
export function dbFout(error: unknown): AgendaFout {
  if (tabelOntbreekt(error)) return new AgendaFout(503, NIET_INGERICHT, 'tabel_ontbreekt');
  console.error('[agenda]', error);
  const code = (error as { code?: string } | null)?.code;
  if (code === '23503') return new AgendaFout(400, 'Die klant bestaat niet (meer).');
  if (code === '23514') return new AgendaFout(400, 'De invoer voldoet niet aan de regels (controleer datum, tijd en duur).');
  if (code === '22P02') return new AgendaFout(400, 'Ongeldige invoer.');
  return new AgendaFout(500, 'Er ging iets mis bij het opslaan of ophalen van de agenda.');
}

export const TAAK_KOLOMMEN =
  'id,title,notes,due_date,due_time,duration_minutes,priority,client_id,completed_at,created_at,client:clients(company_name)';
export const AFSPRAAK_KOLOMMEN =
  'id,title,notes,location,starts_at,ends_at,all_day,client_id,client:clients(company_name)';

type KlantJoin = { company_name: string | null } | { company_name: string | null }[] | null;

function klantNaam(c: KlantJoin | undefined): string | null {
  if (!c) return null;
  const x = Array.isArray(c) ? c[0] : c;
  return x?.company_name ?? null;
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
  client?: KlantJoin;
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
  client?: KlantJoin;
}

export function naarTaak(r: TaakDbRij): Taak {
  return {
    id: r.id,
    titel: r.title,
    notitie: r.notes ?? '',
    datum: r.due_date,
    tijd: normTijd(r.due_time),
    duur: r.duration_minutes,
    prioriteit: (r.priority === 1 || r.priority === 3 ? r.priority : 2) as Taak['prioriteit'],
    klantId: r.client_id,
    klantNaam: klantNaam(r.client),
    afgerond: !!r.completed_at,
    afgerondOp: r.completed_at,
    aangemaakt: r.created_at
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
    klantNaam: klantNaam(r.client)
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

export async function takenVoorFilter(sb: SupabaseClient, filter: TakenFilter, vandaag: string): Promise<Taak[]> {
  let q = sb.from('tasks').select(TAAK_KOLOMMEN);
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

export async function tellingen(sb: SupabaseClient, vandaag: string): Promise<Tellingen> {
  const tel = (f: (q: ReturnType<typeof basis>) => ReturnType<typeof basis>) => f(basis());
  function basis() {
    return sb.from('tasks').select('id', { count: 'exact', head: true }).is('completed_at', null);
  }
  const [a, b, c, d] = await Promise.all([
    tel((q) => q.lte('due_date', vandaag)),
    tel((q) => q.lt('due_date', vandaag)),
    tel((q) => q.gt('due_date', vandaag)),
    tel((q) => q.is('due_date', null))
  ]);
  for (const r of [a, b, c, d]) if (r.error) throw dbFout(r.error);
  return { vandaag: a.count ?? 0, telaat: b.count ?? 0, gepland: c.count ?? 0, ooit: d.count ?? 0 };
}

/** Alle taken (open en afgerond) met een datum in [van, tot] en alle afspraken die die dagen raken. */
export async function agendaBereik(
  sb: SupabaseClient,
  van: string,
  tot: string
): Promise<{ taken: Taak[]; afspraken: Afspraak[] }> {
  const { start, eind } = bereikMomenten(van, tot);
  const [t, a] = await Promise.all([
    sb.from('tasks').select(TAAK_KOLOMMEN).gte('due_date', van).lte('due_date', tot).limit(2000),
    sb
      .from('calendar_events')
      .select(AFSPRAAK_KOLOMMEN)
      .lt('starts_at', eind)
      .gt('ends_at', start)
      .order('starts_at')
      .limit(2000)
  ]);
  if (t.error) throw dbFout(t.error);
  if (a.error) throw dbFout(a.error);
  return {
    taken: ((t.data ?? []) as unknown as TaakDbRij[]).map(naarTaak).sort(sorteerTaken),
    afspraken: ((a.data ?? []) as unknown as AfspraakDbRij[]).map(naarAfspraak)
  };
}

/** Alles voor het dashboard: deze 7 dagen + achterstallige open taken. */
export async function dashboardPlanning(
  sb: SupabaseClient,
  vandaag: string
): Promise<{ taken: Taak[]; afspraken: Afspraak[]; teLaat: Taak[] }> {
  const [bereik, teLaat] = await Promise.all([
    agendaBereik(sb, vandaag, plusDagen(vandaag, 6)),
    takenVoorFilter(sb, 'telaat', vandaag)
  ]);
  return { ...bereik, teLaat };
}
