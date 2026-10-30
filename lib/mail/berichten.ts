import type { FetchMessageObject, ImapFlow, MessageAddressObject, MessageStructureObject } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import { MailFout } from './fout';
import { saneerMailHtml } from './saneren';
import type { Adres, Bericht, BerichtenPagina, Bijlage, Envelop } from './types';

// Lezen van berichten: lijsten (nieuw → oud), zoeken, één bericht volledig, bijlagen.

const MAX_PER = 100;
/** Groter dan dit: alleen het begin van de bron ophalen (tekst staat vrijwel altijd vooraan). */
const MAX_BRON = 12 * 1024 * 1024;
const BRON_BEGIN = 3 * 1024 * 1024;
/**
 * Bovengrens voor html + tekst in de JSON-respons van één bericht. Vercel weigert responsen
 * boven 4,5 MB (FUNCTION_PAYLOAD_TOO_LARGE); dit laat ruimte voor JSON-escaping en de rest.
 */
const MAX_INHOUD = 3.5 * 1024 * 1024;
/** Ingebedde data:-afbeeldingen groter dan dit gaan als eerste weg als de grens bereikt is. */
const GROOT_DATA_URI = 100 * 1024;
/** Platte tekst naast HTML dient alleen nog als citaat bij beantwoorden: dan hooguit dit. */
const MAX_TEKST_NAAST_HTML = 256 * 1024;

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

/** Kapt af op een tekengrens in bytes (en in HTML vóór een half afgebroken tag). */
function kapAf(s: string, maxBytes: number, isHtml: boolean): string {
  if (maxBytes <= 0) return '';
  if (bytes(s) <= maxBytes) return s;
  // Ruwe schatting in tekens; daarna inkorten tot het in bytes past.
  let uit = s.slice(0, maxBytes);
  while (bytes(uit) > maxBytes) uit = uit.slice(0, Math.floor(uit.length * 0.9));
  if (isHtml) {
    const lt = uit.lastIndexOf('<');
    if (lt > uit.lastIndexOf('>')) uit = uit.slice(0, lt);
  }
  return uit;
}

/**
 * Houdt de berichtinhoud onder MAX_INHOUD: eerst grote data:-afbeeldingen weg, dan alle
 * data:-afbeeldingen, dan de platte tekst (als er HTML is) inkorten, en pas daarna afkappen.
 * Een <img> zonder src wordt in het leesvenster verborgen (VeiligeMailFrame).
 */
export function begrensInhoud(html: string | null, tekst: string): { html: string | null; tekst: string; ingekort: boolean } {
  const past = () => (html ? bytes(html) : 0) + bytes(tekst) <= MAX_INHOUD;
  if (past()) return { html, tekst, ingekort: false };

  // sanitize-html schrijft attributen met dubbele aanhalingstekens; een " in een waarde wordt
  // &quot;, dus src="data:…" is altijd één aaneengesloten attribuut.
  const zonderDataUris = (h: string, drempel: number) =>
    h.replace(/\ssrc="data:[^"]*"/g, (m) => (m.length > drempel ? '' : m));

  if (html) html = zonderDataUris(html, GROOT_DATA_URI);
  if (!past() && html) html = zonderDataUris(html, 0);
  if (!past() && html && bytes(tekst) > MAX_TEKST_NAAST_HTML) tekst = kapAf(tekst, MAX_TEKST_NAAST_HTML, false);
  if (!past() && html) html = kapAf(html, MAX_INHOUD - bytes(tekst), true);
  if (!past()) tekst = kapAf(tekst, MAX_INHOUD - (html ? bytes(html) : 0), false);
  return { html, tekst, ingekort: true };
}

function adres(a: MessageAddressObject | undefined): Adres | null {
  if (!a || !a.address) return a?.name ? { naam: a.name, adres: '' } : null;
  return { naam: (a.name || '').trim(), adres: a.address.trim() };
}

function adressen(lijst: MessageAddressObject[] | undefined): Adres[] {
  return (lijst ?? []).map(adres).filter((a): a is Adres => a !== null);
}

function isoDatum(d: Date | string | undefined | null): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** Bijlagen uit de BODYSTRUCTURE (zonder de berichtinhoud op te halen). */
export function bijlagenUitStructuur(node: MessageStructureObject | undefined): Bijlage[] {
  const uit: Bijlage[] = [];
  const loop = (n: MessageStructureObject | undefined) => {
    if (!n) return;
    const type = (n.type || '').toLowerCase();
    if (type.startsWith('multipart/')) {
      n.childNodes?.forEach(loop);
      return;
    }
    const naam = n.dispositionParameters?.filename || n.parameters?.name || '';
    const dispositie = (n.disposition || '').toLowerCase();
    const isTekst = type === 'text/plain' || type === 'text/html';
    let isBijlage: boolean;
    if (type === 'message/rfc822' || dispositie === 'attachment') isBijlage = true;
    else if (isTekst && !naam) isBijlage = false; // de berichttekst zelf
    // Ingebedde afbeeldingen (cid:) horen bij de HTML, niet in de bijlagenlijst.
    else if (type.startsWith('image/') && n.id) isBijlage = false;
    else isBijlage = Boolean(naam);
    if (!isBijlage || !n.part) return;
    // Base64 is ~4/3 van de echte grootte.
    const ruw = n.size ?? 0;
    const grootte = (n.encoding || '').toLowerCase() === 'base64' ? Math.round((ruw * 3) / 4) : ruw;
    uit.push({
      deel: n.part,
      naam: naam || (type === 'message/rfc822' ? 'bericht.eml' : `bijlage-${n.part}`),
      type: type || 'application/octet-stream',
      grootte
    });
  };
  loop(node);
  return uit;
}

function naarEnvelop(m: FetchMessageObject): Envelop {
  const env = m.envelope;
  const vlaggen = m.flags ?? new Set<string>();
  return {
    uid: m.uid,
    van: adres(env?.from?.[0]),
    aan: adressen(env?.to),
    onderwerp: (env?.subject || '').trim(),
    datum: isoDatum(env?.date) ?? isoDatum(m.internalDate),
    gelezen: vlaggen.has('\\Seen'),
    gemarkeerd: vlaggen.has('\\Flagged'),
    beantwoord: vlaggen.has('\\Answered'),
    heeftBijlagen: bijlagenUitStructuur(m.bodyStructure).length > 0,
    grootte: m.size ?? undefined
  };
}

const ENVELOP_QUERY = { uid: true, flags: true, envelope: true, internalDate: true, bodyStructure: true, size: true } as const;

/**
 * Een pagina berichten uit een map, nieuwste eerst. Zonder zoekterm op volgnummer
 * (exists-(p*per)+1 : exists-(p-1)*per); met zoekterm via SEARCH en dan een plak eruit.
 */
export async function berichtenPagina(
  client: ImapFlow,
  map: string,
  opties: { pagina: number; per: number; zoek?: string }
): Promise<BerichtenPagina & { uidValidity: string }> {
  const per = Math.min(MAX_PER, Math.max(1, opties.per));
  const pagina = Math.max(1, opties.pagina);
  const zoek = (opties.zoek || '').trim().slice(0, 200);

  const lock = await client.getMailboxLock(map, { readOnly: true });
  try {
    const exists = client.mailbox ? client.mailbox.exists : 0;
    const uidValidity = String(client.mailbox ? client.mailbox.uidValidity : '');
    if (!exists) return { map, pagina, per, totaal: 0, berichten: [], meer: false, uidValidity };

    if (!zoek) {
      const hoog = exists - (pagina - 1) * per;
      if (hoog < 1) return { map, pagina, per, totaal: exists, berichten: [], meer: false, uidValidity };
      const laag = Math.max(1, hoog - per + 1);
      const berichten = (await client.fetchAll(`${laag}:${hoog}`, ENVELOP_QUERY)).sort((a, b) => b.seq - a.seq).map(naarEnvelop);
      return { map, pagina, per, totaal: exists, berichten, meer: laag > 1, uidValidity };
    }

    const uids = await client.search(
      { or: [{ subject: zoek }, { from: zoek }, { to: zoek }, { body: zoek }] },
      { uid: true }
    );
    const alle = (Array.isArray(uids) ? uids : []).sort((a, b) => b - a);
    const plak = alle.slice((pagina - 1) * per, pagina * per);
    if (!plak.length) return { map, pagina, per, totaal: alle.length, berichten: [], meer: false, uidValidity };
    const berichten = (await client.fetchAll(plak, ENVELOP_QUERY, { uid: true })).sort((a, b) => b.uid - a.uid).map(naarEnvelop);
    return { map, pagina, per, totaal: alle.length, berichten, meer: pagina * per < alle.length, uidValidity };
  } finally {
    lock.release();
  }
}

/** De laatste n enveloppen uit de inbox (dashboard-widget). */
export async function laatsteBerichten(client: ImapFlow, map: string, n: number): Promise<Envelop[]> {
  const res = await berichtenPagina(client, map, { pagina: 1, per: n });
  return res.berichten;
}

function adresLijst(a: AddressObject | AddressObject[] | undefined): Adres[] {
  const lijst = Array.isArray(a) ? a : a ? [a] : [];
  const uit: Adres[] = [];
  for (const obj of lijst) {
    for (const v of obj.value) {
      if (v.group) v.group.forEach((g) => g.address && uit.push({ naam: g.name || '', adres: g.address }));
      else if (v.address) uit.push({ naam: v.name || '', adres: v.address });
    }
  }
  return uit;
}

const BERICHT_QUERY = {
  uid: true,
  flags: true,
  size: true,
  bodyStructure: true,
  envelope: true,
  // De bron hooguit MAX_BRON; is het bericht groter, dan alleen het begin parsen (de tekst
  // staat vrijwel altijd vooraan).
  source: { start: 0, maxLength: MAX_BRON }
} as const;

/** Parset en saneert een opgehaald bericht (kop + bron uit één FETCH). */
async function naarBericht(map: string, kop: FetchMessageObject): Promise<Bericht> {
  if (!kop.source) throw new MailFout(404, 'niet_gevonden', 'Dit bericht bestaat niet meer.');
  const groot = (kop.size ?? 0) > MAX_BRON;
  const mail = await simpleParser(groot ? kop.source.subarray(0, BRON_BEGIN) : kop.source, {
    skipTextToHtml: true,
    // cid:-afbeeldingen worden data:-URI's, met een totaalbudget van 1 MB voor alle
    // ingebedde beelden samen. Wat daarboven valt blijft cid: en haalt de sanitizer weg.
    maxInlinedImagesSize: 1024 * 1024
  });

  const vlaggen = kop.flags ?? new Set<string>();
  const saneer = mail.html ? saneerMailHtml(mail.html) : null;
  const inhoud = begrensInhoud(saneer ? saneer.html : null, (mail.text ?? '').replace(/\r\n/g, '\n').trim());
  const van = adresLijst(mail.from)[0] ?? adres(kop.envelope?.from?.[0]);

  return {
    map,
    uid: kop.uid,
    messageId: mail.messageId ?? kop.envelope?.messageId ?? null,
    van: van ?? null,
    antwoordAan: adresLijst(mail.replyTo),
    aan: adresLijst(mail.to),
    cc: adresLijst(mail.cc),
    onderwerp: (mail.subject ?? kop.envelope?.subject ?? '').trim(),
    datum: isoDatum(mail.date) ?? isoDatum(kop.envelope?.date),
    gelezen: vlaggen.has('\\Seen'),
    gemarkeerd: vlaggen.has('\\Flagged'),
    html: inhoud.html,
    tekst: inhoud.tekst,
    bijlagen: bijlagenUitStructuur(kop.bodyStructure),
    externeBeelden: saneer ? saneer.externeBeelden : 0,
    ingekort: groot || inhoud.ingekort
  };
}

/**
 * Eén bericht volledig: met PEEK opgehaald (zet het niet stilletjes op gelezen; dat doet
 * de client expliciet via /vlaggen), geparsed en de HTML gesaneerd. Eén FETCH.
 */
export async function haalBericht(client: ImapFlow, map: string, uid: number): Promise<Bericht> {
  const lock = await client.getMailboxLock(map, { readOnly: true });
  try {
    const kop = await client.fetchOne(String(uid), BERICHT_QUERY, { uid: true });
    if (!kop || !kop.source) throw new MailFout(404, 'niet_gevonden', 'Dit bericht bestaat niet meer (verplaatst of verwijderd).');
    return await naarBericht(map, kop);
  } finally {
    lock.release();
  }
}

/**
 * Meerdere berichten vooruit ophalen (voor direct openen): ook met PEEK, in hooguit twee
 * FETCH-rondgangen (eerst de groottes, dan de bronnen van wat klein genoeg is). Grote
 * berichten en berichten die er niet (meer) zijn, worden overgeslagen; die laden pas bij openen.
 */
export async function haalBerichten(client: ImapFlow, map: string, uids: number[], maxGrootte: number): Promise<Bericht[]> {
  if (!uids.length) return [];
  const lock = await client.getMailboxLock(map, { readOnly: true });
  try {
    const maten = await client.fetchAll(uids.join(','), { uid: true, size: true }, { uid: true });
    const klein = maten.filter((m) => (m.size ?? Infinity) <= maxGrootte).map((m) => m.uid);
    if (!klein.length) return [];
    const opgehaald = await client.fetchAll(klein.join(','), BERICHT_QUERY, { uid: true });
    const uit: Bericht[] = [];
    for (const kop of opgehaald) {
      try {
        uit.push(await naarBericht(map, kop));
      } catch {
        /* één onleesbaar bericht houdt de rest niet op */
      }
    }
    return uit;
  } finally {
    lock.release();
  }
}

/** Kopregels voor een antwoord (threading): Message-ID en References van het origineel. */
export async function threadKoppen(
  client: ImapFlow,
  map: string,
  uid: number
): Promise<{ messageId: string | null; references: string[] }> {
  const lock = await client.getMailboxLock(map, { readOnly: true });
  try {
    const m = await client.fetchOne(String(uid), { uid: true, envelope: true, headers: ['references'] }, { uid: true });
    if (!m) throw new MailFout(404, 'niet_gevonden', 'Het oorspronkelijke bericht bestaat niet meer.');
    const refsRuw = m.headers ? m.headers.toString('utf8').replace(/^references:\s*/i, '').replace(/\r?\n\s+/g, ' ') : '';
    const references = refsRuw.match(/<[^<>\s]+>/g) ?? [];
    return { messageId: m.envelope?.messageId ?? null, references };
  } finally {
    lock.release();
  }
}

/** Haalt één bijlage (gedecodeerd) op, met een maximum. */
export async function haalBijlage(
  client: ImapFlow,
  map: string,
  uid: number,
  deel: string,
  maxBytes: number
): Promise<{ naam: string; type: string; inhoud: Buffer }> {
  if (!/^\d{1,3}(\.\d{1,3}){0,9}$/.test(deel)) throw new MailFout(400, 'ongeldig', 'Ongeldige bijlage.');
  const lock = await client.getMailboxLock(map, { readOnly: true });
  try {
    const kop = await client.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
    if (!kop) throw new MailFout(404, 'niet_gevonden', 'Dit bericht bestaat niet meer.');
    const info = bijlagenUitStructuur(kop.bodyStructure).find((b) => b.deel === deel);
    if (!info) throw new MailFout(404, 'niet_gevonden', 'Deze bijlage bestaat niet.');
    if (info.grootte > maxBytes) throw new MailFout(413, 'te_groot', 'Deze bijlage is te groot om te downloaden (max. 25 MB).');

    const dl = await client.download(String(uid), deel, { uid: true, maxBytes });
    if (!dl.content) throw new MailFout(404, 'niet_gevonden', 'Deze bijlage bestaat niet.');
    const delen: Buffer[] = [];
    let totaal = 0;
    for await (const stuk of dl.content) {
      const b = Buffer.isBuffer(stuk) ? stuk : Buffer.from(stuk);
      totaal += b.length;
      if (totaal > maxBytes) throw new MailFout(413, 'te_groot', 'Deze bijlage is te groot om te downloaden (max. 25 MB).');
      delen.push(b);
    }
    return {
      naam: dl.meta?.filename || info.naam,
      type: dl.meta?.contentType || info.type,
      inhoud: Buffer.concat(delen)
    };
  } finally {
    lock.release();
  }
}
