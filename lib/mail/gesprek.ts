import type { FetchMessageObject, ImapFlow, SearchObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { MailFout } from './fout';
import { bijlagenUitStructuur } from './berichten';
import { lijstMappen } from './mappen';
import type { Adres, GesprekBericht } from './types';

// Het gesprek (de "mail chain") rond één bericht: alle berichten die via Message-ID,
// In-Reply-To en References met elkaar verbonden zijn, uit de map van het bericht zelf
// plus inbox, verzonden en archief — zodat je ook je eigen antwoorden terugziet.
// Alleen de platte tekst (begrensd), opgesplitst in eigen tekst en geciteerde geschiedenis.

/** Hooguit zoveel berichten in een gesprek (de nieuwste/dichtstbijzijnde). */
const MAX_BERICHTEN = 25;
/** Hooguit zoveel Message-ID's in de zoekvraag (de laatste uit References). */
const MAX_IDS = 20;
/** Van elk bericht alleen het begin van de bron: de tekst staat vrijwel altijd vooraan. */
const BRON_BEGIN = 256 * 1024;
const MAX_TEKST = 40_000;

const ID_RE = /<[^<>\s]+>/g;

function kopWaarden(ruw: Buffer | undefined): Record<string, string> {
  const uit: Record<string, string> = {};
  if (!ruw) return uit;
  const tekst = ruw.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  for (const regel of tekst.split(/\r?\n/)) {
    const m = regel.match(/^([\w-]+):\s*(.*)$/);
    if (m) uit[m[1].toLowerCase()] = (uit[m[1].toLowerCase()] ? uit[m[1].toLowerCase()] + ' ' : '') + m[2];
  }
  return uit;
}

const ids = (s: string | undefined) => (s ?? '').match(ID_RE) ?? [];

/**
 * Splitst de tekst van een antwoord in het nieuwe deel en de geciteerde geschiedenis
 * ("Op … schreef …:", "On … wrote:", "-----Original Message-----", Outlook-kop, "> ").
 */
export function splitsCitaat(tekst: string): { tekst: string; citaat: string } {
  const regels = tekst.split('\n');
  let snede = -1;
  for (let i = 0; i < regels.length && snede < 0; i++) {
    const r = regels[i].trim();
    if (/^(op|on|le|am)\b.*\b(schreef|wrote|a écrit|schrieb|geschreven)\b.*:$/i.test(r)) snede = i;
    else if (/\b(schreef|wrote|a écrit|schrieb|geschreven)\b.*:$/i.test(r) && i > 0 && /^(op|on|le|am)\b/i.test(regels[i - 1].trim())) snede = i - 1;
    else if (/^-{2,}\s*(original message|oorspronkelijk bericht|oorspronkelijk e-mailbericht|forwarded message|doorgestuurd bericht)/i.test(r)) snede = i;
    else if (/^_{10,}$/.test(r)) snede = i;
    else if (/^(van|from):\s.+/i.test(r) && regels.slice(i + 1, i + 5).some((x) => /^\s*(verzonden|sent|datum|date):\s/i.test(x))) snede = i;
    else if (/^>/.test(r)) snede = i;
  }
  if (snede <= 0) return { tekst: tekst.trim(), citaat: '' };
  const eigen = regels.slice(0, snede).join('\n').trim();
  if (!eigen) return { tekst: tekst.trim(), citaat: '' };
  return { tekst: eigen, citaat: regels.slice(snede).join('\n').trim() };
}

function adres(a: { name?: string; address?: string } | undefined): Adres | null {
  if (!a || (!a.address && !a.name)) return null;
  return { naam: (a.name || '').trim(), adres: (a.address || '').trim() };
}

function isoDatum(d: Date | string | undefined | null): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

interface Treffer {
  map: string;
  m: FetchMessageObject;
  messageId: string | null;
}

/** Zoekt in één map naar berichten die bij deze set Message-ID's horen. */
async function zoekInMap(client: ImapFlow, map: string, zoekIds: string[]): Promise<Treffer[]> {
  const vragen: SearchObject[] = [];
  for (const id of zoekIds) {
    vragen.push({ header: { 'message-id': id } });
    vragen.push({ header: { references: id } });
    vragen.push({ header: { 'in-reply-to': id } });
  }
  const lock = await client.getMailboxLock(map, { readOnly: true });
  try {
    if (!client.mailbox || !client.mailbox.exists) return [];
    const uids = await client.search(vragen.length === 1 ? vragen[0] : { or: vragen }, { uid: true });
    if (!Array.isArray(uids) || !uids.length) return [];
    const plak = uids.sort((a, b) => b - a).slice(0, MAX_BERICHTEN * 2);
    const lijst = await client.fetchAll(
      plak,
      { uid: true, envelope: true, internalDate: true, bodyStructure: true, headers: ['message-id', 'in-reply-to', 'references'] },
      { uid: true }
    );
    return lijst.map((m) => ({ map, m, messageId: m.envelope?.messageId ?? ids(kopWaarden(m.headers)['message-id'])[0] ?? null }));
  } finally {
    lock.release();
  }
}

/** Platte tekst van een aantal berichten uit één map, in één FETCH. Sleutel: uid. */
async function teksten(client: ImapFlow, map: string, uids: number[]): Promise<Map<number, string>> {
  const uit = new Map<number, string>();
  const lock = await client.getMailboxLock(map, { readOnly: true });
  let bronnen: FetchMessageObject[];
  try {
    bronnen = await client.fetchAll(uids, { uid: true, source: { start: 0, maxLength: BRON_BEGIN } }, { uid: true });
  } finally {
    lock.release();
  }
  for (const m of bronnen) {
    if (!m.source) continue;
    try {
      const mail = await simpleParser(m.source, { skipTextToHtml: true, skipImageLinks: true, maxInlinedImagesSize: 0 });
      uit.set(m.uid, (mail.text ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEKST));
    } catch {
      // Onleesbaar bericht: zonder tekst tonen.
    }
  }
  return uit;
}

/**
 * Alle andere berichten uit het gesprek van `uid` in `map`, oud → nieuw. Het bericht zelf
 * zit er niet in. Dubbelen (zelfde Message-ID in inbox én archief) komen één keer terug.
 */
export async function haalGesprek(client: ImapFlow, map: string, uid: number): Promise<GesprekBericht[]> {
  let kop: FetchMessageObject | false;
  const lock = await client.getMailboxLock(map, { readOnly: true });
  try {
    kop = await client.fetchOne(String(uid), { uid: true, envelope: true, headers: ['message-id', 'in-reply-to', 'references'] }, { uid: true });
  } finally {
    lock.release();
  }
  if (!kop) throw new MailFout(404, 'niet_gevonden', 'Dit bericht bestaat niet meer (verplaatst of verwijderd).');

  const k = kopWaarden(kop.headers);
  const eigenId = kop.envelope?.messageId ?? ids(k['message-id'])[0] ?? null;
  const verwijzingen = [...ids(k.references), ...ids(k['in-reply-to'])];
  const alle = [...new Set([...verwijzingen, ...(eigenId ? [eigenId] : [])])];
  if (!alle.length) return [];
  // De wortel (eerste in References) vindt ook "zijtakken"; daarna de dichtstbijzijnde.
  const zoekIds = [...new Set([alle[0], ...alle.slice(-(MAX_IDS - 1))])];

  const mappen = await lijstMappen(client);
  const doel = [
    map,
    ...mappen.filter((m) => m.rol === 'inbox' || m.rol === 'verzonden' || m.rol === 'archief').map((m) => m.pad)
  ];
  const teZoeken = [...new Set(doel)];

  const treffers: Treffer[] = [];
  for (const pad of teZoeken) {
    try {
      treffers.push(...(await zoekInMap(client, pad, zoekIds)));
    } catch {
      // Een map die niet te doorzoeken is (rechten, server zonder HEADER-zoeken) slaan we over.
    }
  }

  const gezien = new Set<string>();
  if (eigenId) gezien.add(eigenId);
  const uniek: Treffer[] = [];
  for (const t of treffers) {
    if (t.map === map && t.m.uid === uid) continue;
    const sleutel = t.messageId ?? `${t.map}:${t.m.uid}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    uniek.push(t);
  }

  const datum = (t: Treffer) => isoDatum(t.m.envelope?.date) ?? isoDatum(t.m.internalDate) ?? '';
  const gekozen = uniek.sort((a, b) => datum(b).localeCompare(datum(a))).slice(0, MAX_BERICHTEN);

  const perMap = new Map<string, Map<number, string>>();
  for (const pad of new Set(gekozen.map((t) => t.map))) {
    const uids = gekozen.filter((t) => t.map === pad).map((t) => t.m.uid);
    perMap.set(pad, await teksten(client, pad, uids).catch(() => new Map<number, string>()));
  }

  const uit: GesprekBericht[] = [];
  for (const t of gekozen) {
    const env = t.m.envelope;
    const { tekst, citaat } = splitsCitaat(perMap.get(t.map)?.get(t.m.uid) ?? '');
    uit.push({
      map: t.map,
      uid: t.m.uid,
      van: adres(env?.from?.[0]),
      aan: (env?.to ?? []).map(adres).filter((a): a is Adres => a !== null),
      onderwerp: (env?.subject || '').trim(),
      datum: datum(t) || null,
      tekst,
      citaat,
      bijlagen: bijlagenUitStructuur(t.m.bodyStructure),
      verzonden: mappen.find((m) => m.pad === t.map)?.rol === 'verzonden'
    });
  }
  return uit.sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''));
}
