import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leesSleutel, ontsleutelMet, versleutelMet } from '@/lib/mail/kluis-kern';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logFout } from '@/lib/log';
import type { ExternAccount, ExternAgenda, BronStatus } from '@/lib/agenda/extern-types';
import { ICLOUD_CALDAV, XML_AGENDAS, XML_HOME, XML_PRINCIPAL, agendasUit, absoluut, homeUit, isIcloudHost, principalUit } from './dav-kern';

// De Apple Agenda-koppelingen (migratie 0040). Elk teamlid koppelt zelf zijn iCloud-agenda's
// met zijn Apple ID en een app-specifiek wachtwoord; die agenda's zijn alleen van hem.
//
//   apple_agenda_accounts  per Apple ID het versleutelde app-wachtwoord en de iCloud-adressen
//   apple_agendas          per agenda: naam, kleur, schrijfbaar, tonen
//
// Beide tabellen: RLS aan zonder policies, alleen de server (service-role) leest en schrijft,
// altijd gefilterd op het user-id van het ingelogde teamlid. Het wachtwoord gaat door
// dezelfde AES-256-GCM-kluis als de mailboxen (MAIL_ENCRYPTION_KEY) met een eigen AAD
// ("apple-agenda:<user>:<account>"), zodat het nergens anders bruikbaar is. Verbindingen gaan
// alleen naar iCloud (https, *caldav*.icloud.com): ook een omleiding naar elders volgen we niet.

/** De agendalijst opnieuw ophalen als hij ouder is dan dit (nieuwe/verwijderde agenda's). */
export const LIJST_VERVERS_MS = 12 * 3_600_000;
export const STANDAARD_KLEUR = '#1badf8';

export type FoutCode =
  | 'niet_ingericht'
  | 'tabel_ontbreekt'
  | 'verkeerd_wachtwoord'
  | 'opnieuw_koppelen'
  | 'niet_gevonden'
  | 'geen_recht'
  | 'gewijzigd'
  | 'ongeldig'
  | 'icloud';

const STATUS: Record<FoutCode, number> = {
  niet_ingericht: 503,
  tabel_ontbreekt: 503,
  verkeerd_wachtwoord: 400,
  opnieuw_koppelen: 409,
  niet_gevonden: 404,
  geen_recht: 403,
  gewijzigd: 409,
  ongeldig: 400,
  icloud: 502
};

export const MELDING: Record<FoutCode, string> = {
  niet_ingericht: 'Apple Agenda koppelen is nog niet ingericht op de server (MAIL_ENCRYPTION_KEY).',
  tabel_ontbreekt: 'Apple Agenda koppelen is nog niet ingericht: voer in Supabase supabase/UITVOEREN_0040.sql uit.',
  verkeerd_wachtwoord:
    'Apple weigert dit Apple ID of wachtwoord. Gebruik een app-specifiek wachtwoord (account.apple.com → Inloggen en beveiliging → App-specifieke wachtwoorden), niet je gewone wachtwoord.',
  opnieuw_koppelen: 'De toegang tot Apple Agenda werkt niet meer (wachtwoord ingetrokken?). Koppel opnieuw met een nieuw app-specifiek wachtwoord.',
  niet_gevonden: 'Deze afspraak bestaat niet (meer) in Apple Agenda.',
  geen_recht: 'In deze agenda mag je niets wijzigen.',
  gewijzigd: 'Deze afspraak is net ergens anders gewijzigd. Open hem opnieuw en probeer het nog eens.',
  ongeldig: 'Ongeldige invoer.',
  icloud: 'iCloud is even niet bereikbaar. Probeer het zo opnieuw.'
};

export class AppleAgendaFout extends Error {
  code: FoutCode;
  status: number;
  detail: string;
  constructor(code: FoutCode, bericht = MELDING[code], detail = '') {
    super(bericht);
    this.code = code;
    this.status = STATUS[code];
    this.detail = detail.slice(0, 300);
  }
}

// ---------------------------------------------------------------------------------
// Wachtwoord
// ---------------------------------------------------------------------------------

const sleutel = () => leesSleutel(process.env.MAIL_ENCRYPTION_KEY);
const aad = (userId: string, accountId: string) => `apple-agenda:${userId}:${accountId}`;

export function ingericht(): boolean {
  return sleutel() !== null;
}

function versleutel(wachtwoord: string, userId: string, accountId: string): string {
  const k = sleutel();
  if (!k) throw new AppleAgendaFout('niet_ingericht');
  return versleutelMet(k, wachtwoord, aad(userId, accountId));
}

function ontsleutel(a: AccountRij): string | null {
  const k = sleutel();
  if (!k) return null;
  try {
    return ontsleutelMet(k, a.wachtwoord_enc, aad(a.user_id, a.id));
  } catch {
    return null;
  }
}

/** Een Apple ID: een e-mailadres (of telefoonnummer, maar voor CalDAV is het altijd e-mail). */
export function normAppleId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s.length >= 3 && s.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/** Een app-specifiek wachtwoord: xxxx-xxxx-xxxx-xxxx (spaties en hoofdletters mogen). */
export function normAppWachtwoord(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '').toLowerCase();
  if (/^[a-z]{16}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
  return /^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/.test(s) ? s : null;
}

// ---------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------

export interface AccountRij {
  id: string;
  user_id: string;
  apple_id: string;
  wachtwoord_enc: string;
  principal_url: string;
  home_url: string;
  lijst_bijgewerkt_op: string | null;
  fout: string | null;
}

export interface AgendaRij {
  id: string;
  account_id: string;
  user_id: string;
  url: string;
  naam: string;
  kleur: string;
  schrijfbaar: boolean;
  zichtbaar: boolean;
  volgorde: number;
}

const ACCOUNT_VELDEN = 'id, user_id, apple_id, wachtwoord_enc, principal_url, home_url, lijst_bijgewerkt_op, fout';
const AGENDA_VELDEN = 'id, account_id, user_id, url, naam, kleur, schrijfbaar, zichtbaar, volgorde';

function dbFout(error: unknown): never {
  if (tabelOntbreekt(error)) throw new AppleAgendaFout('tabel_ontbreekt');
  throw error;
}

export async function accountsVan(service: SupabaseClient, userId: string): Promise<AccountRij[]> {
  const { data, error } = await service.from('apple_agenda_accounts').select(ACCOUNT_VELDEN).eq('user_id', userId).order('gekoppeld_op');
  if (error) dbFout(error);
  return (data ?? []) as AccountRij[];
}

export async function agendasVan(service: SupabaseClient, userId: string): Promise<AgendaRij[]> {
  const { data, error } = await service.from('apple_agendas').select(AGENDA_VELDEN).eq('user_id', userId).order('volgorde').order('naam');
  if (error) dbFout(error);
  return (data ?? []) as AgendaRij[];
}

export function naarAccounts(accounts: AccountRij[], agendas: AgendaRij[]): ExternAccount[] {
  return accounts.map((a) => ({
    id: a.id,
    bron: 'apple',
    email: a.apple_id,
    fout: a.fout,
    agendas: agendas
      .filter((g) => g.account_id === a.id)
      .map(
        (g): ExternAgenda => ({
          id: g.id,
          bron: 'apple',
          accountId: a.id,
          naam: g.naam,
          kleur: g.kleur,
          zichtbaar: g.zichtbaar,
          inFeed: false,
          schrijfbaar: g.schrijfbaar,
          primair: false
        })
      )
  }));
}

/** Of Apple Agenda kan (sleutel, tabellen) en de gekoppelde accounts. */
export async function appleStatus(service: SupabaseClient, userId: string): Promise<{ status: BronStatus; accounts: ExternAccount[] }> {
  const status = { ingericht: ingericht(), tabellen: true };
  try {
    const [accounts, agendas] = await Promise.all([accountsVan(service, userId), agendasVan(service, userId)]);
    return { status, accounts: naarAccounts(accounts, agendas) };
  } catch (e) {
    if (e instanceof AppleAgendaFout && e.code === 'tabel_ontbreekt') return { status: { ...status, tabellen: false }, accounts: [] };
    throw e;
  }
}

async function markeerFout(service: SupabaseClient, account: AccountRij) {
  account.fout = 'opnieuw_koppelen';
  await service.from('apple_agenda_accounts').update({ fout: 'opnieuw_koppelen' }).eq('id', account.id).eq('user_id', account.user_id);
}

// ---------------------------------------------------------------------------------
// CalDAV over https
// ---------------------------------------------------------------------------------

export interface Verbinding {
  account: AccountRij;
  service: SupabaseClient;
}

interface Inlog {
  appleId: string;
  wachtwoord: string;
}

export interface DavResultaat {
  status: number;
  tekst: string;
  etag: string | null;
}

function veiligeUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !isIcloudHost(u.hostname) || u.username || u.password) throw new AppleAgendaFout('icloud', MELDING.icloud, `geen icloud-url ${u.hostname}`);
  return u;
}

/**
 * Eén CalDAV-verzoek naar iCloud met Basic-inlog. Omleidingen (iCloud stuurt je naar je eigen
 * pXX-server) volgen we zelf, en alleen naar iCloud. Geeft status, tekst en ETag; gooit bij
 * netwerkfouten en 5xx.
 */
export async function dav(
  inlog: Inlog,
  url: string,
  method: string,
  o: { body?: string; diepte?: '0' | '1'; type?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<DavResultaat> {
  let doel = veiligeUrl(url);
  const auth = `Basic ${Buffer.from(`${inlog.appleId}:${inlog.wachtwoord}`, 'utf8').toString('base64')}`;
  for (let stap = 0; stap < 4; stap++) {
    let res: Response;
    try {
      res = await fetch(doel, {
        method,
        redirect: 'manual',
        cache: 'no-store',
        signal: o.signal ?? AbortSignal.timeout(15_000),
        headers: {
          Authorization: auth,
          'User-Agent': 'CRM-Agenda/1.0',
          ...(o.body ? { 'Content-Type': o.type ?? 'application/xml; charset=utf-8' } : {}),
          ...(o.diepte ? { Depth: o.diepte } : {}),
          ...o.headers
        },
        body: o.body
      });
    } catch (e) {
      throw new AppleAgendaFout('icloud', MELDING.icloud, e instanceof Error ? e.name : 'netwerk');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const naar = absoluut(res.headers.get('location')!, doel.toString());
      if (!naar) throw new AppleAgendaFout('icloud', MELDING.icloud, 'omleiding buiten icloud');
      doel = veiligeUrl(naar);
      continue;
    }
    const tekst = await res.text();
    if (res.status >= 500) throw new AppleAgendaFout('icloud', MELDING.icloud, `${method} ${res.status}`);
    return { status: res.status, tekst: tekst.slice(0, 20_000_000), etag: res.headers.get('etag') };
  }
  throw new AppleAgendaFout('icloud', MELDING.icloud, 'te veel omleidingen');
}

/** dav() met het opgeslagen wachtwoord; 401 = account markeren als "opnieuw koppelen". */
export async function davVoor(v: Verbinding, url: string, method: string, o: Parameters<typeof dav>[3] = {}): Promise<DavResultaat> {
  if (v.account.fout === 'opnieuw_koppelen') throw new AppleAgendaFout('opnieuw_koppelen');
  const wachtwoord = ontsleutel(v.account);
  if (!wachtwoord) {
    if (!ingericht()) throw new AppleAgendaFout('niet_ingericht');
    await markeerFout(v.service, v.account);
    throw new AppleAgendaFout('opnieuw_koppelen');
  }
  const r = await dav({ appleId: v.account.apple_id, wachtwoord }, url, method, o);
  if (r.status === 401) {
    await markeerFout(v.service, v.account);
    throw new AppleAgendaFout('opnieuw_koppelen');
  }
  return r;
}

/** Principal en agenda-map van een Apple ID; 401 = verkeerd wachtwoord. */
async function ontdek(inlog: Inlog): Promise<{ principal: string; home: string }> {
  const p = await dav(inlog, ICLOUD_CALDAV, 'PROPFIND', { body: XML_PRINCIPAL, diepte: '0' });
  if (p.status === 401 || p.status === 403) throw new AppleAgendaFout('verkeerd_wachtwoord');
  if (p.status !== 207) throw new AppleAgendaFout('icloud', MELDING.icloud, `principal ${p.status}`);
  const principal = principalUit(p.tekst, ICLOUD_CALDAV);
  if (!principal) throw new AppleAgendaFout('icloud', MELDING.icloud, 'geen principal');
  const h = await dav(inlog, principal, 'PROPFIND', { body: XML_HOME, diepte: '0' });
  if (h.status !== 207) throw new AppleAgendaFout('icloud', MELDING.icloud, `home ${h.status}`);
  const home = homeUit(h.tekst, principal);
  if (!home) throw new AppleAgendaFout('icloud', MELDING.icloud, 'geen agenda-map');
  return { principal, home };
}

async function haalAgendaLijst(inlog: Inlog, home: string) {
  const r = await dav(inlog, home, 'PROPFIND', { body: XML_AGENDAS, diepte: '1' });
  if (r.status === 401) return null;
  if (r.status !== 207) throw new AppleAgendaFout('icloud', MELDING.icloud, `agendas ${r.status}`);
  return agendasUit(r.tekst, home, STANDAARD_KLEUR);
}

/** De agenda's in de database gelijk trekken met iCloud (naam, rechten; kleur en tonen blijven). */
async function bewaarLijst(service: SupabaseClient, account: AccountRij, lijst: NonNullable<Awaited<ReturnType<typeof haalAgendaLijst>>>) {
  const bestaand = (await agendasVan(service, account.user_id)).filter((a) => a.account_id === account.id);
  const perUrl = new Map(bestaand.map((a) => [a.url, a]));
  const nieuw = lijst.map((g, i) => {
    const oud = perUrl.get(g.url);
    return {
      id: oud?.id ?? randomUUID(),
      account_id: account.id,
      user_id: account.user_id,
      url: g.url,
      naam: g.naam,
      kleur: oud?.kleur ?? g.kleur,
      schrijfbaar: g.schrijfbaar,
      zichtbaar: oud?.zichtbaar ?? true,
      volgorde: i
    };
  });
  if (nieuw.length) {
    const { error } = await service.from('apple_agendas').upsert(nieuw, { onConflict: 'account_id,url' });
    if (error) dbFout(error);
  }
  const weg = bestaand.filter((a) => !lijst.some((g) => g.url === a.url)).map((a) => a.id);
  if (weg.length) await service.from('apple_agendas').delete().in('id', weg).eq('user_id', account.user_id);
  await service.from('apple_agenda_accounts').update({ lijst_bijgewerkt_op: new Date().toISOString(), fout: null }).eq('id', account.id).eq('user_id', account.user_id);
}

/**
 * Een Apple ID koppelen (of opnieuw, met een nieuw wachtwoord): inloggen bij iCloud, de
 * agenda's ophalen en opslaan. Het wachtwoord wordt alleen bewaard als iCloud het accepteert.
 */
export async function koppelAccount(service: SupabaseClient, userId: string, appleId: string, wachtwoord: string): Promise<void> {
  if (!ingericht()) throw new AppleAgendaFout('niet_ingericht');
  const inlog = { appleId, wachtwoord };
  const { principal, home } = await ontdek(inlog);
  const lijst = await haalAgendaLijst(inlog, home);
  if (!lijst) throw new AppleAgendaFout('verkeerd_wachtwoord');
  if (!lijst.length) throw new AppleAgendaFout('ongeldig', 'In dit iCloud-account staan geen agenda’s. Zet in je iPhone-instellingen bij iCloud “Agenda” aan.');

  const bestaand = (await accountsVan(service, userId)).find((a) => a.apple_id === appleId);
  const id = bestaand?.id ?? randomUUID();
  const rij = {
    id,
    user_id: userId,
    apple_id: appleId,
    wachtwoord_enc: versleutel(wachtwoord, userId, id),
    principal_url: principal,
    home_url: home,
    fout: null,
    lijst_bijgewerkt_op: new Date().toISOString()
  };
  const { error } = bestaand
    ? await service.from('apple_agenda_accounts').update(rij).eq('id', id).eq('user_id', userId)
    : await service.from('apple_agenda_accounts').insert(rij);
  if (error) dbFout(error);
  await bewaarLijst(service, { ...rij, lijst_bijgewerkt_op: rij.lijst_bijgewerkt_op }, lijst);
}

/** De agendalijst van een gekoppeld account opnieuw ophalen. */
export async function synchroniseerLijst(v: Verbinding): Promise<void> {
  const wachtwoord = ontsleutel(v.account);
  if (!wachtwoord || v.account.fout === 'opnieuw_koppelen') throw new AppleAgendaFout('opnieuw_koppelen');
  const lijst = await haalAgendaLijst({ appleId: v.account.apple_id, wachtwoord }, v.account.home_url);
  if (!lijst) {
    await markeerFout(v.service, v.account);
    throw new AppleAgendaFout('opnieuw_koppelen');
  }
  await bewaarLijst(v.service, v.account, lijst);
}

export async function vernieuwAccount(service: SupabaseClient, userId: string, accountId: string): Promise<void> {
  const account = (await accountsVan(service, userId)).find((a) => a.id === accountId);
  if (!account) throw new AppleAgendaFout('niet_gevonden', 'Dit Apple-account is niet (meer) gekoppeld.');
  await synchroniseerLijst({ account, service });
}

export async function ontkoppel(service: SupabaseClient, userId: string, accountId: string): Promise<boolean> {
  const { data, error } = await service.from('apple_agenda_accounts').delete().eq('id', accountId).eq('user_id', userId).select('id');
  if (error) dbFout(error);
  return (data ?? []).length > 0;
}

export async function wijzigAgenda(service: SupabaseClient, userId: string, agendaId: string, w: { zichtbaar?: boolean; kleur?: string }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (typeof w.zichtbaar === 'boolean') patch.zichtbaar = w.zichtbaar;
  if (typeof w.kleur === 'string' && /^#[0-9a-f]{6}$/.test(w.kleur)) patch.kleur = w.kleur;
  if (!Object.keys(patch).length) throw new AppleAgendaFout('ongeldig');
  const { data, error } = await service.from('apple_agendas').update(patch).eq('id', agendaId).eq('user_id', userId).select('id');
  if (error) dbFout(error);
  if (!(data ?? []).length) throw new AppleAgendaFout('niet_gevonden', 'Deze agenda is niet (meer) gekoppeld.');
}

/** Verouderde agendalijsten verversen (na het antwoord, best effort). */
export async function verversLijsten(service: SupabaseClient, accounts: AccountRij[]): Promise<void> {
  for (const account of accounts) {
    try {
      await synchroniseerLijst({ account, service });
    } catch (e) {
      if (!(e instanceof AppleAgendaFout) || e.code === 'icloud') logFout('[apple-agenda] agendalijst verversen', e);
    }
  }
}
