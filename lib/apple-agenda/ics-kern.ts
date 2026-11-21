// Afspraken in iCalendar-vorm (de .ics-bestanden in iCloud) lezen en schrijven, met ical.js.
// Zonder env, database of '@/'-imports, zodat scripts/test-apple-agenda.mjs het los kan testen.
//
//   - lezen: één .ics-bestand → de afspraken die een bereik raken, herhalingen uitgevouwen
//     (met uitzonderingen: EXDATE en losse voorkomens met RECURRENCE-ID), tijdzones uit de
//     VTIMEZONE in het bestand;
//   - schrijven: een nieuwe afspraak, een wijziging (eenmalig, één voorkomen of de hele reeks)
//     en één voorkomen verwijderen (EXDATE). De rest van het bestand (alarmen, gasten,
//     eigen velden van Apple) blijft zoals het was.

import ICAL from 'ical.js';
import { amsterdamNaarMoment, dagenTussen, inAmsterdam, plusDagen, TZ, type Dag } from '../agenda/datum';
import { rrule } from '../agenda/herhaling';
import type { AfspraakRij } from '../agenda/invoer';
import type { Afspraak, ExternGast } from '../agenda/types';
import { vindVergaderlink } from '../agenda/vergaderlink';
import { appleAfspraakId } from './id-kern';

/** Europe/Amsterdam als VTIMEZONE (zoals Apple hem zelf schrijft). */
const VTIMEZONE_AMSTERDAM = `BEGIN:VTIMEZONE
TZID:Europe/Amsterdam
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
DTSTART:19810329T020000
TZNAME:CEST
TZOFFSETTO:+0200
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
DTSTART:19961027T030000
TZNAME:CET
TZOFFSETTO:+0100
END:STANDARD
END:VTIMEZONE`;

const PRODID = '-//CRM//Agenda//NL';
const MAX_VOORKOMENS = 5000;

function amsterdamZone(): ICAL.Timezone {
  if (!ICAL.TimezoneService.has(TZ)) {
    const comp = new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\n${VTIMEZONE_AMSTERDAM}\r\nEND:VCALENDAR`));
    ICAL.TimezoneService.register(new ICAL.Timezone(comp.getFirstSubcomponent('vtimezone')!));
  }
  return ICAL.TimezoneService.get(TZ)!;
}

function leesKalender(ics: string): ICAL.Component | null {
  try {
    const comp = new ICAL.Component(ICAL.parse(ics));
    if (comp.name !== 'vcalendar') return null;
    for (const tz of comp.getAllSubcomponents('vtimezone')) {
      const id = tz.getFirstPropertyValue('tzid');
      if (typeof id === 'string' && id && !ICAL.TimezoneService.has(id)) {
        try {
          ICAL.TimezoneService.register(new ICAL.Timezone(tz));
        } catch {
          /* onbruikbare tijdzone: dan als Amsterdamse wandkloktijd */
        }
      }
    }
    return comp;
  } catch {
    return null;
  }
}

const isZwevend = (t: ICAL.Time) => !t.zone || t.zone.tzid === 'floating' || (t.zone.tzid !== 'UTC' && !ICAL.TimezoneService.has(t.zone.tzid));

/** Een ICAL-tijd als moment. Een datum = 00:00 in Amsterdam; zonder (bekende) zone ook Amsterdam. */
function moment(t: ICAL.Time): Date {
  const dag = `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  if (t.isDate) return amsterdamNaarMoment(dag);
  if (isZwevend(t)) return amsterdamNaarMoment(dag, `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`);
  return t.toJSDate();
}

/** De code van een voorkomen in een id: 20261121 (datum) of 20261121T090000Z. */
export function voorkomenCode(t: ICAL.Time): string {
  if (t.isDate) return `${String(t.year).padStart(4, '0')}${String(t.month).padStart(2, '0')}${String(t.day).padStart(2, '0')}`;
  return moment(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export interface AppleAgendaVoorWeergave {
  id: string;
  naam: string;
  kleur: string;
  schrijfbaar: boolean;
  /** Het Apple ID (e-mail) van het account: om "jij" bij gasten en de organisator te herkennen. */
  email: string;
}

const PARTSTAT: Record<string, ExternGast['status']> = {
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
  'NEEDS-ACTION': 'needsAction'
};

const mailVan = (v: unknown) => (typeof v === 'string' ? v.replace(/^mailto:/i, '').trim().toLowerCase() : '');

function tekst(comp: ICAL.Component, naam: string, max: number): string {
  const v = comp.getFirstPropertyValue(naam);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

interface Basis {
  gasten: ExternGast[];
  organisator: string | null;
  ikAfgeslagen: boolean;
}

function gastenVan(comp: ICAL.Component, ikEmail: string): Basis {
  const ik = ikEmail.toLowerCase();
  const gasten: ExternGast[] = comp
    .getAllProperties('attendee')
    .slice(0, 100)
    .map((p) => {
      const email = mailVan(p.getFirstValue()).slice(0, 320);
      const ps = String(p.getParameter('partstat') ?? 'NEEDS-ACTION').toUpperCase();
      return {
        email,
        naam: String(p.getParameter('cn') ?? '').slice(0, 200),
        status: PARTSTAT[ps] ?? 'needsAction',
        ik: !!email && email === ik
      };
    })
    .filter((g) => g.email);
  const org = comp.getFirstProperty('organizer');
  const orgMail = org ? mailVan(org.getFirstValue()) : '';
  // Alleen een "andere organisator" als er gasten zijn en de organisator niet jij bent.
  const anders = !!org && gasten.length > 0 && orgMail !== ik && !gasten.some((g) => g.ik && g.email === orgMail);
  return {
    gasten,
    organisator: anders ? (String(org!.getParameter('cn') ?? '') || orgMail).slice(0, 320) || null : null,
    ikAfgeslagen: gasten.some((g) => g.ik && g.status === 'declined')
  };
}

function alsAfspraak(
  comp: ICAL.Component,
  start: ICAL.Time,
  eind: ICAL.Time | null,
  agenda: AppleAgendaVoorWeergave,
  bestand: string,
  reeks: { voorkomen: ICAL.Time } | null,
  herhaalt: boolean
): Afspraak | null {
  if (String(comp.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return null;
  const b = gastenVan(comp, agenda.email);
  if (b.ikAfgeslagen) return null;
  const heleDag = start.isDate;
  const s = moment(start);
  let e = eind ? moment(eind) : null;
  if (!e || e.getTime() <= s.getTime()) e = heleDag ? amsterdamNaarMoment(plusDagen(inAmsterdam(s).dag, 1)) : new Date(s.getTime() + 15 * 60_000);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;

  const locatie = tekst(comp, 'location', 300);
  const notitie = tekst(comp, 'description', 10000);
  const url = tekst(comp, 'url', 2000);
  const meet = vindVergaderlink(url, locatie, notitie);
  const basisId = appleAfspraakId(agenda.id, bestand);
  const code = reeks ? voorkomenCode(reeks.voorkomen) : null;
  const zelf = !b.organisator;
  return {
    id: code ? appleAfspraakId(agenda.id, bestand, code) : basisId,
    titel: tekst(comp, 'summary', 300) || '(Geen titel)',
    notitie,
    locatie,
    start: s.toISOString(),
    eind: e.toISOString(),
    heleDag,
    klantId: null,
    klantNaam: null,
    deelnemers: [],
    aangemaaktDoor: null,
    herhaling: null,
    herhaalTot: null,
    reeksId: herhaalt ? basisId : null,
    voorkomen: reeks ? inAmsterdam(moment(reeks.voorkomen)).dag : null,
    extern: {
      bron: 'apple',
      agendaId: agenda.id,
      agendaNaam: agenda.naam,
      kleur: agenda.kleur,
      eventId: bestand,
      herhaalt,
      meetLink: meet?.url ?? null,
      vergaderDienst: meet?.dienst ?? null,
      link: null,
      organisator: b.organisator,
      gasten: b.gasten,
      schrijfbaar: agenda.schrijfbaar && zelf,
      verwijderbaar: agenda.schrijfbaar
    }
  };
}

/** Hoofdafspraak (zonder RECURRENCE-ID) en de losse voorkomens van één bestand. */
function delen(cal: ICAL.Component): { hoofd: ICAL.Component | null; los: ICAL.Component[] } {
  const ev = cal.getAllSubcomponents('vevent');
  return { hoofd: ev.find((v) => !v.hasProperty('recurrence-id')) ?? null, los: ev.filter((v) => v.hasProperty('recurrence-id')) };
}

/**
 * De afspraken uit één .ics-bestand die [van, tot) raken. Herhalingen uitgevouwen (maximaal
 * 5000 voorkomens doorlopen, maximaal `max` teruggeven).
 */
export function afsprakenUitIcs(ics: string, bestand: string, agenda: AppleAgendaVoorWeergave, van: Date, tot: Date, max = 1000): Afspraak[] {
  const cal = leesKalender(ics);
  if (!cal) return [];
  const { hoofd, los } = delen(cal);
  const uit: Afspraak[] = [];
  const raakt = (a: Afspraak) => Date.parse(a.eind) > van.getTime() && Date.parse(a.start) < tot.getTime();
  if (!hoofd) {
    // Alleen losse voorkomens (je bent uitgenodigd voor één keer uit een reeks).
    for (const v of los) {
      const ev = new ICAL.Event(v);
      const a = alsAfspraak(v, ev.startDate, ev.endDate, agenda, bestand, { voorkomen: ev.recurrenceId }, true);
      if (a && raakt(a)) uit.push(a);
    }
    return uit;
  }
  let ev: ICAL.Event;
  try {
    ev = new ICAL.Event(hoofd);
    for (const v of los) ev.relateException(v);
  } catch {
    return [];
  }
  if (!ev.startDate) return [];
  if (!ev.isRecurring()) {
    const a = alsAfspraak(hoofd, ev.startDate, ev.endDate, agenda, bestand, null, false);
    return a && raakt(a) ? [a] : [];
  }
  const duur = moment(ev.endDate ?? ev.startDate).getTime() - moment(ev.startDate).getTime();
  try {
    const it = ev.iterator();
    for (let i = 0, t = it.next(); t && i < MAX_VOORKOMENS && uit.length < max; i++, t = it.next()) {
      const m = moment(t).getTime();
      if (m >= tot.getTime() + 2 * 86_400_000) break;
      // Ruwe voorselectie (een los voorkomen kan verschoven zijn, dus met marge).
      if (m + Math.max(duur, 0) + 2 * 86_400_000 < van.getTime()) continue;
      const d = ev.getOccurrenceDetails(t);
      const a = alsAfspraak(d.item.component, d.startDate, d.endDate, agenda, bestand, { voorkomen: d.recurrenceId }, true);
      if (a && raakt(a)) uit.push(a);
    }
  } catch {
    /* kapotte herhaalregel: wat we hebben */
  }
  return uit;
}

/** De UID van een bestand, of null. */
export function uidVan(ics: string): string | null {
  const cal = leesKalender(ics);
  const v = cal?.getFirstSubcomponent('vevent')?.getFirstPropertyValue('uid');
  return typeof v === 'string' && v ? v : null;
}

// ---------------------------------------------------------------------------------
// Schrijven
// ---------------------------------------------------------------------------------

function icalTijd(iso: string, heleDag: boolean): ICAL.Time {
  const a = inAmsterdam(iso);
  if (heleDag) return ICAL.Time.fromDateString(a.dag);
  const [j, m, d] = a.dag.split('-').map(Number);
  const [u, mi] = a.tijd.split(':').map(Number);
  return ICAL.Time.fromData({ year: j, month: m, day: d, hour: u, minute: mi, second: 0, isDate: false }, amsterdamZone());
}

function nuUtc(nu: Date): ICAL.Time {
  return ICAL.Time.fromJSDate(nu, true);
}

function zetTijd(comp: ICAL.Component, naam: 'dtstart' | 'dtend' | 'recurrence-id', t: ICAL.Time) {
  comp.removeAllProperties(naam);
  const p = new ICAL.Property(naam, comp);
  if (t.isDate) p.resetType('date');
  p.setValue(t);
  if (!t.isDate && t.zone && t.zone.tzid !== 'UTC' && t.zone.tzid !== 'floating') p.setParameter('tzid', t.zone.tzid);
  comp.addProperty(p);
}

function zetTekst(comp: ICAL.Component, naam: string, waarde: string | undefined) {
  if (waarde === undefined) return;
  comp.removeAllProperties(naam);
  if (waarde.trim()) comp.addPropertyWithValue(naam, waarde);
}

function stempel(comp: ICAL.Component, nu: Date) {
  comp.updatePropertyWithValue('dtstamp', nuUtc(nu));
  comp.updatePropertyWithValue('last-modified', nuUtc(nu));
  const seq = Number(comp.getFirstPropertyValue('sequence') ?? 0);
  comp.updatePropertyWithValue('sequence', Number.isFinite(seq) ? seq + 1 : 1);
}

function zorgVoorAmsterdam(cal: ICAL.Component) {
  const al = cal.getAllSubcomponents('vtimezone').some((z) => z.getFirstPropertyValue('tzid') === TZ);
  if (al) return;
  const tz = new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\n${VTIMEZONE_AMSTERDAM}\r\nEND:VCALENDAR`)).getFirstSubcomponent('vtimezone')!;
  // VTIMEZONE vóór de afspraken (zo schrijft Apple het ook).
  const alle = cal.getAllSubcomponents();
  for (const c of alle) cal.removeSubcomponent(c);
  for (const c of alle.filter((c) => c.name === 'vtimezone')) cal.addSubcomponent(c);
  cal.addSubcomponent(tz);
  for (const c of alle.filter((c) => c.name !== 'vtimezone')) cal.addSubcomponent(c);
}

function zetTijden(comp: ICAL.Component, start: string, eind: string, heleDag: boolean) {
  comp.removeAllProperties('duration');
  zetTijd(comp, 'dtstart', icalTijd(start, heleDag));
  // Een hele dag eindigt (exclusief) op de dag ná de laatste, net als bij ons.
  zetTijd(comp, 'dtend', icalTijd(eind, heleDag));
}

/** UNTIL voor de herhaalregel: een datum (hele dag) of het einde van die dag in UTC. */
function until(tot: Dag | null | undefined, heleDag: boolean): string | null {
  if (!tot) return null;
  if (heleDag) return tot.replace(/-/g, '');
  return new Date(amsterdamNaarMoment(plusDagen(tot, 1)).getTime() - 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function zetHerhaling(comp: ICAL.Component, rij: AfspraakRij, heleDag: boolean, start: string) {
  if (!('herhaling' in rij)) return;
  comp.removeAllProperties('rrule');
  comp.removeAllProperties('exdate');
  if (rij.herhaling) comp.addPropertyWithValue('rrule', ICAL.Recur.fromString(rrule(rij.herhaling, inAmsterdam(start).dag, until(rij.herhaal_tot, heleDag))));
}

/** Een nieuw .ics-bestand voor een afspraak uit gevalideerde invoer (parseAfspraak). */
export function nieuweIcs(rij: AfspraakRij, uid: string, nu = new Date()): string {
  if (!rij.starts_at || !rij.ends_at) throw new Error('Begin en eind ontbreken.');
  const heleDag = rij.all_day === true;
  const cal = new ICAL.Component(['vcalendar', [], []]);
  cal.addPropertyWithValue('version', '2.0');
  cal.addPropertyWithValue('prodid', PRODID);
  cal.addPropertyWithValue('calscale', 'GREGORIAN');
  if (!heleDag) zorgVoorAmsterdam(cal);
  const ev = new ICAL.Component('vevent');
  ev.addPropertyWithValue('uid', uid);
  ev.addPropertyWithValue('dtstamp', nuUtc(nu));
  ev.addPropertyWithValue('created', nuUtc(nu));
  ev.addPropertyWithValue('last-modified', nuUtc(nu));
  ev.addPropertyWithValue('sequence', 0);
  zetTekst(ev, 'summary', rij.title ?? '');
  zetTekst(ev, 'description', rij.notes ?? '');
  zetTekst(ev, 'location', rij.location ?? '');
  zetTijden(ev, rij.starts_at, rij.ends_at, heleDag);
  zetHerhaling(ev, rij, heleDag, rij.starts_at);
  cal.addSubcomponent(ev);
  return cal.toString();
}

/** Het voorkomen met deze code in de reeks (de tijd zoals de reeks hem schrijft), of null. */
function vindVoorkomen(hoofd: ICAL.Component, los: ICAL.Component[], code: string): ICAL.Time | null {
  for (const v of los) {
    const r = v.getFirstPropertyValue('recurrence-id');
    if (r instanceof ICAL.Time && voorkomenCode(r) === code) return r;
  }
  const ev = new ICAL.Event(hoofd);
  const doel = /^\d{8}$/.test(code)
    ? amsterdamNaarMoment(`${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)}`).getTime()
    : Date.parse(`${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)}T${code.slice(9, 11)}:${code.slice(11, 13)}:${code.slice(13, 15)}Z`);
  const it = ev.iterator();
  for (let i = 0, t = it.next(); t && i < MAX_VOORKOMENS; i++, t = it.next()) {
    if (voorkomenCode(t) === code) return t;
    if (moment(t).getTime() > doel + 2 * 86_400_000) break;
  }
  return null;
}

function wandklok(iso: string) {
  return inAmsterdam(iso);
}

/**
 * De tijden voor de hele reeks bij een wijziging van één voorkomen: dezelfde verschuiving
 * in dagen en dezelfde nieuwe wandkloktijden, vanaf het begin van de reeks.
 */
export function reeksTijden(
  reeks: { start: string; eind: string; heleDag: boolean },
  voorkomenOud: { start: string; heleDag: boolean },
  nieuw: { start: string; eind: string; heleDag: boolean }
): { start: string; eind: string } {
  const verschuiving = dagenTussen(wandklok(voorkomenOud.start).dag, wandklok(nieuw.start).dag);
  const eersteDag = plusDagen(wandklok(reeks.start).dag, verschuiving);
  const s = wandklok(nieuw.start);
  const e = wandklok(nieuw.eind);
  const dagen = dagenTussen(s.dag, e.dag);
  const start = amsterdamNaarMoment(eersteDag, nieuw.heleDag ? '00:00' : s.tijd);
  let eind = amsterdamNaarMoment(plusDagen(eersteDag, dagen), nieuw.heleDag ? '00:00' : e.tijd);
  if (eind.getTime() <= start.getTime()) eind = new Date(start.getTime() + (Date.parse(nieuw.eind) - Date.parse(nieuw.start)));
  return { start: start.toISOString(), eind: eind.toISOString() };
}

export class IcsFout extends Error {}

/**
 * Een bestaand .ics-bestand wijzigen.
 *   - voorkomen = null: de afspraak zelf (bij een reeks: de hele reeks);
 *   - voorkomen + deze: alleen dat voorkomen (een los VEVENT met RECURRENCE-ID);
 *   - voorkomen + reeks: de hele reeks; tijden schuiven mee zoals bij dit voorkomen.
 * `huidig` = het getoonde voorkomen (begin/eind) om de verschuiving te bepalen.
 */
export function wijzigIcs(
  ics: string,
  o: {
    voorkomen: string | null;
    deze: boolean;
    rij: AfspraakRij;
    metTijd: boolean;
    huidig: { start: string; eind: string; heleDag: boolean };
    nu?: Date;
  }
): string {
  const nu = o.nu ?? new Date();
  const cal = leesKalender(ics);
  if (!cal) throw new IcsFout('Deze afspraak kan niet worden gelezen.');
  const { hoofd, los } = delen(cal);
  const { rij } = o;
  const heleDag = rij.all_day ?? o.huidig.heleDag;

  let doel: ICAL.Component;
  if (o.voorkomen && (o.deze || !hoofd)) {
    let bestaand = los.find((v) => {
      const r = v.getFirstPropertyValue('recurrence-id');
      return r instanceof ICAL.Time && voorkomenCode(r) === o.voorkomen;
    });
    if (!bestaand) {
      if (!hoofd) throw new IcsFout('Dit voorkomen bestaat niet (meer).');
      const t = vindVoorkomen(hoofd, los, o.voorkomen);
      if (!t) throw new IcsFout('Dit voorkomen bestaat niet (meer).');
      // Een los voorkomen: een kopie van de reeks zonder herhaalregel, met de tijden van dit voorkomen.
      bestaand = new ICAL.Component(JSON.parse(JSON.stringify(hoofd.toJSON())));
      for (const p of ['rrule', 'rdate', 'exdate']) bestaand.removeAllProperties(p);
      zetTijd(bestaand, 'recurrence-id', t);
      zetTijden(bestaand, o.huidig.start, o.huidig.eind, o.huidig.heleDag);
      cal.addSubcomponent(bestaand);
    }
    doel = bestaand;
    if (o.metTijd && rij.starts_at && rij.ends_at) {
      if (!heleDag) zorgVoorAmsterdam(cal);
      zetTijden(doel, rij.starts_at, rij.ends_at, heleDag);
    }
  } else {
    if (!hoofd) throw new IcsFout('Deze afspraak kan niet worden gelezen.');
    doel = hoofd;
    if (o.metTijd && rij.starts_at && rij.ends_at) {
      if (!heleDag) zorgVoorAmsterdam(cal);
      const ev = new ICAL.Event(hoofd);
      if (ev.isRecurring() && o.voorkomen) {
        const reeks = { start: moment(ev.startDate).toISOString(), eind: moment(ev.endDate ?? ev.startDate).toISOString(), heleDag: ev.startDate.isDate };
        const t = reeksTijden(reeks, o.huidig, { start: rij.starts_at, eind: rij.ends_at, heleDag });
        zetTijden(hoofd, t.start, t.eind, heleDag);
      } else {
        zetTijden(hoofd, rij.starts_at, rij.ends_at, heleDag);
      }
    }
    if ('herhaling' in rij && !los.length) zetHerhaling(hoofd, rij, heleDag, rij.starts_at ?? o.huidig.start);
  }
  zetTekst(doel, 'summary', rij.title);
  zetTekst(doel, 'description', rij.notes);
  zetTekst(doel, 'location', rij.location);
  stempel(doel, nu);
  return cal.toString();
}

/**
 * Eén voorkomen uit een reeks halen: een EXDATE op de reeks en een eventueel los voorkomen
 * weg. Geeft null als er daarna niets meer over is (dan het hele bestand verwijderen).
 */
export function zonderVoorkomen(ics: string, code: string, nu = new Date()): string | null {
  const cal = leesKalender(ics);
  if (!cal) throw new IcsFout('Deze afspraak kan niet worden gelezen.');
  const { hoofd, los } = delen(cal);
  let t: ICAL.Time | null = null;
  for (const v of los) {
    const r = v.getFirstPropertyValue('recurrence-id');
    if (r instanceof ICAL.Time && voorkomenCode(r) === code) {
      t = r;
      cal.removeSubcomponent(v);
    }
  }
  if (!hoofd) return cal.getAllSubcomponents('vevent').length ? cal.toString() : null;
  t = t ?? vindVoorkomen(hoofd, los, code);
  if (!t) return cal.toString();
  const p = new ICAL.Property('exdate', hoofd);
  if (t.isDate) p.resetType('date');
  p.setValue(t);
  if (!t.isDate && t.zone && t.zone.tzid !== 'UTC' && t.zone.tzid !== 'floating') p.setParameter('tzid', t.zone.tzid);
  hoofd.addProperty(p);
  stempel(hoofd, nu);
  return cal.toString();
}
