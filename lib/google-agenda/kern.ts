// De kern van de Google Agenda-koppeling: alles zonder env, database of '@/'-imports, zodat
// scripts/test-google-agenda.mjs het los kan testen.
//   - OAuth: de autorisatie-URL met de agenda-scopes;
//   - kleuren (de palette van Google Agenda) en de standaardinstellingen van een nieuwe agenda;
//   - id's: een afspraak uit Google heet in de app "g.<agenda-rij-id>.<event-id>";
//   - een Google-event omzetten naar een Afspraak (tijden, hele dag, Meet-link, gasten,
//     beschrijving als platte tekst) en terug: de body voor insert/patch uit gevalideerde invoer.
// De server-kant (tokens, database, REST-aanroepen) staat in lib/google-agenda/koppeling.ts.

import { amsterdamNaarMoment, dagenTussen, inAmsterdam, isDag, plusDagen, TZ, type Dag } from '../agenda/datum';
import { rrule, type Herhaling } from '../agenda/herhaling';
import type { AfspraakRij } from '../agenda/invoer';
import type { Afspraak, GoogleGast } from '../agenda/types';

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const CAL_URL = 'https://www.googleapis.com/calendar/v3';
export const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/**
 * Lezen welke agenda's er zijn (agendalijst) en afspraken lezen/schrijven. Bewust niet de
 * volledige `calendar`-scope: agenda's aanmaken, delen of verwijderen hoeft niet.
 */
export const SCOPE_LIJST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
export const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
export const SCOPES = ['openid', 'email', SCOPE_LIJST, SCOPE_EVENTS];

export function autorisatieUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const p = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // Altijd een refresh token (ook bij een tweede keer koppelen) en altijd het account kiezen,
    // zodat je ook een tweede Google-account kunt toevoegen.
    prompt: 'consent select_account',
    include_granted_scopes: 'false',
    state: o.state
  });
  return `${AUTH_URL}?${p.toString()}`;
}

/** Of de gegeven toestemming genoeg is (beide agenda-scopes). */
export function heeftScopes(scope: string): boolean {
  const s = new Set(scope.split(/\s+/));
  return s.has(SCOPE_LIJST) && s.has(SCOPE_EVENTS);
}

// ---------------------------------------------------------------------------------
// Kleuren
// ---------------------------------------------------------------------------------

/** De kleuren van Google Agenda (zoals in de app), plus het zand van Studio Levant. */
export const KLEUREN: { kleur: string; naam: string }[] = [
  { kleur: '#d50000', naam: 'Tomaat' },
  { kleur: '#e67c73', naam: 'Flamingo' },
  { kleur: '#f4511e', naam: 'Mandarijn' },
  { kleur: '#f6bf26', naam: 'Banaan' },
  { kleur: '#33b679', naam: 'Salie' },
  { kleur: '#0b8043', naam: 'Basilicum' },
  { kleur: '#039be5', naam: 'Pauw' },
  { kleur: '#3f51b5', naam: 'Bosbes' },
  { kleur: '#7986cb', naam: 'Lavendel' },
  { kleur: '#8e24aa', naam: 'Druif' },
  { kleur: '#616161', naam: 'Grafiet' },
  { kleur: '#c8a97e', naam: 'Zand' }
];

/** Kleur van een afspraak met een eigen kleur in Google (colorId 1–11). */
export const EVENT_KLEUR: Record<string, string> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6bf26',
  '6': '#f4511e',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000'
};

export const STANDAARD_KLEUR = '#039be5';

export function isKleur(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v);
}

/** Een kleur uit Google ("#9FE1E7") als "#9fe1e7", of de standaard. */
export function normKleur(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return isKleur(s) ? s : STANDAARD_KLEUR;
}

// ---------------------------------------------------------------------------------
// Agendalijst
// ---------------------------------------------------------------------------------

export type Toegang = 'owner' | 'writer' | 'reader' | 'freeBusyReader';

export interface GAgendaItem {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
}

export function toegangVan(v: unknown): Toegang {
  return v === 'owner' || v === 'writer' || v === 'freeBusyReader' ? v : 'reader';
}

export const isSchrijfbaar = (t: Toegang) => t === 'owner' || t === 'writer';

/**
 * Een agenda die je via een link (ICS) in Google hebt toegevoegd. Dat kan de agenda-link
 * van Studio Levant zelf zijn (/agenda-koppelen): die tonen we niet (dubbel) en sturen we
 * nooit terug in de agenda-link (een kringloop).
 */
export function isImportAgenda(googleId: string): boolean {
  return /@import\.calendar\.google\.com$/i.test(googleId);
}

/**
 * Standaard bij een nieuw gekoppelde agenda: je eigen agenda's (hoofdagenda en agenda's
 * waarvan je eigenaar bent) tonen; feestdagen, verjaardagen, gedeelde en geabonneerde niet
 * (die zet je zelf aan). In de agenda-link (Apple Agenda) alleen wat getoond wordt, behalve
 * als je die link in Google Agenda zelf hebt staan: dan staat het er al.
 */
export function standaardInstellingen(item: GAgendaItem, feedInGoogle: boolean): { zichtbaar: boolean; inFeed: boolean } {
  const eigen = item.primary === true || (toegangVan(item.accessRole) === 'owner' && !/#|@group\.v\.calendar\.google\.com$/.test(item.id));
  const zichtbaar = eigen && !isImportAgenda(item.id);
  return { zichtbaar, inFeed: zichtbaar && !feedInGoogle };
}

export function agendaNaam(item: GAgendaItem): string {
  return (item.summaryOverride || item.summary || item.id).trim().slice(0, 200) || 'Agenda';
}

// ---------------------------------------------------------------------------------
// Id's
// ---------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID = /^[A-Za-z0-9_@.-]{1,1024}$/;

export function googleAfspraakId(agendaId: string, eventId: string): string {
  return `g.${agendaId}.${eventId}`;
}

export function isGoogleAfspraakId(s: unknown): s is string {
  return splitsGoogleId(s) !== null;
}

/** "g.<agenda-rij-id>.<event-id>" → de delen, of null. */
export function splitsGoogleId(s: unknown): { agendaId: string; eventId: string } | null {
  if (typeof s !== 'string' || !s.startsWith('g.')) return null;
  const agendaId = s.slice(2, 38);
  const eventId = s.slice(39);
  if (!UUID.test(agendaId) || s[38] !== '.' || !EVENT_ID.test(eventId)) return null;
  return { agendaId, eventId };
}

// ---------------------------------------------------------------------------------
// Google-event → Afspraak
// ---------------------------------------------------------------------------------

export interface GTijd {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GTijd;
  end?: GTijd;
  recurringEventId?: string;
  originalStartTime?: GTijd;
  recurrence?: string[];
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
    conferenceSolution?: { name?: string; key?: { type?: string } };
  };
  htmlLink?: string;
  colorId?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  creator?: { email?: string; self?: boolean };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean; resource?: boolean }[];
  guestsCanModify?: boolean;
  eventType?: string;
}

/** De velden die we bij Google opvragen (scheelt veel bytes). */
export const EVENT_VELDEN =
  'id,status,summary,description,location,start,end,recurringEventId,originalStartTime,recurrence,hangoutLink,' +
  'conferenceData(entryPoints(entryPointType,uri),conferenceSolution(name,key)),htmlLink,colorId,organizer,creator,' +
  'attendees(email,displayName,responseStatus,self,resource),guestsCanModify,eventType';

const ENTITEITEN: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/**
 * Een beschrijving uit Google (vaak HTML: <br>, <a>, <b>, <ul>) als platte tekst, met
 * regeleinden en links als "tekst (url)". De app toont en bewerkt platte tekst.
 */
export function htmlNaarTekst(html: string | undefined | null): string {
  const s = String(html ?? '');
  if (!/<[a-z!/][^>]*>|&[a-z#0-9]+;/i.test(s)) return s.trim();
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, tekst: string) => {
      const t = tekst.replace(/<[^>]+>/g, '').trim();
      return t && t !== href && !href.startsWith('mailto:') ? `${t} (${href})` : t || href;
    })
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n• ')
    .replace(/<\/\s*(p|div|ul|ol|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16) || 32);
      if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)) || 32);
      return ENTITEITEN[k] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Alleen http(s)-links doorlaten (een link uit Google komt zo in een href). */
export function veiligeLink(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function meetLinkVan(ev: GEvent): { link: string | null; dienst: string | null } {
  const video = ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  const link = veiligeLink(video?.uri) ?? veiligeLink(ev.hangoutLink);
  if (!link) return { link: null, dienst: null };
  const naam = ev.conferenceData?.conferenceSolution?.name?.trim();
  return { link, dienst: naam || (/meet\.google\.com/.test(link) ? 'Google Meet' : 'Videogesprek') };
}

/** Begin en eind als ISO-momenten; een hele dag als 00:00 Amsterdam t/m 00:00 na de laatste dag. */
export function tijdenVan(ev: GEvent): { start: string; eind: string; heleDag: boolean } | null {
  const s = ev.start;
  const e = ev.end;
  if (!s) return null;
  if (s.date && isDag(s.date)) {
    const eindDag = e?.date && isDag(e.date) && dagenTussen(s.date, e.date) > 0 ? e.date : plusDagen(s.date, 1);
    return { start: amsterdamNaarMoment(s.date).toISOString(), eind: amsterdamNaarMoment(eindDag).toISOString(), heleDag: true };
  }
  const start = s.dateTime ? Date.parse(s.dateTime) : NaN;
  if (Number.isNaN(start)) return null;
  let eind = e?.dateTime ? Date.parse(e.dateTime) : NaN;
  if (Number.isNaN(eind) || eind < start) eind = start;
  return { start: new Date(start).toISOString(), eind: new Date(eind).toISOString(), heleDag: false };
}

const GAST_STATUS = new Set(['accepted', 'declined', 'tentative', 'needsAction']);

export interface AgendaVoorWeergave {
  id: string;
  naam: string;
  kleur: string;
  toegang: Toegang;
}

/**
 * Een Google-event als Afspraak, of null als we hem niet tonen: geannuleerd, afgeslagen
 * (door jou), "werklocatie" (geen afspraak), of zonder geldige tijd.
 */
export function naarAfspraak(ev: GEvent, agenda: AgendaVoorWeergave): Afspraak | null {
  if (!ev || typeof ev.id !== 'string' || !EVENT_ID.test(ev.id)) return null;
  if (ev.status === 'cancelled' || ev.eventType === 'workingLocation') return null;
  const ik = ev.attendees?.find((a) => a.self);
  if (ik?.responseStatus === 'declined') return null;
  const t = tijdenVan(ev);
  if (!t) return null;

  const meet = meetLinkVan(ev);
  const kalSchrijf = isSchrijfbaar(agenda.toegang);
  // Zonder organisator, of de agenda zelf organiseert: dan mag je alles. Als gast alleen als
  // de organisator gasten laat wijzigen.
  const organiseer = !ev.organizer || ev.organizer.self === true;
  const gasten: GoogleGast[] = (ev.attendees ?? [])
    .filter((a) => a.email && !a.resource)
    .slice(0, 100)
    .map((a) => ({
      email: String(a.email).slice(0, 320),
      naam: String(a.displayName ?? '').slice(0, 200),
      status: (GAST_STATUS.has(a.responseStatus ?? '') ? a.responseStatus : 'needsAction') as GoogleGast['status'],
      ik: a.self === true
    }));
  const reeks = typeof ev.recurringEventId === 'string' && EVENT_ID.test(ev.recurringEventId) ? ev.recurringEventId : null;
  const oorspronkelijk = reeks && ev.originalStartTime ? tijdenVan({ id: ev.id, start: ev.originalStartTime }) : null;

  return {
    id: googleAfspraakId(agenda.id, ev.id),
    titel: (ev.summary ?? '').trim().slice(0, 300) || '(Geen titel)',
    notitie: htmlNaarTekst(ev.description).slice(0, 10000),
    locatie: (ev.location ?? '').trim().slice(0, 300),
    start: t.start,
    eind: t.eind,
    heleDag: t.heleDag,
    klantId: null,
    klantNaam: null,
    deelnemers: [],
    aangemaaktDoor: null,
    herhaling: null,
    herhaalTot: null,
    reeksId: reeks,
    voorkomen: oorspronkelijk ? inAmsterdam(oorspronkelijk.start).dag : null,
    google: {
      agendaId: agenda.id,
      agendaNaam: agenda.naam,
      kleur: (ev.colorId && EVENT_KLEUR[ev.colorId]) || agenda.kleur,
      eventId: ev.id,
      herhaalt: reeks !== null || (ev.recurrence?.length ?? 0) > 0,
      meetLink: meet.link,
      vergaderDienst: meet.dienst,
      link: veiligeLink(ev.htmlLink),
      organisator: organiseer ? null : (ev.organizer?.displayName || ev.organizer?.email || '').slice(0, 320) || null,
      gasten,
      schrijfbaar: kalSchrijf && (organiseer || ev.guestsCanModify === true),
      verwijderbaar: kalSchrijf
    }
  };
}

// ---------------------------------------------------------------------------------
// Invoer → Google-body
// ---------------------------------------------------------------------------------

/** Begin of eind voor Google: een datum bij een hele dag, anders het moment in Amsterdam. */
function gTijd(moment: string, heleDag: boolean): GTijd {
  if (heleDag) return { date: inAmsterdam(moment).dag };
  return { dateTime: moment, timeZone: TZ };
}

/** RRULE voor Google: UNTIL als datum (hele dag) of als het einde van die dag in UTC. */
export function googleRecurrence(h: Herhaling, eersteDag: Dag, tot: Dag | null, heleDag: boolean): string[] {
  const until = tot
    ? heleDag
      ? tot.replace(/-/g, '')
      : new Date(amsterdamNaarMoment(plusDagen(tot, 1)).getTime() - 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    : null;
  return [`RRULE:${rrule(h, eersteDag, until)}`];
}

/**
 * De body voor events.insert/patch uit gevalideerde invoer (lib/agenda/invoer.ts
 * parseAfspraak). Alleen wat in `rij` staat gaat mee; tijden alleen als `metTijd`.
 */
export function googleBody(rij: AfspraakRij, o: { metTijd: boolean; meet?: boolean; requestId?: string }): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (rij.title !== undefined) b.summary = rij.title;
  if (rij.notes !== undefined) b.description = rij.notes;
  if (rij.location !== undefined) b.location = rij.location;
  if (o.metTijd && rij.starts_at && rij.ends_at) {
    const heleDag = rij.all_day === true;
    b.start = gTijd(rij.starts_at, heleDag);
    b.end = gTijd(rij.ends_at, heleDag);
    // Een hele dag eindigt bij Google op de dag ná de laatste (exclusief), net als bij ons.
    if (heleDag) b.end = { date: inAmsterdam(rij.ends_at).dag };
  }
  if ('herhaling' in rij) {
    const h = rij.herhaling ?? null;
    b.recurrence = h && rij.starts_at ? googleRecurrence(h, inAmsterdam(rij.starts_at).dag, rij.herhaal_tot ?? null, rij.all_day === true) : [];
  }
  if (o.meet && o.requestId) {
    b.conferenceData = { createRequest: { requestId: o.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  return b;
}

/**
 * Een wijziging van één voorkomen doorvoeren op de hele reeks: dezelfde verschuiving in
 * dagen en dezelfde nieuwe wandkloktijden, vanaf het begin van de reeks.
 */
export function reeksTijden(
  reeks: { start: string; eind: string; heleDag: boolean },
  voorkomenOud: { start: string; heleDag: boolean },
  nieuw: { start: string; eind: string; heleDag: boolean }
): { start: string; eind: string } {
  const verschuiving = dagenTussen(inAmsterdam(voorkomenOud.start).dag, inAmsterdam(nieuw.start).dag);
  const eersteDag = plusDagen(inAmsterdam(reeks.start).dag, verschuiving);
  const s = inAmsterdam(nieuw.start);
  const e = inAmsterdam(nieuw.eind);
  const dagen = dagenTussen(s.dag, e.dag);
  const start = amsterdamNaarMoment(eersteDag, nieuw.heleDag ? '00:00' : s.tijd);
  let eind = amsterdamNaarMoment(plusDagen(eersteDag, dagen), nieuw.heleDag ? '00:00' : e.tijd);
  if (eind.getTime() <= start.getTime()) eind = new Date(start.getTime() + (Date.parse(nieuw.eind) - Date.parse(nieuw.start)));
  return { start: start.toISOString(), eind: eind.toISOString() };
}
