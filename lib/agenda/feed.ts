import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { systeemClient } from '@/lib/supabase/systeem';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { normTijd, plusDagen, vandaag, type Dag } from './datum';
import { clientVan, maakIcs, type FeedAfspraak, type FeedTaak } from './ics';
import { FEED_KOLOMMEN, NIET_INGERICHT, naarFeedStatus, type FeedRij, type FeedStatus } from './feed-status';

// Agenda-abonnement per teamlid (migratie 0029): een geheime link die Apple Agenda of Google
// Agenda zelf periodiek ophaalt. Alleen de SHA-256 van het token staat in de database.
//
//   status       is de link gekoppeld (minstens één keer door een agenda-app opgehaald)?
//   nieuweLink   nieuw token (de oude link werkt dan niet meer); de link zie je alleen nu
//   uitstellen   koppelen een dag uitstellen (als de agenda-app de link nog niet ophaalde)
//   feedVoorToken  de ICS-inhoud voor de publieke route app/api/agenda-feed/[token], zonder
//                sessie: alleen met een geldig token van een actief teamlid.

export { moetKoppelen, type AgendaClient, type FeedStatus } from './feed-status';

const UITSTEL_UREN = 24;
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

const KOLOMMEN = FEED_KOLOMMEN;

export async function feedStatus(lid: Teamlid): Promise<FeedStatus> {
  const { data, error } = await lid.sb.from('agenda_feeds').select(KOLOMMEN).eq('user_id', lid.userId).maybeSingle();
  if (error) {
    if (tabelOntbreekt(error)) return NIET_INGERICHT;
    throw error;
  }
  return naarFeedStatus((data as FeedRij | null) ?? null);
}

export async function nieuweLink(lid: Teamlid): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const sb = createServiceRoleClient(lid.bewijs);
  const { error } = await sb.from('agenda_feeds').upsert(
    { user_id: lid.userId, token_hash: hash(token), aangemaakt_op: new Date().toISOString(), eerst_opgehaald_op: null, laatst_opgehaald_op: null, client: null },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
  return token;
}

export async function uitstellen(lid: Teamlid): Promise<string> {
  const tot = new Date(Date.now() + UITSTEL_UREN * 3_600_000).toISOString();
  const sb = createServiceRoleClient(lid.bewijs);
  const { error } = await sb.from('agenda_feeds').update({ uitgesteld_tot: tot }).eq('user_id', lid.userId);
  if (error) throw error;
  return tot;
}

interface TaakRij {
  id: string;
  title: string;
  notes: string | null;
  due_date: Dag;
  due_time: string | null;
  duration_minutes: number | null;
  priority: number;
  completed_at: string | null;
}

interface AfspraakRij {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
}

/** De ICS-inhoud bij een token, of null (onbekend token of geen actief teamlid). */
export async function feedVoorToken(token: string, ua: string | null, basis: string | null): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const sb = systeemClient('agendafeed');
  const { data: feed, error } = await sb.from('agenda_feeds').select('user_id, eerst_opgehaald_op').eq('token_hash', hash(token)).maybeSingle();
  if (error) throw error;
  if (!feed) return null;
  const userId = (feed as { user_id: string }).user_id;

  const [lidRes, profielRes] = await Promise.all([
    sb.from('team_members').select('actief').eq('user_id', userId).maybeSingle(),
    sb.from('profiles').select('naam').eq('id', userId).maybeSingle()
  ]);
  if (lidRes.error) throw lidRes.error;
  if (!(lidRes.data as { actief?: boolean } | null)?.actief) return null;

  // Venster: 60 dagen terug (ook te late open taken en net afgeronde) t/m ruim een jaar vooruit.
  const nu = new Date();
  const dag = vandaag(nu);
  const van = plusDagen(dag, -60);
  const tot = plusDagen(dag, 400);
  const [takenRes, afsprakenRes] = await Promise.all([
    sb
      .from('tasks')
      .select('id,title,notes,due_date,due_time,duration_minutes,priority,completed_at,wie:task_assignees!inner(user_id)')
      .eq('wie.user_id', userId)
      .not('due_date', 'is', null)
      .gte('due_date', van)
      .lte('due_date', tot)
      .limit(2000),
    sb
      .from('calendar_events')
      .select('id,title,notes,location,starts_at,ends_at,all_day,wie:event_attendees!inner(user_id)')
      .eq('wie.user_id', userId)
      .gte('ends_at', new Date(nu.getTime() - 60 * 86_400_000).toISOString())
      .lte('starts_at', new Date(nu.getTime() + 400 * 86_400_000).toISOString())
      .limit(2000)
  ]);
  if (takenRes.error) throw takenRes.error;
  if (afsprakenRes.error) throw afsprakenRes.error;

  const taken: FeedTaak[] = ((takenRes.data ?? []) as unknown as TaakRij[]).map((t) => ({
    id: t.id,
    titel: t.title,
    notitie: t.notes ?? '',
    datum: t.due_date,
    tijd: normTijd(t.due_time),
    duur: t.duration_minutes,
    prioriteit: t.priority === 1 || t.priority === 3 ? t.priority : 2,
    afgerond: Boolean(t.completed_at)
  }));
  const afspraken: FeedAfspraak[] = ((afsprakenRes.data ?? []) as unknown as AfspraakRij[]).map((a) => ({
    id: a.id,
    titel: a.title,
    notitie: a.notes ?? '',
    locatie: a.location ?? '',
    start: a.starts_at,
    eind: a.ends_at,
    heleDag: a.all_day
  }));

  // Bijhouden dat (en door welke app) de link is opgehaald: dat maakt het koppelen af.
  const opgehaald: Record<string, string> = { laatst_opgehaald_op: nu.toISOString(), client: clientVan(ua) };
  if (!(feed as { eerst_opgehaald_op: string | null }).eerst_opgehaald_op) opgehaald.eerst_opgehaald_op = nu.toISOString();
  await sb.from('agenda_feeds').update(opgehaald).eq('user_id', userId);

  const naam = ((profielRes.data as { naam?: string } | null)?.naam ?? '').trim() || 'Agenda';
  return maakIcs({ naam, taken, afspraken, link: basis ? `${basis}/agenda` : null, nu });
}
