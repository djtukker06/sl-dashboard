// Een iCalendar-bestand (RFC 5545) voor het agenda-abonnement van één teamlid: zijn taken
// en afspraken als VEVENT (Apple Agenda en Google Agenda tonen VTODO niet in een
// abonnement). Bewust zonder imports buiten ./datum en ./herhaling, zodat
// scripts/test-agenda-feed.mjs dit direct laadt. Een herhalende afspraak (migratie 0034) is
// één VEVENT met een RRULE in Europe/Amsterdam (met VTIMEZONE, zodat 09:00 ook na de
// zomertijdwissel 09:00 blijft) en EXDATE's voor overgeslagen of losgemaakte voorkomens.

import { amsterdamNaarMoment, inAmsterdam, plusDagen, TZ, type Dag } from './datum';
import { rrule, type Herhaling } from './herhaling';

export interface FeedTaak {
  id: string;
  titel: string;
  notitie: string;
  datum: Dag;
  tijd: string | null;
  duur: number | null;
  prioriteit: 1 | 2 | 3;
  afgerond: boolean;
}

export interface FeedAfspraak {
  id: string;
  titel: string;
  notitie: string;
  locatie: string;
  start: string;
  eind: string;
  heleDag: boolean;
  /** Herhaalregel (migratie 0034); start/eind zijn dan die van het eerste voorkomen. */
  herhaling?: Herhaling | null;
  herhaalTot?: Dag | null;
  /** Datums van voorkomens die niet (meer) in de reeks staan. */
  uitzonderingen?: Dag[];
}

const DOMEIN = 'studio-levant.nl';

/** Tekst escapen volgens RFC 5545 (backslash, puntkomma, komma, regeleinde). */
export function icsTekst(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Regels vouwen op 75 octets (UTF-8), vervolgregels beginnen met een spatie. */
export function vouw(regel: string): string {
  const enc = new TextEncoder();
  if (enc.encode(regel).length <= 75) return regel;
  const delen: string[] = [];
  let huidig = '';
  let lengte = 0;
  for (const teken of regel) {
    const n = enc.encode(teken).length;
    const max = delen.length === 0 ? 75 : 74;
    if (lengte + n > max) {
      delen.push(huidig);
      huidig = '';
      lengte = 0;
    }
    huidig += teken;
    lengte += n;
  }
  delen.push(huidig);
  return delen.join('\r\n ');
}

function utc(moment: Date | string): string {
  return new Date(moment).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

const datumIcs = (d: Dag) => d.replace(/-/g, '');

/** Wandkloktijd in Amsterdam als lokale iCalendar-tijd (zonder Z), bv. 20261103T090000. */
function lokaal(dag: Dag, tijd: string): string {
  return `${datumIcs(dag)}T${tijd.replace(':', '')}00`;
}

// Europe/Amsterdam sinds 1996 (EU-regels): zomertijd van de laatste zondag van maart tot
// de laatste zondag van oktober.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZ}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE'
];

function taakTitel(t: FeedTaak): string {
  if (t.afgerond) return `✓ ${t.titel}`;
  if (t.prioriteit === 1) return `‼ URGENT: ${t.titel}`;
  return t.titel;
}

export function maakIcs(o: { naam: string; taken: FeedTaak[]; afspraken: FeedAfspraak[]; link: string | null; nu?: Date }): string {
  const stempel = utc(o.nu ?? new Date());
  const r: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Studio Levant//Backoffice//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsTekst(`Studio Levant · ${o.naam}`)}`,
    'X-WR-TIMEZONE:Europe/Amsterdam',
    // Zo vaak mogelijk verversen (Apple respecteert dit; Google bepaalt het zelf).
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M'
  ];
  if (o.afspraken.some((a) => a.herhaling && !a.heleDag)) r.push(...VTIMEZONE);
  const omschrijving = (notitie: string, soort: string) =>
    icsTekst([notitie.trim(), o.link ? `${soort} in Studio Levant: ${o.link}` : ''].filter(Boolean).join('\n\n'));

  for (const t of o.taken) {
    r.push('BEGIN:VEVENT', `UID:taak-${t.id}@${DOMEIN}`, `DTSTAMP:${stempel}`);
    if (t.tijd) {
      const start = amsterdamNaarMoment(t.datum, t.tijd);
      const eind = new Date(start.getTime() + (t.duur ?? 30) * 60_000);
      r.push(`DTSTART:${utc(start)}`, `DTEND:${utc(eind)}`);
    } else {
      r.push(`DTSTART;VALUE=DATE:${datumIcs(t.datum)}`, `DTEND;VALUE=DATE:${datumIcs(plusDagen(t.datum, 1))}`);
    }
    r.push(
      `SUMMARY:${icsTekst(taakTitel(t))}`,
      `DESCRIPTION:${omschrijving(t.notitie, 'Taak')}`,
      'CATEGORIES:Taak',
      `PRIORITY:${t.prioriteit === 1 ? 1 : t.prioriteit === 3 ? 9 : 5}`,
      'TRANSP:TRANSPARENT',
      `STATUS:${t.afgerond ? 'CANCELLED' : 'CONFIRMED'}`
    );
    // Urgente open taak met tijd: een melding 15 minuten van tevoren.
    if (t.prioriteit === 1 && !t.afgerond && t.tijd) {
      r.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsTekst(t.titel)}`, 'TRIGGER:-PT15M', 'END:VALARM');
    }
    r.push('END:VEVENT');
  }

  for (const a of o.afspraken) {
    r.push('BEGIN:VEVENT', `UID:afspraak-${a.id}@${DOMEIN}`, `DTSTAMP:${stempel}`);
    const s = inAmsterdam(a.start);
    const e = inAmsterdam(a.eind);
    if (a.heleDag) {
      // Opgeslagen als 00:00 Amsterdamse tijd t/m 00:00 van de dag ná de laatste dag.
      r.push(`DTSTART;VALUE=DATE:${datumIcs(s.dag)}`, `DTEND;VALUE=DATE:${datumIcs(e.dag)}`);
    } else if (a.herhaling) {
      // Herhalend: in Amsterdamse tijd, anders verschuift het een uur na de zomertijdwissel.
      r.push(`DTSTART;TZID=${TZ}:${lokaal(s.dag, s.tijd)}`, `DTEND;TZID=${TZ}:${lokaal(e.dag, e.tijd)}`);
    } else {
      r.push(`DTSTART:${utc(a.start)}`, `DTEND:${utc(a.eind)}`);
    }
    if (a.herhaling) {
      // UNTIL: de laatste dag (inclusief); bij een tijd het einde van die dag in UTC.
      const tot = a.herhaalTot
        ? a.heleDag
          ? datumIcs(a.herhaalTot)
          : utc(new Date(amsterdamNaarMoment(plusDagen(a.herhaalTot, 1)).getTime() - 1000))
        : null;
      r.push(`RRULE:${rrule(a.herhaling, s.dag, tot)}`);
      const weg = [...new Set(a.uitzonderingen ?? [])].sort();
      if (weg.length) {
        r.push(
          a.heleDag
            ? `EXDATE;VALUE=DATE:${weg.map(datumIcs).join(',')}`
            : `EXDATE;TZID=${TZ}:${weg.map((d) => lokaal(d, s.tijd)).join(',')}`
        );
      }
    }
    r.push(`SUMMARY:${icsTekst(a.titel)}`, `DESCRIPTION:${omschrijving(a.notitie, 'Afspraak')}`);
    if (a.locatie.trim()) r.push(`LOCATION:${icsTekst(a.locatie.trim())}`);
    r.push('CATEGORIES:Afspraak', 'TRANSP:OPAQUE', 'END:VEVENT');
  }

  r.push('END:VCALENDAR');
  return r.map(vouw).join('\r\n') + '\r\n';
}

/** Welke agenda-app haalt de link op (aan de User-Agent). */
export function clientVan(ua: string | null): 'apple' | 'google' | 'outlook' | 'overig' {
  const s = (ua ?? '').toLowerCase();
  if (s.includes('google')) return 'google';
  if (s.includes('calendaragent') || s.includes('dataaccessd') || s.includes('ical') || s.includes('macos') || s.includes('ios/') || s.includes('darwin')) return 'apple';
  if (s.includes('outlook') || s.includes('microsoft')) return 'outlook';
  return 'overig';
}
