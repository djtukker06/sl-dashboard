// CalDAV (iCloud) zonder netwerk, env of '@/'-imports, zodat scripts/test-apple-agenda.mjs het
// los kan testen:
//   - een kleine XML-lezer met namespaces (genoeg voor de 207 Multi-Status van iCloud);
//   - de verzoeken (PROPFIND/REPORT) als XML;
//   - uit een antwoord: de principal, de agenda-map en de agenda's met naam, kleur en rechten.
// De server-kant (wachtwoord, database, fetch) staat in lib/apple-agenda/koppeling.ts.

export const ICLOUD_CALDAV = 'https://caldav.icloud.com/';

const DAV = 'DAV:';
const CAL = 'urn:ietf:params:xml:ns:caldav';
const APPLE = 'http://apple.com/ns/ical/';
const CS = 'http://calendarserver.org/ns/';

export interface XmlKnoop {
  /** "{namespace}lokale-naam" */
  naam: string;
  kinderen: XmlKnoop[];
  tekst: string;
}

const ENTITEIT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function ontsnap(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (heel, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITEIT[e.toLowerCase()] ?? heel;
  });
}

/** XML → boom met namespace-namen. Gooit bij onleesbare XML. Maximaal 5 MB. */
export function leesXml(xml: string): XmlKnoop {
  if (xml.length > 5_000_000) throw new Error('XML te groot.');
  const wortel: XmlKnoop = { naam: '#wortel', kinderen: [], tekst: '' };
  const stapel: { knoop: XmlKnoop; ns: Map<string, string>; rauw: string }[] = [{ knoop: wortel, ns: new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]), rauw: '' }];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const top = stapel[stapel.length - 1];
    if (lt === -1) {
      top.knoop.tekst += ontsnap(xml.slice(i));
      break;
    }
    if (lt > i) top.knoop.tekst += ontsnap(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      if (e === -1) throw new Error('XML: commentaar niet afgesloten.');
      i = e + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      if (e === -1) throw new Error('XML: CDATA niet afgesloten.');
      top.knoop.tekst += xml.slice(lt + 9, e);
      i = e + 3;
      continue;
    }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const e = xml.indexOf('>', lt);
      if (e === -1) throw new Error('XML: niet afgesloten.');
      i = e + 1;
      continue;
    }
    // Einde van de tag zoeken, met aanhalingstekens in attributen.
    let j = lt + 1;
    let quote = '';
    for (; j < xml.length; j++) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (j >= xml.length) throw new Error('XML: tag niet afgesloten.');
    const inhoud = xml.slice(lt + 1, j);
    i = j + 1;
    if (inhoud[0] === '/') {
      const naam = inhoud.slice(1).trim();
      if (stapel.length < 2 || stapel[stapel.length - 1].rauw !== naam) throw new Error('XML: tags kloppen niet.');
      stapel.pop();
      continue;
    }
    const zelfsluitend = inhoud.endsWith('/');
    const body = zelfsluitend ? inhoud.slice(0, -1) : inhoud;
    const m = /^([^\s/>]+)/.exec(body);
    if (!m) throw new Error('XML: lege tag.');
    const rauw = m[1];
    const ns = new Map(top.ns);
    for (const a of body.slice(rauw.length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      const attr = a[1];
      const waarde = ontsnap(a[3] ?? a[4] ?? '');
      if (attr === 'xmlns') ns.set('', waarde);
      else if (attr.startsWith('xmlns:')) ns.set(attr.slice(6), waarde);
    }
    const dp = rauw.indexOf(':');
    const prefix = dp === -1 ? '' : rauw.slice(0, dp);
    const lokaal = dp === -1 ? rauw : rauw.slice(dp + 1);
    const knoop: XmlKnoop = { naam: `{${ns.get(prefix) ?? ''}}${lokaal}`, kinderen: [], tekst: '' };
    top.knoop.kinderen.push(knoop);
    if (!zelfsluitend) stapel.push({ knoop, ns, rauw });
  }
  if (stapel.length !== 1) throw new Error('XML: niet alles afgesloten.');
  return wortel;
}

export const kind = (k: XmlKnoop | undefined, naam: string) => k?.kinderen.find((x) => x.naam === naam);
export const kinderen = (k: XmlKnoop | undefined, naam: string) => k?.kinderen.filter((x) => x.naam === naam) ?? [];
/** Alle nakomelingen met deze naam (diepte eerst). */
export function zoek(k: XmlKnoop | undefined, naam: string, uit: XmlKnoop[] = []): XmlKnoop[] {
  for (const c of k?.kinderen ?? []) {
    if (c.naam === naam) uit.push(c);
    zoek(c, naam, uit);
  }
  return uit;
}

export interface DavAntwoord {
  href: string;
  /** Alleen de eigenschappen uit een propstat met status 200. */
  props: XmlKnoop[];
  /** Status van de response zelf (bv. 404 bij een verwijderd item), of null. */
  status: number | null;
}

function statusVan(tekst: string | undefined): number | null {
  const m = /HTTP\/[\d.]+\s+(\d{3})/.exec(tekst ?? '');
  return m ? Number(m[1]) : null;
}

/** Een 207 Multi-Status als lijst van responses. */
export function leesMultistatus(xml: string): DavAntwoord[] {
  const wortel = leesXml(xml);
  const ms = zoek(wortel, `{${DAV}}multistatus`)[0];
  if (!ms) throw new Error('Geen multistatus.');
  return kinderen(ms, `{${DAV}}response`).map((r) => {
    const props: XmlKnoop[] = [];
    for (const ps of kinderen(r, `{${DAV}}propstat`)) {
      const s = statusVan(kind(ps, `{${DAV}}status`)?.tekst);
      if (s !== null && s >= 200 && s < 300) props.push(...(kind(ps, `{${DAV}}prop`)?.kinderen ?? []));
    }
    return { href: (kind(r, `{${DAV}}href`)?.tekst ?? '').trim(), props, status: statusVan(kind(r, `{${DAV}}status`)?.tekst) };
  });
}

const prop = (a: DavAntwoord, naam: string) => a.props.find((p) => p.naam === naam);
const hrefIn = (k: XmlKnoop | undefined) => (kind(k, `{${DAV}}href`)?.tekst ?? '').trim();

/** Een href (vaak alleen een pad) als volledige URL, alleen https en alleen bij iCloud. */
export function absoluut(href: string, basis: string): string | null {
  try {
    const u = new URL(href, basis);
    if (u.protocol !== 'https:' || !isIcloudHost(u.hostname)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** Alleen iCloud-servers (caldav.icloud.com, pXX-caldav.icloud.com): nooit ergens anders heen. */
export function isIcloudHost(host: string): boolean {
  return /^([a-z0-9-]+\.)?icloud\.com$/i.test(host) && /caldav/i.test(host);
}

// ---------------------------------------------------------------------------------
// Verzoeken
// ---------------------------------------------------------------------------------

export const XML_PRINCIPAL = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;

export const XML_HOME = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;

export const XML_AGENDAS = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CAL}" xmlns:a="${APPLE}" xmlns:cs="${CS}">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <d:current-user-privilege-set/>
    <c:supported-calendar-component-set/>
    <a:calendar-color/>
    <a:calendar-order/>
    <cs:getctag/>
  </d:prop>
</d:propfind>`;

/** Momenten voor CalDAV: 20261121T090000Z. */
export function davTijd(moment: Date): string {
  return moment.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Alle afspraken (VEVENT) die [van, tot) raken, met de volledige agenda-data. */
export function xmlBereik(van: Date, tot: Date): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="${CAL}">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${davTijd(van)}" end="${davTijd(tot)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
}

// ---------------------------------------------------------------------------------
// Antwoorden lezen
// ---------------------------------------------------------------------------------

export function principalUit(xml: string, basis: string): string | null {
  for (const a of leesMultistatus(xml)) {
    const p = prop(a, `{${DAV}}current-user-principal`);
    const h = hrefIn(p);
    if (h) return absoluut(h, basis);
  }
  return null;
}

export function homeUit(xml: string, basis: string): string | null {
  for (const a of leesMultistatus(xml)) {
    const h = hrefIn(prop(a, `{${CAL}}calendar-home-set`));
    if (h) return absoluut(h, basis);
  }
  return null;
}

export interface DavAgenda {
  url: string;
  naam: string;
  kleur: string;
  schrijfbaar: boolean;
  volgorde: number;
}

/** "#RRGGBBAA" of "#RRGGBB" (Apple) → "#rrggbb", anders null. */
export function appleKleur(v: string | undefined | null): string | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec((v ?? '').trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/**
 * De agenda's in de agenda-map: alleen echte agenda's die afspraken (VEVENT) kunnen bevatten.
 * Herinneringen (VTODO), de inbox/outbox en de map zelf vallen af.
 */
export function agendasUit(xml: string, basis: string, standaardKleur: string): DavAgenda[] {
  const uit: DavAgenda[] = [];
  // De naam van een comp staat in een attribuut; die leest de XML-lezer niet, dus kijken we
  // in de ruwe XML. Zonder comp-set (oude servers) nemen we aan dat VEVENT kan.
  const metEvents = eventAgendas(xml);
  for (const a of leesMultistatus(xml)) {
    const type = prop(a, `{${DAV}}resourcetype`);
    if (!kind(type, `{${CAL}}calendar`)) continue;
    if (!metEvents.has(a.href)) continue;
    const url = absoluut(a.href, basis);
    if (!url) continue;
    const rechten = prop(a, `{${DAV}}current-user-privilege-set`);
    const privileges = new Set(zoek(rechten, `{${DAV}}privilege`).flatMap((p) => p.kinderen.map((k) => k.naam)));
    const schrijfbaar = rechten
      ? privileges.has(`{${DAV}}all`) || privileges.has(`{${DAV}}write`) || privileges.has(`{${DAV}}write-content`) || privileges.has(`{${DAV}}bind`)
      : true;
    const volgorde = Number.parseInt(prop(a, `{${APPLE}}calendar-order`)?.tekst ?? '', 10);
    uit.push({
      url,
      naam: (prop(a, `{${DAV}}displayname`)?.tekst ?? '').trim().slice(0, 200) || 'Agenda',
      kleur: appleKleur(prop(a, `{${APPLE}}calendar-color`)?.tekst) ?? standaardKleur,
      schrijfbaar,
      volgorde: Number.isFinite(volgorde) ? volgorde : 1000
    });
  }
  return uit.sort((x, y) => x.volgorde - y.volgorde || x.naam.localeCompare(y.naam, 'nl'));
}

/**
 * Welke agenda's VEVENT ondersteunen. De XML-lezer bewaart geen attributen, dus dit leest de
 * ruwe XML per response: href → ondersteunt afspraken.
 */
export function eventAgendas(xml: string): Set<string> {
  const uit = new Set<string>();
  for (const blok of xml.split(/<(?:[a-z0-9]+:)?response[\s>]/i).slice(1)) {
    const href = /<(?:[a-z0-9]+:)?href[^>]*>([^<]+)</i.exec(blok)?.[1]?.trim();
    if (!href) continue;
    const set = /<(?:[a-z0-9]+:)?supported-calendar-component-set[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?supported-calendar-component-set>/i.exec(blok);
    if (!set || /name\s*=\s*["']VEVENT["']/i.test(set[1])) uit.add(ontsnap(href));
  }
  return uit;
}

export interface DavItem {
  href: string;
  etag: string | null;
  ics: string;
}

/** De afspraken uit een calendar-query-antwoord. */
export function itemsUit(xml: string): DavItem[] {
  const uit: DavItem[] = [];
  for (const a of leesMultistatus(xml)) {
    const ics = prop(a, `{${CAL}}calendar-data`)?.tekst;
    if (!ics || !a.href) continue;
    uit.push({ href: a.href, etag: prop(a, `{${DAV}}getetag`)?.tekst?.trim() || null, ics });
  }
  return uit;
}
