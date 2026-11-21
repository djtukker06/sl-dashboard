import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { amsterdamNaarMoment, plusDagen, type Dag } from '@/lib/agenda/datum';
import { afspraakAlsInvoer, parseAfspraak } from '@/lib/agenda/invoer';
import type { Afspraak, AfspraakInvoer } from '@/lib/agenda/types';
import type { ExternBereik } from '@/lib/agenda/extern-types';
import { logFout } from '@/lib/log';
import { itemsUit, xmlBereik } from './dav-kern';
import { IcsFout, afsprakenUitIcs, nieuweIcs, wijzigIcs, zonderVoorkomen, type AppleAgendaVoorWeergave } from './ics-kern';
import { isBestandsnaam, splitsAppleId } from './id-kern';
import {
  AppleAgendaFout,
  LIJST_VERVERS_MS,
  MELDING,
  accountsVan,
  agendasVan,
  appleStatus,
  davVoor,
  naarAccounts,
  type AccountRij,
  type AgendaRij,
  type Verbinding
} from './koppeling';

// Afspraken uit Apple Agenda (iCloud) lezen en schrijven, voor de agenda (/agenda), het
// dashboard en de meldingen. Niets wordt bewaard: elke keer rechtstreeks uit iCloud (met een
// korte cache van 30 seconden per agenda en bereik, alleen voor dashboard en meldingen: de
// agenda zelf leest altijd vers, zodat een wijziging nooit even "terugspringt").

const CACHE_MS = 30_000;
const cache = new Map<string, { t: number; events: Afspraak[] }>();

function vergeet(agendaId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${agendaId}|`)) cache.delete(k);
}

function weergave(a: AgendaRij, account: AccountRij): AppleAgendaVoorWeergave {
  return { id: a.id, naam: a.naam, kleur: a.kleur, schrijfbaar: a.schrijfbaar, email: account.apple_id };
}

/** De naam van het .ics-bestand uit een href ("/123/calendars/home/ABC.ics" → "ABC.ics"). */
function bestandUit(href: string): string | null {
  const laatste = href.split('?')[0].replace(/\/+$/, '').split('/').pop() ?? '';
  try {
    const naam = decodeURIComponent(laatste);
    return isBestandsnaam(naam) ? naam : null;
  } catch {
    return null;
  }
}

export function itemUrl(agenda: AgendaRij, bestand: string): string {
  const basis = agenda.url.endsWith('/') ? agenda.url : `${agenda.url}/`;
  return new URL(encodeURIComponent(bestand), basis).toString();
}

/** Alle afspraken van één agenda die [van, tot) raken. */
async function lijstEvents(v: Verbinding, agenda: AgendaRij, van: Date, tot: Date, metCache: boolean): Promise<Afspraak[]> {
  const sleutel = `${agenda.id}|${van.toISOString()}|${tot.toISOString()}|${agenda.naam}|${agenda.kleur}`;
  const c = cache.get(sleutel);
  if (metCache && c && Date.now() - c.t < CACHE_MS) return c.events;
  const r = await davVoor(v, agenda.url, 'REPORT', { body: xmlBereik(van, tot), diepte: '1' });
  if (r.status === 404) return [];
  if (r.status === 403) throw new AppleAgendaFout('geen_recht', 'Deze agenda kan niet worden gelezen.');
  if (r.status !== 207) throw new AppleAgendaFout('icloud', MELDING.icloud, `report ${r.status}`);
  const uit: Afspraak[] = [];
  const w = weergave(agenda, v.account);
  for (const item of itemsUit(r.tekst)) {
    const bestand = bestandUit(item.href);
    if (!bestand) continue;
    uit.push(...afsprakenUitIcs(item.ics, bestand, w, van, tot));
    if (uit.length > 5000) break;
  }
  cache.set(sleutel, { t: Date.now(), events: uit });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return uit;
}

/**
 * Afspraken van je zichtbare Apple-agenda's die [van, tot] raken (Amsterdamse dagen), plus de
 * status voor de schakelaars. Een account dat niet werkt staat in `fouten`; de rest laadt.
 */
export async function appleBereik(service: SupabaseClient, userId: string, van: Dag, tot: Dag, metCache = false): Promise<ExternBereik & { verouderd: AccountRij[] }> {
  const s = await appleStatus(service, userId);
  if (!s.status.tabellen) return { status: { apple: s.status, google: null, accounts: [] }, events: [], fouten: [], verouderd: [] };
  const [accounts, agendas] = await Promise.all([accountsVan(service, userId), agendasVan(service, userId)]);
  const begin = amsterdamNaarMoment(van);
  const eind = amsterdamNaarMoment(plusDagen(tot, 1));
  const fouten: ExternBereik['fouten'] = [];
  const events: Afspraak[] = [];

  await Promise.all(
    accounts.map(async (account) => {
      const eigen = agendas.filter((a) => a.account_id === account.id && a.zichtbaar);
      if (!eigen.length) return;
      if (account.fout === 'opnieuw_koppelen') {
        fouten.push({ accountId: account.id, melding: MELDING.opnieuw_koppelen });
        return;
      }
      const v: Verbinding = { account, service };
      const res = await Promise.allSettled(eigen.map((a) => lijstEvents(v, a, begin, eind, metCache)));
      let gemeld = false;
      for (const r of res) {
        if (r.status === 'fulfilled') events.push(...r.value);
        else if (!gemeld) {
          gemeld = true;
          const e = r.reason;
          if (!(e instanceof AppleAgendaFout) || e.code === 'icloud') logFout('[apple-agenda] afspraken ophalen', e instanceof AppleAgendaFout ? `${e.code} ${e.detail}` : e);
          fouten.push({ accountId: account.id, melding: e instanceof AppleAgendaFout ? e.message : MELDING.icloud });
        }
      }
    })
  );

  const verouderd = accounts.filter(
    (a) => a.fout !== 'opnieuw_koppelen' && (!a.lijst_bijgewerkt_op || Date.now() - Date.parse(a.lijst_bijgewerkt_op) > LIJST_VERVERS_MS)
  );
  // Status na het ophalen: een account kan intussen "opnieuw koppelen" zijn geworden.
  return { status: { apple: s.status, google: null, accounts: naarAccounts(accounts, agendas) }, events, fouten, verouderd };
}

// ---------------------------------------------------------------------------------
// Eén afspraak
// ---------------------------------------------------------------------------------

export async function vindAgenda(service: SupabaseClient, userId: string, agendaId: string): Promise<{ agenda: AgendaRij; v: Verbinding }> {
  const agenda = (await agendasVan(service, userId)).find((a) => a.id === agendaId);
  const account = agenda ? (await accountsVan(service, userId)).find((a) => a.id === agenda.account_id) : undefined;
  if (!agenda || !account) throw new AppleAgendaFout('niet_gevonden', 'Deze Apple-agenda is niet (meer) gekoppeld.');
  return { agenda, v: { account, service } };
}

async function haalItem(v: Verbinding, agenda: AgendaRij, bestand: string): Promise<{ ics: string; etag: string | null }> {
  const r = await davVoor(v, itemUrl(agenda, bestand), 'GET');
  if (r.status === 404 || r.status === 410) throw new AppleAgendaFout('niet_gevonden');
  if (r.status === 403) throw new AppleAgendaFout('geen_recht');
  if (r.status !== 200) throw new AppleAgendaFout('icloud', MELDING.icloud, `get ${r.status}`);
  return { ics: r.tekst, etag: r.etag };
}

function codeNaarMoment(code: string): Date {
  const dag = `${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)}`;
  return code.length === 8 ? amsterdamNaarMoment(dag) : new Date(`${dag}T${code.slice(9, 11)}:${code.slice(11, 13)}:${code.slice(13, 15)}Z`);
}

/** De afspraak (of het voorkomen) met dit id uit een .ics-bestand. */
function kies(ics: string, bestand: string, w: AppleAgendaVoorWeergave, id: string, voorkomen: string | null): Afspraak | null {
  if (voorkomen) {
    const m = codeNaarMoment(voorkomen).getTime();
    // Een verschoven voorkomen kan ver van zijn oorspronkelijke datum staan: ruim zoeken.
    const lijst = afsprakenUitIcs(ics, bestand, w, new Date(m - 400 * 86_400_000), new Date(m + 400 * 86_400_000), 5000);
    return lijst.find((a) => a.id === id) ?? null;
  }
  const lijst = afsprakenUitIcs(ics, bestand, w, new Date(Date.UTC(1900, 0, 1)), new Date(Date.UTC(2200, 0, 1)), 1);
  return lijst[0] ?? null;
}

function ontleed(id: string) {
  const d = splitsAppleId(id);
  if (!d) throw new AppleAgendaFout('niet_gevonden');
  return d;
}

export async function appleAfspraak(service: SupabaseClient, userId: string, id: string): Promise<Afspraak> {
  const { agendaId, bestand, voorkomen } = ontleed(id);
  const { agenda, v } = await vindAgenda(service, userId, agendaId);
  const { ics } = await haalItem(v, agenda, bestand);
  const a = kies(ics, bestand, weergave(agenda, v.account), id, voorkomen);
  if (!a) throw new AppleAgendaFout('niet_gevonden');
  return a;
}

function invoerFout(fout: string): AppleAgendaFout {
  return new AppleAgendaFout('ongeldig', fout);
}

export async function schrijf(v: Verbinding, agenda: AgendaRij, bestand: string, ics: string, voorwaarde: Record<string, string>) {
  const r = await davVoor(v, itemUrl(agenda, bestand), 'PUT', { body: ics, type: 'text/calendar; charset=utf-8', headers: voorwaarde });
  if (r.status === 412) throw new AppleAgendaFout('gewijzigd');
  if (r.status === 403) throw new AppleAgendaFout('geen_recht');
  if (r.status === 404) throw new AppleAgendaFout('niet_gevonden');
  if (r.status < 200 || r.status >= 300) throw new AppleAgendaFout('icloud', MELDING.icloud, `put ${r.status}`);
  vergeet(agenda.id);
}

export async function maakAppleAfspraak(service: SupabaseClient, userId: string, agendaId: string, body: AfspraakInvoer): Promise<Afspraak> {
  const { agenda, v } = await vindAgenda(service, userId, agendaId);
  if (!agenda.schrijfbaar) throw new AppleAgendaFout('geen_recht', 'In deze Apple-agenda kun je geen afspraken maken.');
  const invoer: AfspraakInvoer = { ...body };
  delete invoer.klantId;
  delete invoer.deelnemers;
  const p = parseAfspraak(invoer, null);
  if (!p.ok) throw invoerFout(p.fout);
  const uid = randomUUID().toUpperCase();
  const bestand = `${uid}.ics`;
  const ics = nieuweIcs(p.waarde, uid);
  await schrijf(v, agenda, bestand, ics, { 'If-None-Match': '*' });
  const a = kies(ics, bestand, weergave(agenda, v.account), `a.${agenda.id}`, null);
  if (!a) throw new AppleAgendaFout('icloud');
  return a;
}

/**
 * Een afspraak in Apple Agenda wijzigen. Bij een voorkomen van een reeks: 'deze' wijzigt
 * alleen dat voorkomen, anders de hele reeks. De herhaalregel van een reeks blijft zoals hij
 * in Apple staat.
 */
export async function wijzigAppleAfspraak(service: SupabaseClient, userId: string, id: string, body: AfspraakInvoer): Promise<Afspraak> {
  const { agendaId, bestand, voorkomen } = ontleed(id);
  const { agenda, v } = await vindAgenda(service, userId, agendaId);
  const { ics, etag } = await haalItem(v, agenda, bestand);
  const w = weergave(agenda, v.account);
  const huidig = kies(ics, bestand, w, id, voorkomen);
  if (!huidig) throw new AppleAgendaFout('niet_gevonden');
  if (!huidig.extern?.schrijfbaar) throw new AppleAgendaFout('geen_recht');

  const invoer: AfspraakInvoer = { ...body };
  delete invoer.klantId;
  delete invoer.deelnemers;
  if (invoer.titel === huidig.titel) delete invoer.titel;
  if (invoer.notitie === huidig.notitie) delete invoer.notitie;
  if (invoer.locatie === huidig.locatie) delete invoer.locatie;
  if (huidig.extern.herhaalt) {
    delete invoer.herhaling;
    delete invoer.herhaalTot;
  }
  const p = parseAfspraak(invoer, afspraakAlsInvoer({ starts_at: huidig.start, ends_at: huidig.eind, all_day: huidig.heleDag }));
  if (!p.ok) throw invoerFout(p.fout);
  const rij = p.waarde;
  const metTijd =
    rij.starts_at !== undefined &&
    (Date.parse(rij.starts_at) !== Date.parse(huidig.start) || Date.parse(rij.ends_at!) !== Date.parse(huidig.eind) || rij.all_day !== huidig.heleDag);
  if (!metTijd && rij.title === undefined && rij.notes === undefined && rij.location === undefined && !('herhaling' in rij)) return huidig;

  let nieuw: string;
  try {
    nieuw = wijzigIcs(ics, {
      voorkomen,
      deze: body.toepassen === 'deze',
      rij,
      metTijd,
      huidig: { start: huidig.start, eind: huidig.eind, heleDag: huidig.heleDag }
    });
  } catch (e) {
    if (e instanceof IcsFout) throw new AppleAgendaFout('niet_gevonden', e.message);
    throw e;
  }
  await schrijf(v, agenda, bestand, nieuw, etag ? { 'If-Match': etag } : {});
  // Het id van een voorkomen blijft gelijk (de oorspronkelijke datum); zonder voorkomen ook.
  return kies(nieuw, bestand, w, id, voorkomen) ?? kies(nieuw, bestand, w, id, null) ?? huidig;
}

/** Verwijderen: 'deze' = alleen dit voorkomen, anders de hele afspraak (of reeks). */
export async function verwijderAppleAfspraak(service: SupabaseClient, userId: string, id: string, toepassen: 'deze' | 'reeks' | null): Promise<void> {
  const { agendaId, bestand, voorkomen } = ontleed(id);
  const { agenda, v } = await vindAgenda(service, userId, agendaId);
  if (!agenda.schrijfbaar) throw new AppleAgendaFout('geen_recht', 'Uit deze agenda kun je niets verwijderen.');
  if (voorkomen && toepassen === 'deze') {
    let item: { ics: string; etag: string | null };
    try {
      item = await haalItem(v, agenda, bestand);
    } catch (e) {
      if (e instanceof AppleAgendaFout && e.code === 'niet_gevonden') return;
      throw e;
    }
    const over = zonderVoorkomen(item.ics, voorkomen);
    if (over) {
      await schrijf(v, agenda, bestand, over, item.etag ? { 'If-Match': item.etag } : {});
      return;
    }
  }
  const r = await davVoor(v, itemUrl(agenda, bestand), 'DELETE');
  vergeet(agenda.id);
  if (r.status === 404 || r.status === 410) return;
  if (r.status === 403) throw new AppleAgendaFout('geen_recht');
  if (r.status < 200 || r.status >= 300) throw new AppleAgendaFout('icloud', MELDING.icloud, `delete ${r.status}`);
}

// ---------------------------------------------------------------------------------
// Dashboard en meldingen
// ---------------------------------------------------------------------------------

/**
 * Eigen afspraken aangevuld met je zichtbare Apple-afspraken in [van, tot]. Best effort en
 * kort: duurt iCloud langer dan 2,5 s of gaat er iets mis, dan alleen de eigen afspraken.
 */
export async function metAppleAfspraken(service: SupabaseClient, userId: string, van: Dag, tot: Dag, eigen: Afspraak[]): Promise<Afspraak[]> {
  const apple = await Promise.race([
    appleBereik(service, userId, van, tot, true).then((r) => r.events),
    new Promise<Afspraak[]>((klaar) => setTimeout(() => klaar([]), 2_500).unref?.())
  ]).catch(() => [] as Afspraak[]);
  if (!apple.length) return eigen;
  return [...eigen, ...apple].sort((a, b) => a.start.localeCompare(b.start));
}
