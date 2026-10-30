// De kern van de Google Drive-koppeling: alles wat geen env, database of '@/'-imports
// nodig heeft (zodat scripts/test-drive.mjs het los kan testen, met een nagebootste fetch).
//   - namen en paden van de mappen (Boekhouding/Factuur, Klanten/<klant>/<project>);
//   - Drive-zoekopdrachten (q) veilig opbouwen;
//   - OAuth: de autorisatie-URL, code inwisselen, token vernieuwen, intrekken;
//   - DriveClient: de paar Drive REST v3-aanroepen die we nodig hebben, rechtstreeks via
//     fetch (geen googleapis-dependency). Bij een 401 één keer een vers token proberen.
// De server-kant (env, sleutel, database, cache) staat in lib/drive/koppeling.ts.

export const SCOPE = 'https://www.googleapis.com/auth/drive';
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const DRIVE_URL = 'https://www.googleapis.com/drive/v3';
export const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';
export const MAP_MIME = 'application/vnd.google-apps.folder';

/** Naam van de rootmap in de Drive van Studio Levant. */
export const ROOT_NAAM = 'Studio Levant';
export const BOEKHOUDING = 'Boekhouding';
export const KLANTEN = 'Klanten';
export const ALGEMEEN = 'Algemeen';
export const ZONDER_KLANT = 'Zonder klant';
/** De vaste mappen direct onder de root (worden bij het koppelen aangemaakt). */
export const VASTE_MAPPEN = [BOEKHOUDING, KLANTEN, ALGEMEEN] as const;

export type KopieSoort = 'factuur' | 'prijsopgave' | 'bonnetje';
const BOEKHOUD_MAP: Record<KopieSoort, string> = {
  factuur: 'Factuur',
  prijsopgave: 'Prijsopgaven',
  bonnetje: 'Bonnetjes'
};

// ---------------------------------------------------------------------------------
// Namen en paden
// ---------------------------------------------------------------------------------

/**
 * Een bruikbare map- of bestandsnaam: stuurtekens eruit, schuine strepen (verwarrend in een
 * pad) en tekens die Windows/macOS niet toestaan vervangen door een streepje, witruimte
 * samengevoegd, max. `max` tekens. Leeg → terugval.
 */
export function schoneNaam(naam: unknown, terugval = 'Naamloos', max = 120): string {
  const s = typeof naam === 'string' ? naam : '';
  const zonder = [...s]
    .filter((t) => {
      const c = t.codePointAt(0) ?? 0;
      return c >= 0x20 && c !== 0x7f && !(c >= 0x80 && c < 0xa0);
    })
    .join('');
  const schoon = zonder
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim();
  return schoon || terugval;
}

/** Het jaar (Europe/Amsterdam) van een datum of ISO-tekst; ongeldig → huidig jaar. */
export function jaarVan(datum: string | Date | null | undefined, nu: Date = new Date()): string {
  if (typeof datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(datum)) return datum.slice(0, 4);
  const d = datum instanceof Date ? datum : datum ? new Date(datum) : nu;
  const geldig = Number.isNaN(d.getTime()) ? nu : d;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric' }).format(geldig);
}

/** De dag (YYYY-MM-DD, Europe/Amsterdam) van een datum of ISO-tekst. */
export function dagVan(datum: string | Date | null | undefined, nu: Date = new Date()): string {
  if (typeof datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(datum)) return datum;
  const d = datum instanceof Date ? datum : datum ? new Date(datum) : nu;
  const geldig = Number.isNaN(d.getTime()) ? nu : d;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(geldig);
}

/**
 * Boekhouding/Factuur (alle jaren in één map, zoals het archief daar al stond), en
 * Boekhouding/Prijsopgaven/2026 en Boekhouding/Bonnetjes/2026, als lijst mapnamen onder de root.
 */
export function boekhoudPad(soort: KopieSoort, jaar: string): string[] {
  if (soort === 'factuur') return [BOEKHOUDING, BOEKHOUD_MAP.factuur];
  return [BOEKHOUDING, BOEKHOUD_MAP[soort], /^\d{4}$/.test(jaar) ? jaar : 'Onbekend jaar'];
}

/** Klanten/<klantnaam> */
export function klantPad(klantNaam: string): string[] {
  return [KLANTEN, schoneNaam(klantNaam, 'Naamloze klant')];
}

/** Klanten/<klantnaam>/<projectnaam>, of Klanten/Zonder klant/<projectnaam>. */
export function projectPad(klantNaam: string | null | undefined, projectNaam: string): string[] {
  const klant = klantNaam && klantNaam.trim() ? schoneNaam(klantNaam, 'Naamloze klant') : ZONDER_KLANT;
  return [KLANTEN, klant, schoneNaam(projectNaam, 'Naamloos project')];
}

/** Sleutel van een pad in de mappen-cache: 'Boekhouding/Facturen/2026'. */
export function padSleutel(pad: string[]): string {
  return pad.join('/');
}

/** Bestandsnaam van een bonnetje in Drive: "2026-03-14 bonnetje.jpg". */
/**
 * Zet het factuur-/offertenummer vóór een bestandsnaam als het er nog niet in staat:
 * ("Website.pdf", "2026-014") → "2026-014 Website.pdf". Zo zijn facturen met dezelfde
 * omschrijving in de jaarmap uit elkaar te houden. Zonder nummer: ongewijzigd.
 */
export function metNummer(bestandsnaam: string, nummer: string | null | undefined): string {
  const n = schoneNaam(String(nummer ?? ''), '', 60);
  if (!n || bestandsnaam.toLowerCase().includes(n.toLowerCase())) return bestandsnaam;
  return `${n} ${bestandsnaam}`;
}

export function bonnetjeNaam(dag: string, bestandsnaam: string): string {
  const naam = schoneNaam(bestandsnaam, 'bonnetje', 180);
  return /^\d{4}-\d{2}-\d{2}$/.test(dag) && !naam.startsWith(dag) ? `${dag} ${naam}` : naam;
}

// ---------------------------------------------------------------------------------
// Drive-zoekopdrachten (q)
// ---------------------------------------------------------------------------------

/** Een tekst als letterlijke waarde in een q-query: '…' met \ en ' ge-escaped. */
export function qTekst(waarde: string): string {
  return `'${String(waarde).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Drive-id's bestaan uit letters, cijfers, - en _. Alles anders weigeren we meteen. */
export function isDriveId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{5,200}$/.test(v);
}

export function qKinderen(ouderId: string): string {
  if (!isDriveId(ouderId) && ouderId !== 'root') throw new Error('Ongeldige map-id.');
  return `${qTekst(ouderId)} in parents and trashed = false`;
}

export function qMapMetNaam(ouderId: string, naam: string): string {
  return `${qKinderen(ouderId)} and mimeType = ${qTekst(MAP_MIME)} and name = ${qTekst(naam)}`;
}

/** Zoeken op naam (en inhoud, voor documenten die Drive indexeert). */
export function qZoeken(term: string): string {
  const t = term.replace(/\s+/g, ' ').trim().slice(0, 100);
  return `(name contains ${qTekst(t)} or fullText contains ${qTekst(t)}) and trashed = false`;
}

// ---------------------------------------------------------------------------------
// Fouten
// ---------------------------------------------------------------------------------
export type DriveFoutCode =
  | 'niet_ingericht' // env ontbreekt (GOOGLE_CLIENT_ID/SECRET of sleutel)
  | 'tabel_ontbreekt' // migratie 0024 nog niet uitgevoerd
  | 'niet_gekoppeld' // nog geen koppeling
  | 'opnieuw_koppelen' // toestemming ingetrokken / token ongeldig (invalid_grant)
  | 'niet_gevonden'
  | 'buiten_root' // bestand/map hoort niet bij de map "Studio Levant"
  | 'beschermd' // vaste map: niet hernoemen/verwijderen
  | 'ongeldig'
  | 'vol' // opslag van Google vol
  | 'google'; // overige fout van Google

const STATUS: Record<DriveFoutCode, number> = {
  niet_ingericht: 503,
  tabel_ontbreekt: 503,
  niet_gekoppeld: 409,
  opnieuw_koppelen: 409,
  niet_gevonden: 404,
  buiten_root: 404,
  beschermd: 400,
  ongeldig: 400,
  vol: 507,
  google: 502
};

export class DriveFout extends Error {
  code: DriveFoutCode;
  status: number;
  /**
   * Technische oorzaak voor de logs en de diagnose van de eigenaar (bv. "HTTP 403
   * rateLimitExceeded: …"); nooit tokens. De gewone melding blijft voor iedereen kort.
   */
  detail: string;
  constructor(code: DriveFoutCode, bericht: string, detail = '') {
    super(bericht);
    this.code = code;
    this.status = STATUS[code];
    this.detail = detail.slice(0, 300);
  }
}

/** Eén regel voor de logs: "code: melding (detail)". */
export function foutTekst(e: unknown): string {
  if (e instanceof DriveFout) return `${e.code}: ${e.message}${e.detail ? ` (${e.detail})` : ''}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

export const MELDING: Record<DriveFoutCode, string> = {
  niet_ingericht: 'Google Drive is nog niet ingericht op de server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en een sleutel ontbreken).',
  tabel_ontbreekt: 'Bestanden is nog niet ingericht: voer in Supabase supabase/UITVOEREN_0024.sql uit.',
  niet_gekoppeld: 'Google Drive is nog niet gekoppeld.',
  opnieuw_koppelen: 'De toegang tot Google Drive is verlopen of ingetrokken. Drive opnieuw koppelen.',
  niet_gevonden: 'Dit bestand of deze map bestaat niet (meer).',
  buiten_root: 'Dit bestand of deze map bestaat niet (meer).',
  beschermd: 'Deze map hoort bij de vaste mappenstructuur en kan niet worden hernoemd of verwijderd.',
  ongeldig: 'Ongeldige invoer.',
  vol: 'De opslag van Google Drive is vol.',
  google: 'Google Drive is even niet bereikbaar. Probeer het zo opnieuw.'
};

// ---------------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------------
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export function autorisatieUrl(o: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const p = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state: o.state
  });
  if (o.loginHint) p.set('login_hint', o.loginHint);
  return `${AUTH_URL}?${p.toString()}`;
}

async function tokenVerzoek(f: FetchFn, velden: Record<string, string>) {
  let res: Response;
  try {
    res = await f(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(velden).toString(),
      cache: 'no-store'
    });
  } catch (e) {
    throw new DriveFout('google', MELDING.google, `token-verzoek: netwerkfout ${(e as Error)?.message ?? ''}`.trim());
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // Alleen de foutcode en -omschrijving van Google, nooit de verzonden velden.
    const detail = `token-verzoek: HTTP ${res.status} ${String(data.error ?? '')} ${String(data.error_description ?? '')}`.trim();
    // invalid_grant: refresh token ingetrokken/verlopen (bij een app in "Testing" na 7 dagen),
    // of de code is al gebruikt.
    if (data.error === 'invalid_grant' || data.error === 'unauthorized_client') {
      throw new DriveFout('opnieuw_koppelen', MELDING.opnieuw_koppelen, detail);
    }
    if (data.error === 'invalid_client') throw new DriveFout('niet_ingericht', 'GOOGLE_CLIENT_ID of GOOGLE_CLIENT_SECRET klopt niet.', detail);
    throw new DriveFout('google', MELDING.google, detail);
  }
  return data;
}

/** Code uit de callback inwisselen voor tokens. */
export async function wisselCode(
  f: FetchFn,
  o: { clientId: string; clientSecret: string; code: string; redirectUri: string }
): Promise<{ accessToken: string; refreshToken: string | null; verlooptOver: number; scope: string }> {
  const d = await tokenVerzoek(f, {
    code: o.code,
    client_id: o.clientId,
    client_secret: o.clientSecret,
    redirect_uri: o.redirectUri,
    grant_type: 'authorization_code'
  });
  if (typeof d.access_token !== 'string') throw new DriveFout('google', MELDING.google);
  return {
    accessToken: d.access_token,
    refreshToken: typeof d.refresh_token === 'string' ? d.refresh_token : null,
    verlooptOver: typeof d.expires_in === 'number' ? d.expires_in : 3600,
    scope: typeof d.scope === 'string' ? d.scope : ''
  };
}

/** Een nieuw access token met het refresh token. */
export async function vernieuwToken(
  f: FetchFn,
  o: { clientId: string; clientSecret: string; refreshToken: string }
): Promise<{ accessToken: string; verlooptOver: number }> {
  const d = await tokenVerzoek(f, {
    refresh_token: o.refreshToken,
    client_id: o.clientId,
    client_secret: o.clientSecret,
    grant_type: 'refresh_token'
  });
  if (typeof d.access_token !== 'string') throw new DriveFout('google', MELDING.google);
  return { accessToken: d.access_token, verlooptOver: typeof d.expires_in === 'number' ? d.expires_in : 3600 };
}

/** Toestemming intrekken bij Google (best effort; fouten negeren). */
export async function trekIn(f: FetchFn, token: string): Promise<void> {
  try {
    await f(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      cache: 'no-store'
    });
  } catch {
    /* best effort */
  }
}

export function heeftDriveScope(scope: string): boolean {
  return scope.split(/\s+/).includes(SCOPE);
}

// ---------------------------------------------------------------------------------
// Drive REST v3
// ---------------------------------------------------------------------------------
export interface DriveBestand {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
  trashed?: boolean;
}

export const VELDEN = 'id,name,mimeType,size,modifiedTime,parents,webViewLink,trashed';

/** Haalt een (gecachet) access token op; `vers` = forceer een nieuw token (na een 401). */
export type TokenFn = (vers?: boolean) => Promise<string>;

export class DriveClient {
  private f: FetchFn;
  private token: TokenFn;

  constructor(f: FetchFn, token: TokenFn) {
    this.f = f;
    this.token = token;
  }

  /** Eén verzoek met Authorization; bij 401 één keer opnieuw met een vers token. */
  async verzoek(url: string, init: RequestInit = {}, opnieuw = true): Promise<Response> {
    const token = await this.token(!opnieuw);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    let res: Response;
    try {
      res = await this.f(url, { ...init, headers, cache: 'no-store' });
    } catch (e) {
      throw new DriveFout('google', MELDING.google, `netwerkfout ${(e as Error)?.message ?? ''}`.trim());
    }
    if (res.status === 401 && opnieuw) return this.verzoek(url, init, false);
    return res;
  }

  /** Verzoek met JSON-antwoord; zet Google-fouten om naar DriveFout. */
  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.verzoek(url, init);
    if (res.ok) return (res.status === 204 ? {} : await res.json()) as T;
    throw await DriveClient.fout(res);
  }

  static async fout(res: Response): Promise<DriveFout> {
    const data = (await res.json().catch(() => null)) as { error?: { errors?: { reason?: string }[]; message?: string } } | null;
    const reden = data?.error?.errors?.[0]?.reason ?? '';
    const detail = `HTTP ${res.status} ${reden}${data?.error?.message ? `: ${data.error.message}` : ''}`.trim();
    if (res.status === 404) return new DriveFout('niet_gevonden', MELDING.niet_gevonden, detail);
    if (res.status === 401) return new DriveFout('opnieuw_koppelen', MELDING.opnieuw_koppelen, detail);
    if (reden === 'storageQuotaExceeded') return new DriveFout('vol', MELDING.vol, detail);
    if (res.status === 403 && /insufficient(Permissions|FilePermissions)|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(`${reden} ${data?.error?.message ?? ''}`)) {
      return new DriveFout('opnieuw_koppelen', MELDING.opnieuw_koppelen, detail);
    }
    if (res.status === 400) return new DriveFout('ongeldig', MELDING.ongeldig, detail);
    return new DriveFout('google', MELDING.google, detail);
  }

  over(): Promise<{ user?: { emailAddress?: string; displayName?: string }; storageQuota?: { limit?: string; usage?: string } }> {
    return this.json(`${DRIVE_URL}/about?fields=${encodeURIComponent('user(emailAddress,displayName),storageQuota(limit,usage)')}`);
  }

  bestand(id: string, velden = VELDEN): Promise<DriveBestand> {
    if (!isDriveId(id)) throw new DriveFout('niet_gevonden', MELDING.niet_gevonden);
    return this.json(`${DRIVE_URL}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(velden)}`);
  }

  async lijst(q: string, o: { max?: number; orderBy?: string; velden?: string } = {}): Promise<DriveBestand[]> {
    const max = o.max ?? 1000;
    const uit: DriveBestand[] = [];
    let pageToken: string | undefined;
    do {
      const p = new URLSearchParams({
        q,
        pageSize: String(Math.min(1000, max - uit.length)),
        fields: `nextPageToken,files(${o.velden ?? VELDEN})`,
        spaces: 'drive'
      });
      if (o.orderBy) p.set('orderBy', o.orderBy);
      if (pageToken) p.set('pageToken', pageToken);
      const r = await this.json<{ files?: DriveBestand[]; nextPageToken?: string }>(`${DRIVE_URL}/files?${p.toString()}`);
      uit.push(...(r.files ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken && uit.length < max);
    return uit;
  }

  kinderen(ouderId: string, max = 1000): Promise<DriveBestand[]> {
    return this.lijst(qKinderen(ouderId), { max, orderBy: 'folder,name_natural' });
  }

  async zoekMap(ouderId: string, naam: string): Promise<DriveBestand | null> {
    const r = await this.lijst(qMapMetNaam(ouderId, naam), { max: 1, orderBy: 'createdTime' });
    return r[0] ?? null;
  }

  maakMap(ouderId: string, naam: string): Promise<DriveBestand> {
    return this.json(`${DRIVE_URL}/files?fields=${encodeURIComponent(VELDEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: naam, mimeType: MAP_MIME, parents: [ouderId] })
    });
  }

  /** Map met deze naam in de ouder: bestaande gebruiken, anders aanmaken. */
  async zorgVoorMap(ouderId: string, naam: string): Promise<DriveBestand> {
    return (await this.zoekMap(ouderId, naam)) ?? (await this.maakMap(ouderId, naam));
  }

  wijzig(id: string, velden: { name?: string; trashed?: boolean }, verplaats?: { naar: string; van: string[] }): Promise<DriveBestand> {
    if (!isDriveId(id)) throw new DriveFout('niet_gevonden', MELDING.niet_gevonden);
    const p = new URLSearchParams({ fields: VELDEN });
    if (verplaats) {
      p.set('addParents', verplaats.naar);
      if (verplaats.van.length) p.set('removeParents', verplaats.van.join(','));
    }
    return this.json(`${DRIVE_URL}/files/${encodeURIComponent(id)}?${p.toString()}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(velden)
    });
  }

  /**
   * Start een resumable upload en geef de sessie-URL terug. De browser zet het bestand daar
   * rechtstreeks neer (PUT), buiten de 4,5 MB-limiet van Vercel om. Met de Origin-kop staat
   * Google CORS toe voor die ene sessie. De URL is een eenmalige, kortlevende
   * schrijfsleutel voor precies dit ene nieuwe bestand in deze map.
   */
  async uploadSessie(o: { naam: string; mime: string; grootte?: number; ouderId: string; origin: string }): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': o.mime || 'application/octet-stream',
      Origin: o.origin
    };
    if (typeof o.grootte === 'number' && o.grootte >= 0) headers['X-Upload-Content-Length'] = String(o.grootte);
    const res = await this.verzoek(`${UPLOAD_URL}/files?uploadType=resumable&fields=${encodeURIComponent(VELDEN)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: o.naam, parents: [o.ouderId] })
    });
    if (!res.ok) throw await DriveClient.fout(res);
    const url = res.headers.get('location');
    if (!url || !url.startsWith(`${UPLOAD_URL}/`)) throw new DriveFout('google', MELDING.google);
    return url;
  }

  /** Klein bestand (PDF van een factuur, bonnetje) in één keer uploaden, of de inhoud van `id` vervangen. */
  async upload(o: { naam: string; mime: string; inhoud: Uint8Array; ouderId?: string; id?: string }): Promise<DriveBestand> {
    const grens = `sl${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const meta: Record<string, unknown> = { name: o.naam };
    if (!o.id && o.ouderId) meta.parents = [o.ouderId];
    const kop = `--${grens}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${grens}\r\nContent-Type: ${o.mime}\r\n\r\n`;
    const staart = `\r\n--${grens}--`;
    const enc = new TextEncoder();
    const a = enc.encode(kop);
    const b = enc.encode(staart);
    const body = new Uint8Array(a.length + o.inhoud.length + b.length);
    body.set(a, 0);
    body.set(o.inhoud, a.length);
    body.set(b, a.length + o.inhoud.length);
    const url = o.id
      ? `${UPLOAD_URL}/files/${encodeURIComponent(o.id)}?uploadType=multipart&fields=${encodeURIComponent(VELDEN)}`
      : `${UPLOAD_URL}/files?uploadType=multipart&fields=${encodeURIComponent(VELDEN)}`;
    return this.json(url, {
      method: o.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${grens}` },
      body
    });
  }

  /** De inhoud van een bestand (stream), met optioneel een Range-kop. */
  async inhoud(id: string, range?: string | null): Promise<Response> {
    if (!isDriveId(id)) throw new DriveFout('niet_gevonden', MELDING.niet_gevonden);
    const res = await this.verzoek(`${DRIVE_URL}/files/${encodeURIComponent(id)}?alt=media`, range ? { headers: { Range: range } } : {});
    if (!res.ok && res.status !== 206) throw await DriveClient.fout(res);
    return res;
  }

  /** Google-documenten (Docs/Sheets/Slides) als PDF. */
  async exportPdf(id: string): Promise<Response> {
    if (!isDriveId(id)) throw new DriveFout('niet_gevonden', MELDING.niet_gevonden);
    const res = await this.verzoek(`${DRIVE_URL}/files/${encodeURIComponent(id)}/export?mimeType=application%2Fpdf`);
    if (!res.ok) throw await DriveClient.fout(res);
    return res;
  }
}

/**
 * Hoort `id` bij de root? Loopt de parents-keten omhoog (max. 25 niveaus). `bekend` zijn
 * id's waarvan al vaststaat dat ze binnen de root liggen (de mappen-cache); die worden
 * aangevuld met elke map die onderweg binnen blijkt te liggen. `verboden` zijn mappen
 * (met alles eronder) die nooit als "binnen" tellen, zoals de Back-ups-map.
 */
export async function binnenRoot(
  client: Pick<DriveClient, 'bestand'>,
  rootId: string,
  id: string,
  bekend: Set<string> = new Set(),
  verboden: Set<string> = new Set()
): Promise<DriveBestand | null> {
  if (!isDriveId(id)) return null;
  if (verboden.has(id)) return null;
  let b: DriveBestand;
  try {
    b = await client.bestand(id);
  } catch (e) {
    if (e instanceof DriveFout && e.code === 'niet_gevonden') return null;
    throw e;
  }
  if (b.trashed) return null;
  if (id === rootId) return b;
  const pad: string[] = [];
  let ouders = b.parents ?? [];
  for (let diepte = 0; diepte < 25; diepte++) {
    const ouder = ouders[0];
    if (!ouder) return null;
    if (verboden.has(ouder)) return null;
    if (ouder === rootId || bekend.has(ouder)) {
      for (const p of pad) bekend.add(p);
      return b;
    }
    pad.push(ouder);
    let o: DriveBestand;
    try {
      o = await client.bestand(ouder, 'id,parents,trashed');
    } catch (e) {
      if (e instanceof DriveFout && e.code === 'niet_gevonden') return null;
      throw e;
    }
    if (o.trashed) return null;
    ouders = o.parents ?? [];
  }
  return null;
}
