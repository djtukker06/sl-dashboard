import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ontsleutelMet, versleutelMet } from '@/lib/mail/kluis-kern';
import { clientId, clientSecret, ontbrekendeEnv, sleutel } from '@/lib/drive/config';
import { DriveFout, trekIn, vernieuwToken } from '@/lib/drive/kern';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logFout } from '@/lib/log';
import { CAL_URL, agendaNaam, normKleur, standaardInstellingen, toegangVan, isSchrijfbaar, type GAgendaItem, type Toegang } from './kern';
import type { GoogleAccount, GoogleAgenda, GoogleStatus } from './types';

// De Google Agenda-koppelingen (migratie 0035). Elk teamlid koppelt zelf één of meer
// Google-accounts; de agenda's daarvan zijn alleen van hem (niet van het team).
//
//   google_agenda_accounts  per gekoppeld account het versleutelde refresh token
//   google_agendas          per agenda in dat account: naam, kleur, tonen, in de agenda-link
//
// Beide tabellen: RLS aan zonder policies, alleen de server (service-role) leest en schrijft,
// en altijd gefilterd op het user-id van het ingelogde teamlid (of van het token van de
// agenda-link). Het refresh token gaat door dezelfde AES-256-GCM-kluis als Drive en de
// mailboxen (zelfde sleutel, lib/drive/config.ts), met een eigen AAD, zodat een
// Drive-token nooit als agenda-token bruikbaar is en andersom. Access tokens (1 uur) blijven
// alleen in het geheugen van de server.

const AAD = 'google-agenda';
/** De agendalijst opnieuw ophalen als hij ouder is dan dit (nieuwe/verwijderde agenda's). */
export const LIJST_VERVERS_MS = 12 * 3_600_000;

export type FoutCode = 'niet_ingericht' | 'tabel_ontbreekt' | 'opnieuw_koppelen' | 'niet_gevonden' | 'geen_recht' | 'ongeldig' | 'api_uit' | 'google';

const STATUS: Record<FoutCode, number> = {
  niet_ingericht: 503,
  tabel_ontbreekt: 503,
  opnieuw_koppelen: 409,
  niet_gevonden: 404,
  geen_recht: 403,
  ongeldig: 400,
  api_uit: 503,
  google: 502
};

export const MELDING: Record<FoutCode, string> = {
  niet_ingericht: 'Google Agenda is nog niet ingericht op de server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en een sleutel).',
  tabel_ontbreekt: 'Google Agenda is nog niet ingericht: voer in Supabase supabase/UITVOEREN_0035.sql uit.',
  opnieuw_koppelen: 'De toegang tot Google Agenda is verlopen of ingetrokken. Koppel het account opnieuw.',
  niet_gevonden: 'Deze afspraak bestaat niet (meer) in Google Agenda.',
  geen_recht: 'Je mag deze afspraak in Google niet wijzigen (alleen de organisator).',
  ongeldig: 'Ongeldige invoer.',
  api_uit: 'De Google Calendar API staat nog niet aan in Google Cloud.',
  google: 'Google Agenda is even niet bereikbaar. Probeer het zo opnieuw.'
};

export class GoogleAgendaFout extends Error {
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
// Tokens
// ---------------------------------------------------------------------------------

export function ingericht(): boolean {
  return ontbrekendeEnv().length === 0;
}

export function versleutelToken(token: string): string {
  const k = sleutel();
  if (!k) throw new GoogleAgendaFout('niet_ingericht');
  return versleutelMet(k, token, AAD);
}

function ontsleutelToken(waarde: string): string | null {
  const k = sleutel();
  if (!k) return null;
  try {
    return ontsleutelMet(k, waarde, AAD);
  } catch {
    return null;
  }
}

const tokens = new Map<string, { token: string; verloopt: number }>();
const lopend = new Map<string, Promise<string>>();

/** Zet een vers access token (direct na het koppelen) in de cache. */
export function onthoudToken(enc: string, token: string, verlooptOverSec: number): void {
  tokens.set(enc, { token, verloopt: Date.now() + Math.max(60, verlooptOverSec - 120) * 1000 });
}

async function accessToken(rij: AccountRij, vers: boolean, service: SupabaseClient): Promise<string> {
  const enc = rij.refresh_token_enc;
  const c = tokens.get(enc);
  if (!vers && c && c.verloopt > Date.now()) return c.token;
  const bezig = lopend.get(enc);
  if (bezig) return bezig;
  const belofte = (async () => {
    const refresh = ontsleutelToken(enc);
    if (!refresh) throw new GoogleAgendaFout('opnieuw_koppelen');
    try {
      const t = await vernieuwToken(fetch, { clientId: clientId(), clientSecret: clientSecret(), refreshToken: refresh });
      onthoudToken(enc, t.accessToken, t.verlooptOver);
      if (rij.fout) void markeer(service, rij.id, null);
      return t.accessToken;
    } catch (e) {
      tokens.delete(enc);
      if (e instanceof DriveFout && e.code === 'opnieuw_koppelen') {
        // Ingetrokken of verlopen: onthouden, zodat het scherm "Opnieuw koppelen" toont.
        void markeer(service, rij.id, 'opnieuw_koppelen');
        throw new GoogleAgendaFout('opnieuw_koppelen', MELDING.opnieuw_koppelen, e.detail);
      }
      if (e instanceof DriveFout && e.code === 'niet_ingericht') throw new GoogleAgendaFout('niet_ingericht', e.message, e.detail);
      throw new GoogleAgendaFout('google', MELDING.google, e instanceof DriveFout ? e.detail : String(e));
    } finally {
      lopend.delete(enc);
    }
  })();
  lopend.set(enc, belofte);
  return belofte;
}

async function markeer(service: SupabaseClient, accountId: string, fout: string | null) {
  const { error } = await service.from('google_agenda_accounts').update({ fout }).eq('id', accountId);
  if (error) logFout('[google-agenda] status bijwerken', error);
}

// ---------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------

export interface AccountRij {
  id: string;
  user_id: string;
  google_email: string;
  refresh_token_enc: string;
  fout: string | null;
  lijst_bijgewerkt_op: string | null;
}

export interface AgendaRij {
  id: string;
  account_id: string;
  user_id: string;
  google_id: string;
  naam: string;
  kleur: string;
  toegang: Toegang;
  primair: boolean;
  zichtbaar: boolean;
  in_feed: boolean;
  volgorde: number;
}

const ACCOUNT_KOLOMMEN = 'id,user_id,google_email,refresh_token_enc,fout,lijst_bijgewerkt_op';
const AGENDA_KOLOMMEN = 'id,account_id,user_id,google_id,naam,kleur,toegang,primair,zichtbaar,in_feed,volgorde';

function dbFout(error: unknown, waar: string): GoogleAgendaFout {
  if (tabelOntbreekt(error)) return new GoogleAgendaFout('tabel_ontbreekt');
  logFout(`[google-agenda] ${waar}`, error);
  return new GoogleAgendaFout('google', 'De Google-koppeling kon niet worden gelezen. Probeer het opnieuw.');
}

export async function accountsVan(service: SupabaseClient, userId: string): Promise<AccountRij[]> {
  const { data, error } = await service.from('google_agenda_accounts').select(ACCOUNT_KOLOMMEN).eq('user_id', userId).order('gekoppeld_op');
  if (error) throw dbFout(error, 'accounts lezen');
  return (data ?? []) as AccountRij[];
}

export async function agendasVan(service: SupabaseClient, userId: string): Promise<AgendaRij[]> {
  const { data, error } = await service
    .from('google_agendas')
    .select(AGENDA_KOLOMMEN)
    .eq('user_id', userId)
    .order('volgorde')
    .order('naam');
  if (error) throw dbFout(error, "agenda's lezen");
  return ((data ?? []) as AgendaRij[]).map((r) => ({ ...r, toegang: toegangVan(r.toegang) }));
}

export function naarStatus(accounts: AccountRij[], agendas: AgendaRij[]): GoogleStatus {
  return {
    ingericht: ingericht(),
    tabellen: true,
    accounts: accounts.map(
      (a): GoogleAccount => ({
        id: a.id,
        email: a.google_email,
        fout: a.fout,
        agendas: agendas
          .filter((g) => g.account_id === a.id)
          .map(
            (g): GoogleAgenda => ({
              id: g.id,
              accountId: a.id,
              naam: g.naam,
              kleur: g.kleur,
              zichtbaar: g.zichtbaar,
              inFeed: g.in_feed,
              schrijfbaar: isSchrijfbaar(g.toegang),
              primair: g.primair
            })
          )
      })
    )
  };
}

/** Status voor de schermen; zonder migratie: tabellen=false (geen fout). */
export async function googleStatus(service: SupabaseClient, userId: string): Promise<GoogleStatus> {
  try {
    const [accounts, agendas] = await Promise.all([accountsVan(service, userId), agendasVan(service, userId)]);
    return naarStatus(accounts, agendas);
  } catch (e) {
    if (e instanceof GoogleAgendaFout && e.code === 'tabel_ontbreekt') return { ingericht: ingericht(), tabellen: false, accounts: [] };
    throw e;
  }
}

// ---------------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------------

export interface Verbinding {
  account: AccountRij;
  service: SupabaseClient;
}

/**
 * Eén aanroep naar de Calendar API. Bij een 401 één keer met een vers token. Fouten van
 * Google worden een GoogleAgendaFout met een korte reden (nooit tokens).
 */
export async function gApi<T>(v: Verbinding, pad: string, init: RequestInit = {}): Promise<T> {
  if (!ingericht()) throw new GoogleAgendaFout('niet_ingericht');
  let res: Response | null = null;
  for (const vers of [false, true]) {
    const token = await accessToken(v.account, vers, v.service);
    try {
      res = await fetch(`${CAL_URL}${pad}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        cache: 'no-store',
        signal: init.signal ?? AbortSignal.timeout(12_000)
      });
    } catch (e) {
      throw new GoogleAgendaFout('google', MELDING.google, `netwerk: ${(e as Error)?.message ?? ''}`);
    }
    if (res.status !== 401) break;
  }
  if (!res) throw new GoogleAgendaFout('google');
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } } & T;
  if (res.ok) return data;
  const reden = data.error?.errors?.[0]?.reason ?? '';
  const detail = `HTTP ${res.status} ${reden} ${data.error?.message ?? ''}`.trim();
  if (res.status === 401) throw new GoogleAgendaFout('opnieuw_koppelen', MELDING.opnieuw_koppelen, detail);
  if (res.status === 404 || res.status === 410) throw new GoogleAgendaFout('niet_gevonden', MELDING.niet_gevonden, detail);
  if (res.status === 403 && (reden === 'accessNotConfigured' || /has not been used|is disabled/i.test(data.error?.message ?? ''))) {
    throw new GoogleAgendaFout('api_uit', MELDING.api_uit, detail);
  }
  if (res.status === 403 && /forbidden|insufficientPermissions|requiredAccessLevel/i.test(reden)) {
    throw new GoogleAgendaFout('geen_recht', MELDING.geen_recht, detail);
  }
  if (res.status === 400) throw new GoogleAgendaFout('ongeldig', 'Google weigerde deze wijziging. Controleer de invoer.', detail);
  throw new GoogleAgendaFout('google', MELDING.google, detail);
}

export const kal = (googleId: string) => `/calendars/${encodeURIComponent(googleId)}`;

/** De agendalijst van één account (alle agenda's waar je minstens in mag kijken). */
export async function haalAgendaLijst(v: Verbinding): Promise<GAgendaItem[]> {
  const uit: GAgendaItem[] = [];
  let pagina: string | undefined;
  for (let i = 0; i < 5; i++) {
    const p = new URLSearchParams({
      minAccessRole: 'reader',
      maxResults: '250',
      fields: 'items(id,summary,summaryOverride,backgroundColor,accessRole,primary),nextPageToken'
    });
    if (pagina) p.set('pageToken', pagina);
    const d = await gApi<{ items?: GAgendaItem[]; nextPageToken?: string }>(v, `/users/me/calendarList?${p}`);
    uit.push(...(d.items ?? []).filter((x) => typeof x.id === 'string' && x.id.length <= 1024));
    pagina = d.nextPageToken;
    if (!pagina) break;
  }
  return uit;
}

/**
 * De agendalijst van Google overnemen: nieuwe agenda's toevoegen (met de standaard
 * instellingen), naam en rechten bijwerken, verdwenen agenda's weghalen. Kleur, tonen en
 * agenda-link blijven zoals je ze zelf zette.
 */
export async function synchroniseerLijst(v: Verbinding, opties: { feedInGoogle: boolean }): Promise<void> {
  const lijst = await haalAgendaLijst(v);
  const { data, error } = await v.service.from('google_agendas').select('id,google_id').eq('account_id', v.account.id);
  if (error) throw dbFout(error, "agenda's lezen");
  const bestaand = new Map(((data ?? []) as { id: string; google_id: string }[]).map((r) => [r.google_id, r.id]));
  // Hoofdagenda eerst, daarna je eigen agenda's, dan de rest (zoals in Google).
  const gesorteerd = [...lijst].sort(
    (a, b) => Number(b.primary === true) - Number(a.primary === true) || Number(b.accessRole === 'owner') - Number(a.accessRole === 'owner')
  );
  const rijen = gesorteerd.map((item, i) => {
    const basis = {
      account_id: v.account.id,
      user_id: v.account.user_id,
      google_id: item.id,
      naam: agendaNaam(item),
      toegang: toegangVan(item.accessRole),
      primair: item.primary === true,
      volgorde: i
    };
    if (bestaand.has(item.id)) return basis;
    const st = standaardInstellingen(item, opties.feedInGoogle);
    return { ...basis, kleur: normKleur(item.backgroundColor), zichtbaar: st.zichtbaar, in_feed: st.inFeed };
  });
  const nieuw = rijen.filter((r) => !bestaand.has(r.google_id));
  const oud = rijen.filter((r) => bestaand.has(r.google_id));
  if (nieuw.length) {
    const r = await v.service.from('google_agendas').insert(nieuw);
    if (r.error) throw dbFout(r.error, "agenda's opslaan");
  }
  for (const r of oud) {
    const u = await v.service.from('google_agendas').update(r).eq('id', bestaand.get(r.google_id)!);
    if (u.error) throw dbFout(u.error, 'agenda bijwerken');
  }
  const weg = [...bestaand.keys()].filter((g) => !lijst.some((x) => x.id === g));
  if (weg.length) {
    const d = await v.service.from('google_agendas').delete().eq('account_id', v.account.id).in('google_id', weg);
    if (d.error) throw dbFout(d.error, "agenda's opruimen");
  }
  const t = await v.service.from('google_agenda_accounts').update({ lijst_bijgewerkt_op: new Date().toISOString(), fout: null }).eq('id', v.account.id);
  if (t.error) throw dbFout(t.error, 'account bijwerken');
}

/** Account ontkoppelen: toestemming intrekken bij Google (best effort) en de rijen weg. */
export async function ontkoppel(service: SupabaseClient, userId: string, accountId: string): Promise<boolean> {
  const { data, error } = await service
    .from('google_agenda_accounts')
    .select(ACCOUNT_KOLOMMEN)
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw dbFout(error, 'account lezen');
  const rij = data as AccountRij | null;
  if (!rij) return false;
  const refresh = ontsleutelToken(rij.refresh_token_enc);
  if (refresh) await trekIn(fetch, refresh);
  tokens.delete(rij.refresh_token_enc);
  const d = await service.from('google_agenda_accounts').delete().eq('id', accountId).eq('user_id', userId);
  if (d.error) throw dbFout(d.error, 'account verwijderen');
  return true;
}

/** Of deze gebruiker de agenda-link in Google Agenda zelf heeft (dan geen Google-afspraken erin). */
export async function feedInGoogle(service: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await service.from('agenda_feeds').select('client').eq('user_id', userId).maybeSingle();
  if (error) return false;
  return (data as { client?: string | null } | null)?.client === 'google';
}
