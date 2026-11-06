import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { amsterdamNaarMoment, plusDagen, type Dag } from '@/lib/agenda/datum';
import { afspraakAlsInvoer, parseAfspraak } from '@/lib/agenda/invoer';
import type { Afspraak, AfspraakInvoer } from '@/lib/agenda/types';
import type { FeedAfspraak } from '@/lib/agenda/ics';
import { logFout } from '@/lib/log';
import {
  EVENT_VELDEN,
  googleBody,
  isImportAgenda,
  naarAfspraak,
  reeksTijden,
  splitsGoogleId,
  tijdenVan,
  type AgendaVoorWeergave,
  type GEvent
} from './kern';
import {
  GoogleAgendaFout,
  LIJST_VERVERS_MS,
  MELDING,
  accountsVan,
  agendasVan,
  feedInGoogle,
  gApi,
  kal,
  naarStatus,
  synchroniseerLijst,
  type AccountRij,
  type AgendaRij,
  type Verbinding
} from './koppeling';
import type { GoogleBereik } from './types';

// Afspraken uit Google Agenda lezen en schrijven, voor de agenda (/agenda), de afspraak-links
// en de agenda-link (ICS). Herhalende afspraken vraagt Google zelf uitgevouwen op
// (singleEvents): elk voorkomen heeft een eigen id en `recurringEventId` = de reeks. Zo kan
// "alleen deze" het voorkomen wijzigen of verwijderen en "hele reeks" de reeks.

const CACHE_MS = 30_000;
const cache = new Map<string, { t: number; events: GEvent[] }>();

function vergeet(agendaId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${agendaId}|`)) cache.delete(k);
}

function weergave(a: AgendaRij): AgendaVoorWeergave {
  return { id: a.id, naam: a.naam, kleur: a.kleur, toegang: a.toegang };
}

/** Alle afspraken van één agenda tussen twee momenten (max. 4 pagina's van 2500). */
async function lijstEvents(v: Verbinding, agenda: AgendaRij, van: string, tot: string, signal?: AbortSignal): Promise<GEvent[]> {
  const sleutel = `${agenda.id}|${van}|${tot}`;
  const c = cache.get(sleutel);
  if (c && Date.now() - c.t < CACHE_MS) return c.events;
  const uit: GEvent[] = [];
  let pagina: string | undefined;
  for (let i = 0; i < 4; i++) {
    const p = new URLSearchParams({
      timeMin: van,
      timeMax: tot,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      fields: `items(${EVENT_VELDEN}),nextPageToken`
    });
    if (pagina) p.set('pageToken', pagina);
    const d = await gApi<{ items?: GEvent[]; nextPageToken?: string }>(v, `${kal(agenda.google_id)}/events?${p}`, signal ? { signal } : {});
    uit.push(...(d.items ?? []));
    pagina = d.nextPageToken;
    if (!pagina) break;
  }
  cache.set(sleutel, { t: Date.now(), events: uit });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return uit;
}

/**
 * Afspraken van je zichtbare Google-agenda's die [van, tot] raken (Amsterdamse dagen), plus
 * de status (accounts en agenda's) voor de schakelaars. Een account dat niet werkt
 * (verlopen toegang, Google onbereikbaar) staat in `fouten`; de rest laadt gewoon.
 */
export async function googleBereik(service: SupabaseClient, userId: string, van: Dag, tot: Dag): Promise<GoogleBereik & { verouderd: AccountRij[] }> {
  const [accounts, agendas] = await Promise.all([accountsVan(service, userId), agendasVan(service, userId)]);
  const status = naarStatus(accounts, agendas);
  const begin = amsterdamNaarMoment(van).toISOString();
  const eind = amsterdamNaarMoment(plusDagen(tot, 1)).toISOString();
  const fouten: GoogleBereik['fouten'] = [];
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
      const res = await Promise.allSettled(eigen.map((a) => lijstEvents(v, a, begin, eind).then((l) => ({ a, l }))));
      let gemeld = false;
      for (const r of res) {
        if (r.status === 'fulfilled') {
          for (const ev of r.value.l) {
            const af = naarAfspraak(ev, weergave(r.value.a));
            if (af) events.push(af);
          }
        } else if (!gemeld) {
          gemeld = true;
          const e = r.reason;
          if (!(e instanceof GoogleAgendaFout) || e.code === 'google') logFout('[google-agenda] afspraken ophalen', e instanceof GoogleAgendaFout ? `${e.code} ${e.detail}` : e);
          fouten.push({ accountId: account.id, melding: e instanceof GoogleAgendaFout ? e.message : MELDING.google });
          if (e instanceof GoogleAgendaFout && e.code === 'opnieuw_koppelen') {
            const acc = status.accounts.find((x) => x.id === account.id);
            if (acc) acc.fout = 'opnieuw_koppelen';
          }
        }
      }
    })
  );

  const verouderd = accounts.filter(
    (a) => a.fout !== 'opnieuw_koppelen' && (!a.lijst_bijgewerkt_op || Date.now() - Date.parse(a.lijst_bijgewerkt_op) > LIJST_VERVERS_MS)
  );
  return { status, events, fouten, verouderd };
}

/** De agendalijsten die lang niet zijn ververst opnieuw ophalen (na het antwoord, best effort). */
export async function verversLijsten(service: SupabaseClient, userId: string, accounts: AccountRij[]): Promise<void> {
  if (!accounts.length) return;
  const inGoogle = await feedInGoogle(service, userId);
  for (const account of accounts) {
    try {
      await synchroniseerLijst({ account, service }, { feedInGoogle: inGoogle });
    } catch (e) {
      if (!(e instanceof GoogleAgendaFout) || e.code === 'google') logFout('[google-agenda] agendalijst verversen', e);
    }
  }
}

// ---------------------------------------------------------------------------------
// Eén afspraak
// ---------------------------------------------------------------------------------

async function vindAgenda(service: SupabaseClient, userId: string, agendaId: string): Promise<{ agenda: AgendaRij; v: Verbinding }> {
  const agendas = await agendasVan(service, userId);
  const agenda = agendas.find((a) => a.id === agendaId);
  if (!agenda) throw new GoogleAgendaFout('niet_gevonden', 'Deze Google-agenda is niet (meer) gekoppeld.');
  const account = (await accountsVan(service, userId)).find((a) => a.id === agenda.account_id);
  if (!account) throw new GoogleAgendaFout('niet_gevonden', 'Deze Google-agenda is niet (meer) gekoppeld.');
  return { agenda, v: { account, service } };
}

async function haalEvent(v: Verbinding, agenda: AgendaRij, eventId: string): Promise<GEvent> {
  return gApi<GEvent>(v, `${kal(agenda.google_id)}/events/${encodeURIComponent(eventId)}?fields=${encodeURIComponent(EVENT_VELDEN)}`);
}

function ontleed(id: string) {
  const d = splitsGoogleId(id);
  if (!d) throw new GoogleAgendaFout('niet_gevonden');
  return d;
}

export async function googleAfspraak(service: SupabaseClient, userId: string, id: string): Promise<Afspraak> {
  const { agendaId, eventId } = ontleed(id);
  const { agenda, v } = await vindAgenda(service, userId, agendaId);
  const af = naarAfspraak(await haalEvent(v, agenda, eventId), weergave(agenda));
  if (!af) throw new GoogleAgendaFout('niet_gevonden');
  return af;
}

/** Gasten (behalve jij) krijgen een mail van Google bij een wijziging, zoals in Google Agenda zelf. */
function verstuur(ev: GEvent | null): string {
  return ev?.attendees?.some((a) => !a.self && !a.resource) ? 'all' : 'none';
}

function invoerFout(fout: string): GoogleAgendaFout {
  return new GoogleAgendaFout('ongeldig', fout);
}

export async function maakGoogleAfspraak(service: SupabaseClient, userId: string, agendaId: string, body: AfspraakInvoer): Promise<Afspraak> {
  const { agenda, v } = await vindAgenda(service, userId, agendaId);
  if (agenda.toegang !== 'owner' && agenda.toegang !== 'writer') throw new GoogleAgendaFout('geen_recht', 'In deze Google-agenda kun je geen afspraken maken.');
  const p = parseAfspraak(body, null);
  if (!p.ok) throw invoerFout(p.fout);
  const b = googleBody(p.waarde, { metTijd: true, meet: body.meet === true, requestId: randomUUID() });
  const ev = await gApi<GEvent>(v, `${kal(agenda.google_id)}/events?conferenceDataVersion=1&fields=${encodeURIComponent(EVENT_VELDEN)}`, {
    method: 'POST',
    body: JSON.stringify(b)
  });
  vergeet(agenda.id);
  const af = naarAfspraak(ev, weergave(agenda));
  if (!af) throw new GoogleAgendaFout('google');
  return af;
}

/**
 * Een afspraak in Google wijzigen. Bij een voorkomen van een reeks: 'deze' wijzigt alleen
 * dat voorkomen, anders de hele reeks (tijden schuiven dan net zo mee als bij dit voorkomen).
 * De herhaalregel van een bestaande reeks blijft zoals hij in Google staat.
 */
export async function wijzigGoogleAfspraak(service: SupabaseClient, userId: string, id: string, body: AfspraakInvoer): Promise<Afspraak> {
  const { agendaId, eventId } = ontleed(id);
  const { agenda, v } = await vindAgenda(service, userId, agendaId);
  const ev = await haalEvent(v, agenda, eventId);
  const huidig = naarAfspraak(ev, weergave(agenda));
  if (!huidig) throw new GoogleAgendaFout('niet_gevonden');
  if (!huidig.google?.schrijfbaar) throw new GoogleAgendaFout('geen_recht');

  const invoer: AfspraakInvoer = { ...body };
  delete invoer.klantId;
  delete invoer.deelnemers;
  // Wat niet veranderd is niet terugschrijven: een beschrijving in Google is vaak opgemaakt
  // (HTML) en die opmaak blijft zo staan; een lege titel blijft leeg.
  if (invoer.titel === huidig.titel) delete invoer.titel;
  if (invoer.notitie === huidig.notitie) delete invoer.notitie;
  if (invoer.locatie === huidig.locatie) delete invoer.locatie;
  if (huidig.google.herhaalt) {
    delete invoer.herhaling;
    delete invoer.herhaalTot;
  }
  const p = parseAfspraak(invoer, afspraakAlsInvoer({ starts_at: huidig.start, ends_at: huidig.eind, all_day: huidig.heleDag }));
  if (!p.ok) throw invoerFout(p.fout);
  const rij = p.waarde;
  const metTijd =
    rij.starts_at !== undefined &&
    (Date.parse(rij.starts_at) !== Date.parse(huidig.start) || Date.parse(rij.ends_at!) !== Date.parse(huidig.eind) || rij.all_day !== huidig.heleDag);
  const meet = body.meet === true && !huidig.google.meetLink;

  const reeks = huidig.reeksId && body.toepassen !== 'deze' ? huidig.reeksId : null;
  let doelId = eventId;
  let b: Record<string, unknown>;
  if (reeks) {
    doelId = reeks;
    b = googleBody(rij, { metTijd: false, meet, requestId: randomUUID() });
    if (metTijd) {
      const hoofd = tijdenVan(await haalEvent(v, agenda, reeks));
      if (!hoofd) throw new GoogleAgendaFout('google');
      const t = reeksTijden(hoofd, { start: huidig.start, heleDag: huidig.heleDag }, { start: rij.starts_at!, eind: rij.ends_at!, heleDag: rij.all_day === true });
      Object.assign(b, googleBody({ starts_at: t.start, ends_at: t.eind, all_day: rij.all_day }, { metTijd: true }));
    }
  } else {
    b = googleBody(rij, { metTijd, meet, requestId: randomUUID() });
  }
  if (!Object.keys(b).length) return huidig;

  const uit = await gApi<GEvent>(
    v,
    `${kal(agenda.google_id)}/events/${encodeURIComponent(doelId)}?conferenceDataVersion=1&sendUpdates=${verstuur(ev)}&fields=${encodeURIComponent(EVENT_VELDEN)}`,
    { method: 'PATCH', body: JSON.stringify(b) }
  );
  vergeet(agenda.id);
  return naarAfspraak(uit, weergave(agenda)) ?? huidig;
}

/** Verwijderen: 'deze' = alleen dit voorkomen, anders (bij een reeks) de hele reeks. */
export async function verwijderGoogleAfspraak(service: SupabaseClient, userId: string, id: string, toepassen: 'deze' | 'reeks' | null): Promise<void> {
  const { agendaId, eventId } = ontleed(id);
  const { agenda, v } = await vindAgenda(service, userId, agendaId);
  let ev: GEvent;
  try {
    ev = await haalEvent(v, agenda, eventId);
  } catch (e) {
    // Al weg in Google: dan is het goed.
    if (e instanceof GoogleAgendaFout && e.code === 'niet_gevonden') {
      vergeet(agenda.id);
      return;
    }
    throw e;
  }
  const huidig = naarAfspraak(ev, weergave(agenda));
  if (huidig && !huidig.google?.verwijderbaar) throw new GoogleAgendaFout('geen_recht', 'Deze afspraak kun je in Google niet verwijderen.');
  const doel = ev.recurringEventId && toepassen !== 'deze' ? ev.recurringEventId : eventId;
  try {
    await gApi<void>(v, `${kal(agenda.google_id)}/events/${encodeURIComponent(doel)}?sendUpdates=${verstuur(ev)}`, { method: 'DELETE' });
  } catch (e) {
    if (!(e instanceof GoogleAgendaFout && e.code === 'niet_gevonden')) throw e;
  }
  vergeet(agenda.id);
}

// ---------------------------------------------------------------------------------
// Agenda-link (ICS)
// ---------------------------------------------------------------------------------

/**
 * Afspraken voor de agenda-link: de agenda's met "ook in de agenda-link" aan, van 30 dagen
 * terug tot een jaar vooruit. Best effort: wat niet binnen enkele seconden lukt, laten we weg
 * (de link moet altijd werken). Nooit een via een link geïmporteerde agenda (kringloop).
 */
export async function googleVoorFeed(service: SupabaseClient, userId: string, nu = new Date()): Promise<FeedAfspraak[]> {
  let accounts: AccountRij[];
  let agendas: AgendaRij[];
  try {
    [accounts, agendas] = await Promise.all([accountsVan(service, userId), agendasVan(service, userId)]);
  } catch {
    return [];
  }
  const inFeed = agendas.filter((a) => a.in_feed && !isImportAgenda(a.google_id));
  if (!inFeed.length) return [];
  const van = new Date(nu.getTime() - 30 * 86_400_000).toISOString();
  const tot = new Date(nu.getTime() + 365 * 86_400_000).toISOString();
  const signal = AbortSignal.timeout(8_000);
  const uit: FeedAfspraak[] = [];
  await Promise.all(
    inFeed.map(async (agenda) => {
      const account = accounts.find((a) => a.id === agenda.account_id);
      if (!account || account.fout === 'opnieuw_koppelen') return;
      try {
        const events = await lijstEvents({ account, service }, agenda, van, tot, signal);
        for (const ev of events) {
          const a = naarAfspraak(ev, weergave(agenda));
          if (!a || !a.google) continue;
          const extra = [a.google.meetLink ? `${a.google.vergaderDienst ?? 'Videogesprek'}: ${a.google.meetLink}` : '', a.notitie].filter(Boolean).join('\n\n');
          uit.push({
            id: a.id,
            uid: `google-${agenda.id}-${a.google.eventId}`,
            titel: a.titel,
            notitie: extra,
            locatie: a.locatie || a.google.meetLink || '',
            start: a.start,
            eind: a.eind,
            heleDag: a.heleDag,
            categorie: agenda.naam,
            link: a.google.link
          });
        }
      } catch (e) {
        if (!(e instanceof GoogleAgendaFout) || e.code === 'google') logFout('[google-agenda] agenda-link', e instanceof GoogleAgendaFout ? `${e.code} ${e.detail}` : e);
      }
    })
  );
  return uit;
}

// ---------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------

/**
 * De dashboardplanning (vandaag + 6 dagen) aangevuld met je zichtbare Google-afspraken.
 * Best effort en kort: duurt Google langer dan 2,5 s of gaat er iets mis, dan alleen de
 * eigen afspraken (het dashboard mag nooit op Google wachten).
 */
export async function metGoogleAfspraken(service: SupabaseClient, userId: string, vandaag: Dag, eigen: Afspraak[]): Promise<Afspraak[]> {
  const google = await Promise.race([
    googleBereik(service, userId, vandaag, plusDagen(vandaag, 6)).then((r) => r.events),
    new Promise<Afspraak[]>((klaar) => setTimeout(() => klaar([]), 2_500).unref?.())
  ]).catch(() => [] as Afspraak[]);
  if (!google.length) return eigen;
  return [...eigen, ...google].sort((a, b) => a.start.localeCompare(b.start));
}
