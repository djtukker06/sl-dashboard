// De pure kern van de Scratchpad (migratie 0031): invoer controleren, de Tiptap-inhoud
// opschonen, platte tekst maken, zoeken, filteren en sorteren. Zonder imports (alleen
// types), zodat scripts/test-notities.mjs dit bestand direct laadt, en zowel de API als de
// browser het gebruiken. De API vertrouwt niets van de client; de database controleert
// daarnaast zelf (RLS, check-constraints).

export type Resultaat<T> = { ok: true; waarde: T } | { ok: false; fout: string };

export const TITEL_MAX = 200;
export const EMOJI_MAX = 16;
/** Maximale grootte van de Tiptap-JSON (zelfde grens als de check in de database). */
export const INHOUD_MAX_BYTES = 1_048_576;
export const TEKST_MAX = 200_000;
const MAX_DIEPTE = 40;
const MAX_KNOPEN = 60_000;

// ---------------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------------

/** Een knoop in Tiptap/ProseMirror-JSON. */
export interface TiptapKnoop {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapKnoop[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export type NotitieFilter = 'alles' | 'mijn' | 'klant' | 'project' | 'prive';
export const NOTITIE_FILTERS: NotitieFilter[] = ['alles', 'mijn', 'klant', 'project', 'prive'];
export const FILTER_LABEL: Record<NotitieFilter, string> = {
  alles: 'Alles',
  mijn: 'Mijn',
  klant: 'Klant',
  project: 'Project',
  prive: 'Privé'
};

/** Een notitie in een lijst (zonder de volledige inhoud). */
export interface NotitieSamenvatting {
  id: string;
  titel: string;
  emoji: string | null;
  /** Begin van de platte tekst (max. 240 tekens). */
  fragment: string;
  klant: { id: string; naam: string; lead: boolean } | null;
  project: { id: string; naam: string } | null;
  prive: boolean;
  vastgepind: boolean;
  gemaaktDoor: string | null;
  bewerktDoor: string | null;
  gemaaktOp: string;
  bewerktOp: string;
}

/** Een volledige notitie (voor de editor). */
export interface Notitie extends NotitieSamenvatting {
  inhoud: TiptapKnoop;
}

/** Body van POST/PATCH /api/notities. Alles optioneel. */
export interface NotitieInvoer {
  titel?: unknown;
  emoji?: unknown;
  inhoud?: unknown;
  klantId?: unknown;
  projectId?: unknown;
  prive?: unknown;
  vastgepind?: unknown;
  /** false = een zacht verwijderde notitie terugzetten (ongedaan maken). */
  verwijderd?: unknown;
  /** bewerktOp zoals de client hem kent: is de notitie intussen door een ander gewijzigd,
   *  dan weigert de API (409) in plaats van diens werk te overschrijven. */
  sinds?: unknown;
}

/** Kolommen van public.notities die de API mag schrijven. */
export interface NotitieRij {
  titel?: string;
  emoji?: string | null;
  inhoud?: TiptapKnoop;
  inhoud_tekst?: string;
  client_id?: string | null;
  project_id?: string | null;
  prive?: boolean;
  vastgepind?: boolean;
  verwijderd_op?: string | null;
}

export const LEGE_INHOUD: TiptapKnoop = { type: 'doc', content: [{ type: 'paragraph' }] };


// ---------------------------------------------------------------------------------
// Bijlagen (migratie 0032)
// ---------------------------------------------------------------------------------
// Een bestand staat in de privé-bucket "notities" onder <notitie-id>/<ts>-<hex>-<naam>.<ext>;
// in de tekst staat alleen de eigen route /api/notities/<notitie-id>/bestanden/<bestand-id>.

export const MAX_BIJLAGE_BYTES = 25 * 1024 * 1024;
export const MAX_BIJLAGE_MB = 25;

/** Een geüploade bijlage, zoals de API hem teruggeeft. */
export interface Bijlage {
  id: string;
  url: string;
  naam: string;
  type: string;
  grootte: number;
  afbeelding: boolean;
}

const UUID_DEEL = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BIJLAGE_URL = new RegExp(`^/api/notities/${UUID_DEEL}/bestanden/${UUID_DEEL}$`, 'i');

/** Foto's die de browser zelf kan tonen (de rest wordt een bestandskaartje). */
const AFBEELDINGEN = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export function isAfbeelding(type: string): boolean {
  return AFBEELDINGEN.has(type.toLowerCase());
}

export function bijlageUrl(notitieId: string, bestandId: string): string {
  return `/api/notities/${notitieId}/bestanden/${bestandId}`;
}

/** Alleen verwijzingen naar onze eigen bijlage-route (geen externe afbeeldingen of data:). */
export function isBijlageUrl(v: unknown): v is string {
  return typeof v === 'string' && BIJLAGE_URL.test(v);
}

/** Bestandsnaam zonder pad- en stuurtekens, max. 200 tekens. */
export function schoonBestandsnaam(naam: unknown): string {
  const n = String(naam ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f<>"]+/g, '')
    .trim()
    .slice(0, 200);
  return n || 'bestand';
}

/** MIME-type zoals de browser hem geeft; onbekend of vreemd = application/octet-stream. */
export function schoonType(type: unknown): string {
  const t = String(type ?? '').toLowerCase().trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]{1,100}$/.test(t) ? t : 'application/octet-stream';
}

function bijlageSlug(s: string, max: number): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max) || 'bestand'
  );
}

/** Pad in de bucket voor een nieuw bestand; `rnd` = 8 hex-tekens (van de server). */
export function bijlagePad(notitieId: string, naam: string, ts: number, rnd: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(naam);
  const ext = m ? m[1].toLowerCase() : 'bin';
  const basis = bijlageSlug(m ? naam.slice(0, -m[0].length) : naam, 40);
  return `${notitieId}/${ts}-${rnd}-${basis}.${ext}`;
}

/** Klopt een pad (terug van de browser) met bijlagePad voor deze notitie? */
export function isBijlagePadVan(notitieId: string, pad: unknown): pad is string {
  if (typeof pad !== 'string' || pad.length > 300) return false;
  const [map, bestand, ...rest] = pad.split('/');
  return map === notitieId && rest.length === 0 && /^\d{10,16}-[0-9a-f]{8}-[a-z0-9-]{1,40}\.[a-z0-9]{1,8}$/.test(bestand ?? '');
}

/** "2,4 MB" / "380 kB" / "12 bytes". */
export function leesbareGrootte(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

// ---------------------------------------------------------------------------------
// Inhoud opschonen: alleen bekende knopen, marks en attributen
// ---------------------------------------------------------------------------------
// De editor toont alleen wat zijn schema kent; een onbekende knoop zou Tiptap de hele inhoud
// laten weggooien (en de volgende autosave zou dat opslaan). Daarom gaat er alleen bekende
// inhoud de database in. Links: alleen http(s), mailto, tel of een eigen pad.

const BLOK_ATTRS: Record<string, (a: Record<string, unknown>) => Record<string, unknown> | undefined> = {
  doc: () => undefined,
  paragraph: () => undefined,
  text: () => undefined,
  heading: (a) => ({ level: Math.min(3, Math.max(1, Math.round(Number(a.level) || 1))) }),
  bulletList: () => undefined,
  orderedList: (a) => {
    const start = Math.round(Number(a.start));
    return Number.isFinite(start) && start >= 0 && start <= 100_000 && start !== 1 ? { start } : undefined;
  },
  listItem: () => undefined,
  taskList: () => undefined,
  taskItem: (a) => ({ checked: a.checked === true }),
  blockquote: () => undefined,
  codeBlock: (a) => (typeof a.language === 'string' && /^[a-z0-9+#.-]{1,32}$/i.test(a.language) ? { language: a.language } : undefined),
  horizontalRule: () => undefined,
  hardBreak: () => undefined,
  // Bijlagen (0032): alleen verwijzingen naar de eigen bijlage-route, anders valt de knoop weg.
  image: (a) =>
    isBijlageUrl(a.src)
      ? { src: a.src, alt: typeof a.alt === 'string' && a.alt ? a.alt.slice(0, 200) : null, width: maat(a.width), height: maat(a.height) }
      : undefined,
  bijlage: (a) =>
    isBijlageUrl(a.src)
      ? {
          src: a.src,
          naam: schoonBestandsnaam(a.naam),
          type: schoonType(a.type),
          grootte: Number.isFinite(Number(a.grootte)) && Number(a.grootte) >= 0 ? Math.round(Number(a.grootte)) : 0
        }
      : undefined
};

/** Breedte/hoogte van een verkleinde foto in pixels, of null. */
function maat(v: unknown): number | null {
  const n = Math.round(Number(v));
  return v !== null && v !== undefined && Number.isFinite(n) && n >= 16 && n <= 4000 ? n : null;
}

/** Knopen zonder inhoud (atomen). */
const ATOMEN = new Set(['horizontalRule', 'hardBreak', 'image', 'bijlage']);

const MARKS = new Set(['bold', 'italic', 'strike', 'code', 'underline', 'link']);

/** Veilige link: http(s), mailto, tel of een eigen pad ("/klanten/…", niet "//host"). */
export function veiligeLink(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  if (!h || h.length > 2000) return null;
  if (/^\/(?!\/)/.test(h)) return h;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(h) && !/[\s<>"]/.test(h)) return h;
  return null;
}

function schoonMarks(marks: unknown): TiptapKnoop['marks'] | undefined {
  if (!Array.isArray(marks)) return undefined;
  const uit: NonNullable<TiptapKnoop['marks']> = [];
  const gezien = new Set<string>();
  for (const m of marks) {
    if (!m || typeof m !== 'object') continue;
    const type = (m as { type?: unknown }).type;
    if (typeof type !== 'string' || !MARKS.has(type) || gezien.has(type)) continue;
    gezien.add(type);
    if (type === 'link') {
      const href = veiligeLink((m as { attrs?: Record<string, unknown> }).attrs?.href);
      if (!href) continue;
      uit.push({ type, attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } });
    } else {
      uit.push({ type });
    }
  }
  return uit.length ? uit : undefined;
}

function schoonKnoop(k: unknown, diepte: number, teller: { n: number }): TiptapKnoop | null {
  if (!k || typeof k !== 'object' || Array.isArray(k)) return null;
  if (diepte > MAX_DIEPTE || ++teller.n > MAX_KNOPEN) return null;
  const ruw = k as Record<string, unknown>;
  const type = ruw.type;
  if (typeof type !== 'string' || !Object.hasOwn(BLOK_ATTRS, type) || type === 'doc') return null;

  if (type === 'text') {
    if (typeof ruw.text !== 'string' || ruw.text.length === 0) return null;
    const uit: TiptapKnoop = { type, text: ruw.text };
    const marks = schoonMarks(ruw.marks);
    if (marks) uit.marks = marks;
    return uit;
  }

  const uit: TiptapKnoop = { type };
  const attrs = BLOK_ATTRS[type](ruw.attrs && typeof ruw.attrs === 'object' ? (ruw.attrs as Record<string, unknown>) : {});
  if (attrs) uit.attrs = attrs;
  else if (type === 'image' || type === 'bijlage') return null;
  if (Array.isArray(ruw.content) && !ATOMEN.has(type)) {
    const kinderen = ruw.content.map((c) => schoonKnoop(c, diepte + 1, teller)).filter((c): c is TiptapKnoop => c !== null);
    if (kinderen.length) uit.content = kinderen;
  }
  // Een lijst(item) zonder inhoud is ongeldig in het schema: weglaten.
  if (['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote'].includes(type) && !uit.content) return null;
  return uit;
}

/** Schoont Tiptap-JSON op tot een geldig document met alleen bekende inhoud; null = geen document. */
export function schoonInhoud(doc: unknown): TiptapKnoop | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || (doc as { type?: unknown }).type !== 'doc') return null;
  const teller = { n: 0 };
  const ruw = (doc as { content?: unknown }).content;
  const content = Array.isArray(ruw) ? ruw.map((c) => schoonKnoop(c, 1, teller)).filter((c): c is TiptapKnoop => c !== null && c.type !== 'text') : [];
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** JSON met gesorteerde sleutels (de database, jsonb, geeft ze in een andere volgorde terug). */
function vasteJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(vasteJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${vasteJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Zelfde inhoud? Beide eerst opgeschoond: de editor geeft extra attributen (bv. language:
 * null) en de database een andere sleutelvolgorde, terwijl de tekst gelijk is.
 */
export function zelfdeInhoud(a: unknown, b: unknown): boolean {
  return vasteJson(schoonInhoud(a)) === vasteJson(schoonInhoud(b));
}

// ---------------------------------------------------------------------------------
// Platte tekst (zoeken, fragmenten)
// ---------------------------------------------------------------------------------
const INLINE = new Set(['text', 'hardBreak']);

/** Platte tekst van een document: elk blok op een eigen regel, afvinkpunten als "[x] ". */
export function platteTekst(doc: TiptapKnoop | null | undefined): string {
  const regels: string[] = [];
  let huidig = '';
  const loop = (k: TiptapKnoop, diepte: number) => {
    if (diepte > MAX_DIEPTE) return;
    if (k.type === 'text') {
      huidig += k.text ?? '';
      return;
    }
    if (k.type === 'hardBreak') {
      huidig += '\n';
      return;
    }
    if (k.type === 'horizontalRule') {
      if (huidig) regels.push(huidig);
      huidig = '';
      return;
    }
    if (k.type === 'bijlage') {
      // De bestandsnaam telt mee bij het zoeken.
      if (huidig) regels.push(huidig);
      regels.push(String(k.attrs?.naam ?? ''));
      huidig = '';
      return;
    }
    if (k.type === 'taskItem') huidig += k.attrs?.checked ? '[x] ' : '[ ] ';
    const blok = !INLINE.has(k.type) && k.type !== 'doc';
    for (const c of k.content ?? []) loop(c, diepte + 1);
    if (blok && huidig) {
      regels.push(huidig);
      huidig = '';
    }
  };
  if (doc) loop(doc, 0);
  if (huidig) regels.push(huidig);
  return regels
    .map((r) => r.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, TEKST_MAX);
}

/** Korte voorvertoning: witruimte samengevoegd, op een woordgrens afgekapt. */
export function maakFragment(tekst: string, max = 160): string {
  const t = tekst.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const kap = t.slice(0, max);
  const spatie = kap.lastIndexOf(' ');
  return `${(spatie > max * 0.6 ? kap.slice(0, spatie) : kap).replace(/[\s.,;:–-]+$/, '')}…`;
}

// ---------------------------------------------------------------------------------
// Invoer controleren
// ---------------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Eén emoji (met huidskleur, ZWJ-reeksen en vlaggen); geen tekst, geen HTML. */
export function isEmoji(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length > 0 &&
    s.length <= EMOJI_MAX &&
    /^[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}‍️⃣#*0-9]+$/u.test(s) &&
    /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(s)
  );
}

/** Titel: één regel, witruimte aan de randen weg, max. 200 tekens. */
export function schoonTitel(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, TITEL_MAX);
}

/** Grootte van de JSON in bytes (UTF-8), zonder Buffer (werkt ook in de browser). */
export function jsonBytes(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}

/**
 * Controleert de body van POST (nieuw = true) of PATCH. Alleen meegestuurde velden komen in
 * de rij; inhoud wordt opgeschoond en krijgt meteen de platte tekst erbij.
 */
export function parseNotitie(b: NotitieInvoer, nieuw: boolean): Resultaat<NotitieRij> {
  const rij: NotitieRij = {};
  if (b.titel !== undefined) {
    if (typeof b.titel !== 'string') return { ok: false, fout: 'Ongeldige titel.' };
    if (b.titel.length > TITEL_MAX * 4) return { ok: false, fout: 'De titel is te lang (max. 200 tekens).' };
    rij.titel = schoonTitel(b.titel);
  }
  if (b.emoji !== undefined) {
    if (b.emoji === null || b.emoji === '') rij.emoji = null;
    else if (isEmoji(b.emoji)) rij.emoji = b.emoji;
    else return { ok: false, fout: 'Kies één emoji als icoon.' };
  }
  if (b.inhoud !== undefined) {
    const doc = schoonInhoud(b.inhoud);
    if (!doc) return { ok: false, fout: 'Ongeldige inhoud.' };
    if (jsonBytes(doc) > INHOUD_MAX_BYTES) return { ok: false, fout: 'Deze notitie is te groot (max. ±1 MB). Splits hem in twee.' };
    rij.inhoud = doc;
    rij.inhoud_tekst = platteTekst(doc);
  }
  for (const [veld, kolom] of [
    ['klantId', 'client_id'],
    ['projectId', 'project_id']
  ] as const) {
    const v = b[veld];
    if (v === undefined) continue;
    if (v !== null && v !== '' && !isUuid(v)) return { ok: false, fout: veld === 'klantId' ? 'Ongeldige klant.' : 'Ongeldig project.' };
    rij[kolom] = v ? (v as string) : null;
  }
  for (const veld of ['prive', 'vastgepind'] as const) {
    const v = b[veld];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') return { ok: false, fout: 'Ongeldige invoer.' };
    rij[veld] = v;
  }
  if (b.verwijderd !== undefined) {
    if (nieuw || b.verwijderd !== false) return { ok: false, fout: 'Verwijderen gaat via DELETE.' };
    rij.verwijderd_op = null;
  }
  if (!nieuw && Object.keys(rij).length === 0) return { ok: false, fout: 'Niets te wijzigen.' };
  return { ok: true, waarde: rij };
}

/** Het meegestuurde "sinds" (ISO-tijd) of null. */
export function parseSinds(v: unknown): string | null {
  return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null;
}

// ---------------------------------------------------------------------------------
// Zoeken, filteren en sorteren
// ---------------------------------------------------------------------------------

/** Kleine letters, zonder accenten ("Ideeën" → "ideeen"). */
export function normaliseer(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Zoektermen uit een zoekopdracht (max. 6, elk max. 40 tekens). */
export function zoekTermen(q: string): string[] {
  return normaliseer(q)
    .split(/\s+/)
    .map((t) => t.slice(0, 40))
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * Termen die veilig in een PostgREST-filter (ilike binnen or=(…)) passen: alleen letters,
 * cijfers en een paar leestekens; jokertekens en scheidingstekens vallen weg.
 */
export function dbZoekTermen(q: string): string[] {
  return q
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}@.\-]/gu, '').slice(0, 40))
    .filter((t) => t.length > 0)
    .slice(0, 6);
}

/** Past de notitie bij de zoekopdracht? Elke term moet in titel, tekst, klant of project staan. */
export function pastBijZoek(n: Pick<NotitieSamenvatting, 'titel' | 'fragment' | 'klant' | 'project'> & { tekst?: string }, q: string): boolean {
  const termen = zoekTermen(q);
  if (!termen.length) return true;
  const hooi = normaliseer([n.titel, n.tekst ?? n.fragment, n.klant?.naam ?? '', n.project?.naam ?? ''].join(' '));
  return termen.every((t) => hooi.includes(t));
}

export function pastBijFilter(n: Pick<NotitieSamenvatting, 'gemaaktDoor' | 'klant' | 'project' | 'prive'>, filter: NotitieFilter, mijnId: string): boolean {
  switch (filter) {
    case 'mijn':
      return n.gemaaktDoor === mijnId;
    case 'klant':
      return n.klant !== null;
    case 'project':
      return n.project !== null;
    case 'prive':
      return n.prive;
    default:
      return true;
  }
}

/** Vastgepind eerst, daarna laatst bewerkt bovenaan (bij gelijke tijd: op id, stabiel). */
export function sorteerNotities<T extends Pick<NotitieSamenvatting, 'vastgepind' | 'bewerktOp' | 'id'>>(lijst: T[]): T[] {
  return [...lijst].sort(
    (a, b) =>
      Number(b.vastgepind) - Number(a.vastgepind) ||
      Date.parse(b.bewerktOp) - Date.parse(a.bewerktOp) ||
      a.id.localeCompare(b.id)
  );
}

/** Weergavetitel: de titel, anders de eerste regel van de tekst, anders "Naamloos". */
export function weergaveTitel(n: Pick<NotitieSamenvatting, 'titel' | 'fragment'>): string {
  if (n.titel.trim()) return n.titel.trim();
  return 'Naamloos';
}
