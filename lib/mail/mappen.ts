import type { ImapFlow, ListResponse } from 'imapflow';
import { MailFout } from './fout';
import type { MailMap, MapRol } from './types';

// Mappen herkennen: eerst via de special-use-vlag die de server meegeeft (\Sent, \Trash,
// \Junk, \Drafts, \Archive), daarna op naam (Sent, Trash, Spam, …).

const ROL_VOOR_VLAG: Record<string, MapRol> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'verzonden',
  '\\Drafts': 'concepten',
  '\\Archive': 'archief',
  '\\Junk': 'spam',
  '\\Trash': 'prullenbak'
};

const ROL_VOOR_NAAM: [RegExp, MapRol][] = [
  [/^inbox$/i, 'inbox'],
  [/^(sent|sent items|sent messages|verzonden|verzonden items)$/i, 'verzonden'],
  [/^(drafts|concepten)$/i, 'concepten'],
  [/^(archive|archief|archives)$/i, 'archief'],
  [/^(spam|junk|junk e-mail|ongewenste e-mail)$/i, 'spam'],
  [/^(trash|deleted items|deleted messages|bin|prullenbak|verwijderde items)$/i, 'prullenbak']
];

export const ROL_NAAM: Record<MapRol, string> = {
  inbox: 'Inbox',
  verzonden: 'Verzonden',
  concepten: 'Concepten',
  archief: 'Archief',
  spam: 'Spam',
  prullenbak: 'Prullenbak',
  overig: ''
};

const VOLGORDE: MapRol[] = ['inbox', 'verzonden', 'concepten', 'archief', 'spam', 'prullenbak', 'overig'];

function rolVan(m: ListResponse): MapRol {
  if (m.path.toUpperCase() === 'INBOX') return 'inbox';
  if (m.specialUse && ROL_VOOR_VLAG[m.specialUse]) return ROL_VOOR_VLAG[m.specialUse];
  for (const [re, rol] of ROL_VOOR_NAAM) if (re.test(m.name)) return rol;
  return 'overig';
}

function selecteerbaar(m: ListResponse): boolean {
  return !m.flags.has('\\Noselect') && !m.flags.has('\\NonExistent');
}

/** Alle selecteerbare mappen, in een vaste volgorde. Met `status` ook de aantallen. */
export async function lijstMappen(client: ImapFlow, opties: { status?: boolean } = {}): Promise<MailMap[]> {
  const lijst = await client.list(
    opties.status ? { statusQuery: { messages: true, unseen: true } } : undefined
  );
  const gezien = new Set<MapRol>();
  const mappen: MailMap[] = lijst.filter(selecteerbaar).map((m) => {
    let rol = rolVan(m);
    // Elke speciale rol maar één keer (de eerste wint, special-use gaat voor naam).
    if (rol !== 'overig' && gezien.has(rol)) rol = 'overig';
    if (rol !== 'overig') gezien.add(rol);
    const niveau = m.path.toUpperCase().startsWith('INBOX' + m.delimiter) ? Math.max(0, m.parent.length - 1) : m.parent.length;
    return {
      pad: m.path,
      naam: rol === 'overig' ? m.name : ROL_NAAM[rol],
      rol,
      ongelezen: m.status?.unseen ?? 0,
      totaal: m.status?.messages ?? 0,
      niveau
    };
  });
  return mappen.sort((a, b) => {
    const d = VOLGORDE.indexOf(a.rol) - VOLGORDE.indexOf(b.rol);
    return d !== 0 ? d : a.pad.localeCompare(b.pad, 'nl');
  });
}

/** Controleert een mappad uit de URL tegen de LIST-uitkomst (geen vrije invoer naar IMAP). */
export async function controleerMap(client: ImapFlow, pad: string | null | undefined): Promise<MailMap> {
  const p = String(pad ?? '').trim() || 'INBOX';
  if (p.length > 300) throw new MailFout(400, 'ongeldig', 'Ongeldige map.');
  const mappen = await lijstMappen(client);
  const hit = mappen.find((m) => m.pad === p) ?? (p.toUpperCase() === 'INBOX' ? mappen.find((m) => m.rol === 'inbox') : undefined);
  if (!hit) throw new MailFout(404, 'niet_gevonden', 'Deze map bestaat niet (meer).');
  return hit;
}

/** Pad van de map met deze rol, of null. Archief wordt zo nodig aangemaakt. */
export async function mapVoorRol(client: ImapFlow, rol: MapRol, aanmaken = false): Promise<string | null> {
  const mappen = await lijstMappen(client);
  const hit = mappen.find((m) => m.rol === rol);
  if (hit) return hit.pad;
  if (!aanmaken) return null;
  const naam = rol === 'archief' ? 'Archive' : rol === 'verzonden' ? 'Sent' : rol === 'prullenbak' ? 'Trash' : null;
  if (!naam) return null;
  const res = await client.mailboxCreate(naam);
  return res.path;
}

/** uid uit de URL: positief geheel getal. */
export function parseUid(waarde: string | null | undefined): number {
  const n = Number(waarde);
  if (!Number.isInteger(n) || n <= 0 || n > 4294967295) throw new MailFout(400, 'ongeldig', 'Ongeldig bericht.');
  return n;
}
