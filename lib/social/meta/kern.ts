import { createHmac } from 'node:crypto';
import type { GebruikersTag, InzichtCijfers, MediaType, PostSoort } from '../types';

// De Meta-koppeling zonder netwerk, env of @/-imports (zodat scripts/test-social-meta.mjs dit
// los kan testen): de Graph API-versie, de permissies, de login-URL, het bouwen van verzoeken
// (zonder token in de URL), het vertalen van Meta-fouten naar een Nederlandse melding met
// "opnieuw proberen of niet", de parameters voor Instagram-containers en Facebook-posts, en
// het omzetten van inzichten naar onze cijfers (InzichtCijfers).
//
// Bronnen (opgezocht 26 november 2026):
//   - Versies: https://developers.facebook.com/docs/graph-api/changelog/versions
//     v26.0 (29 juli 2026); de Instagram-docs gebruiken al v27.0 (4 november 2026). Wij nemen
//     v27.0, met META_GRAPH_VERSION als uitwijk (bv. "v26.0").
//   - Facebook Login for Business: https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
//     login met config_id (een "configuratie" in de app met tokentype "User access token" en
//     de permissies); zonder configuratie de klassieke scope-lijst.
//   - Handmatige login-flow: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
//     https://www.facebook.com/{v}/dialog/oauth?client_id&redirect_uri&state&response_type=code
//     → GET /oauth/access_token?client_id&redirect_uri&client_secret&code
//   - Langlevende tokens: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
//     grant_type=fb_exchange_token (≈60 dagen); de page tokens uit /me/accounts met een
//     langlevend user token verlopen niet (alleen bij wachtwoordwissel, intrekken, …).
//   - Instagram publiceren: https://developers.facebook.com/docs/instagram-platform/content-publishing
//     en https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
//     POST /{ig-user-id}/media (image_url | video_url + media_type VIDEO/REELS/CAROUSEL,
//     is_carousel_item, children, caption, user_tags [{username,x,y}], collaborators (max. 3),
//     location_id, alt_text (alleen foto's), share_to_feed (reels)); GET /{container}?fields=status_code
//     (EXPIRED, ERROR, FINISHED, IN_PROGRESS, PUBLISHED); POST /{ig-user-id}/media_publish
//     creation_id. Max. 100 API-posts per 24 uur (GET /{ig-user-id}/content_publishing_limit).
//     Meta haalt het bestand zelf op (publieke URL, bij ons een signed URL).
//   - Foutcodes Instagram: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes
//   - Eerste reactie: POST /{ig-media-id}/comments message (instagram_manage_comments) en
//     POST /{post-id}/comments message (pages_manage_engagement).
//   - Facebook-pagina: https://developers.facebook.com/docs/pages-api/posts en
//     https://developers.facebook.com/docs/graph-api/reference/page/photos/
//     /feed message; /photos url + caption (+ alt_text_custom); meerdere foto's: eerst
//     /photos published=false, dan /feed met attached_media[n]={"media_fbid":…}.
//   - Facebook-reels: https://developers.facebook.com/docs/video-api/guides/reels-publishing
//     POST /{page-id}/video_reels upload_phase=start → POST rupload.facebook.com/video-upload/{v}/{video-id}
//     met de kopteksten "Authorization: OAuth <page token>" en "file_url: <url>" → GET
//     /{video-id}?fields=status → POST video_reels upload_phase=finish, video_state=PUBLISHED,
//     description. Max. 30 API-posts per pagina per 24 uur.
//   - Inzichten Instagram per post: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights
//     'impressions' is vervallen (media na 2 juli 2024) → 'views'. Wel: reach, views, likes,
//     comments, saved, shares, total_interactions, follows/profile_visits (feed),
//     ig_reels_avg_watch_time/ig_reels_video_view_total_time (reels, in ms).
//   - Inzichten Instagram-account: https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights
//     'impressions' vervallen per 21 april 2025; nu reach, views, accounts_engaged,
//     total_interactions, profile_links_taps … met period=day en metric_type=total_value.
//   - Inzichten Facebook: https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics
//     page_impressions*/post_impressions* vervallen per 15 november 2025 → page_media_view /
//     post_media_view; *_impressions_unique per 15 juni 2025 → page_total_media_view_unique /
//     post_total_media_view_unique; page_fans → page_follows (wij lezen followers_count).

// ---------------------------------------------------------------------------------
// Versie, hosts, permissies
// ---------------------------------------------------------------------------------

export const STANDAARD_VERSIE = 'v27.0';
export const GRAPH_HOST = 'https://graph.facebook.com';
export const LOGIN_HOST = 'https://www.facebook.com';
export const RUPLOAD_HOST = 'https://rupload.facebook.com';

/** "v27.0" uit de env, of de standaard bij een lege/ongeldige waarde. */
export function graphVersie(waarde: string | null | undefined): string {
  const s = (waarde ?? '').trim();
  return /^v\d{2,3}\.0$/.test(s) ? s : STANDAARD_VERSIE;
}

/**
 * De permissies die we vragen (zonder configuratie; met Facebook Login for Business zet je
 * dezelfde in de configuratie). Waarvoor:
 *   pages_show_list            je pagina's (en de Instagram-accounts eraan) tonen
 *   pages_read_engagement      posts, reacties en de pagina-gegevens lezen (ook nodig voor IG)
 *   pages_manage_posts         op de Facebookpagina plaatsen
 *   pages_manage_engagement    de eerste reactie onder een Facebookpost
 *   read_insights              de cijfers van de pagina en de posts
 *   publish_video              reels op de Facebookpagina
 *   business_management        pagina's die in een Business Portfolio (Business Manager) staan
 *   instagram_basic            het Instagram-account en zijn posts lezen
 *   instagram_content_publish  op Instagram plaatsen
 *   instagram_manage_comments  de eerste reactie onder een Instagrampost
 *   instagram_manage_insights  de cijfers van Instagram
 */
export const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'read_insights',
  'publish_video',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights'
] as const;

/** Zonder deze permissies heeft koppelen geen zin. */
export const MINIMALE_SCOPES = ['pages_show_list', 'pages_read_engagement'] as const;

/** De ontbrekende permissies uit een lijst van toegekende (namen, nooit tokens). */
export function ontbrekendeScopes(toegekend: string[]): string[] {
  const set = new Set(toegekend.map((s) => s.trim()).filter(Boolean));
  return SCOPES.filter((s) => !set.has(s));
}

/** De Meta-login (Facebook Login for Business als er een config_id is). */
export function loginUrl(o: { versie: string; appId: string; redirectUri: string; state: string; configId?: string | null }): string {
  const p = new URLSearchParams({ client_id: o.appId, redirect_uri: o.redirectUri, state: o.state, response_type: 'code' });
  if (o.configId) p.set('config_id', o.configId);
  else p.set('scope', SCOPES.join(','));
  return `${LOGIN_HOST}/${o.versie}/dialog/oauth?${p}`;
}

// ---------------------------------------------------------------------------------
// Verzoeken bouwen
// ---------------------------------------------------------------------------------

export type Waarde = string | number | boolean | null | undefined | unknown[] | Record<string, unknown>;
export type Params = Record<string, Waarde>;

/** appsecret_proof = HMAC-SHA256(token, app secret), hex. Meta raadt dit aan voor serveraanroepen. */
export function appsecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex');
}

/** Parameters als tekst: arrays/objecten als JSON (zoals Meta ze verwacht), lege waarden weg. */
export function naarFormulier(params: Params): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return p;
}

export interface Verzoek {
  url: string;
  init: { method: string; headers: Record<string, string>; body?: string };
}

/**
 * Eén Graph-verzoek. Het token gaat in de Authorization-kop (nooit in de URL, zodat het niet in
 * logs van proxy's of in foutmeldingen belandt); appsecret_proof gaat wel mee als parameter.
 * GET/DELETE: parameters in de query; POST: als formulier in de body.
 */
export function bouwVerzoek(o: {
  versie: string;
  pad: string;
  methode?: 'GET' | 'POST' | 'DELETE';
  params?: Params;
  token?: string | null;
  appSecret?: string | null;
}): Verzoek {
  const methode = o.methode ?? 'GET';
  const pad = o.pad.startsWith('/') ? o.pad : `/${o.pad}`;
  if (!/^\/[A-Za-z0-9_./-]*$/.test(pad) || pad.includes('..')) throw new Error('Ongeldig Graph-pad.');
  const params: Params = { ...(o.params ?? {}) };
  if (o.token && o.appSecret) params.appsecret_proof = appsecretProof(o.token, o.appSecret);
  const form = naarFormulier(params);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  const basis = `${GRAPH_HOST}/${o.versie}${pad}`;
  if (methode === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return { url: basis, init: { method: methode, headers, body: form.toString() } };
  }
  const q = form.toString();
  return { url: q ? `${basis}?${q}` : basis, init: { method: methode, headers } };
}

// ---------------------------------------------------------------------------------
// Fouten vertalen
// ---------------------------------------------------------------------------------

export interface GraphFoutBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
    is_transient?: boolean;
  };
}

export type MetaFoutSoort =
  | 'opnieuw_koppelen' // token verlopen/ingetrokken (190, 102, 463, 467)
  | 'geen_rechten' // permissie ontbreekt of geen rol op de pagina (10, 200–299)
  | 'limiet' // te veel aanroepen of daglimiet plaatsen
  | 'media' // bestand voldoet niet (formaat, grootte, verhouding, niet op te halen)
  | 'ongeldig' // andere invoerfout (caption te lang, onbekende gebruiker, …)
  | 'niet_klaar' // container wordt nog verwerkt
  | 'container' // container verlopen/ongeldig: opnieuw beginnen met een nieuwe
  | 'geblokkeerd' // account beperkt of als spam aangemerkt
  | 'tijdelijk'; // storing bij Meta of netwerk

export class MetaFout extends Error {
  soort: MetaFoutSoort;
  /** Een herkansing lost dit niet op (volgendePoging(…, blijvend)). */
  blijvend: boolean;
  /** De container opnieuw aanmaken bij de volgende poging. */
  nieuweContainer: boolean;
  code: number | null;
  subcode: number | null;
  http: number;
  /** Korte technische reden voor de logs (zonder tokens). */
  detail: string;
  constructor(o: { soort: MetaFoutSoort; melding: string; blijvend: boolean; nieuweContainer?: boolean; code?: number | null; subcode?: number | null; http?: number; detail?: string }) {
    super(o.melding);
    this.name = 'MetaFout';
    this.soort = o.soort;
    this.blijvend = o.blijvend;
    this.nieuweContainer = o.nieuweContainer ?? false;
    this.code = o.code ?? null;
    this.subcode = o.subcode ?? null;
    this.http = o.http ?? 0;
    this.detail = (o.detail ?? '').slice(0, 300);
  }
}

export const MELDING = {
  opnieuw_koppelen: 'De toegang tot Meta is verlopen of ingetrokken. Koppel het account opnieuw via Social → Koppelingen.',
  geen_rechten: 'Meta geeft geen toestemming voor deze actie. Koppel opnieuw en vink alle gevraagde rechten aan (en controleer je rol op de pagina).',
  limiet: 'Meta laat even geen nieuwe aanroepen toe (limiet bereikt). Het wordt later opnieuw geprobeerd.',
  daglimiet: 'De daglimiet van Instagram voor geplaatste posts via de API is bereikt (100 per 24 uur).',
  tijdelijk: 'Meta is even niet bereikbaar of gaf een storing. Het wordt zo opnieuw geprobeerd.',
  niet_klaar: 'Meta is de video nog aan het verwerken.',
  container: 'Meta kon het bestand niet (meer) verwerken. Er wordt een nieuwe poging gedaan.',
  geblokkeerd: 'Het account is door Meta beperkt of de actie is als spam aangemerkt. Los dit op in de Instagram- of Facebook-app.',
  netwerk: 'Meta was niet bereikbaar (netwerk of time-out). Het wordt zo opnieuw geprobeerd.'
} as const;

/** Instagram-specifieke subcodes (error_subcode) → melding en of het zin heeft opnieuw te proberen. */
const IG_SUBCODES: Record<number, { soort: MetaFoutSoort; melding: string; blijvend: boolean; nieuweContainer?: boolean }> = {
  2207001: { soort: 'tijdelijk', melding: 'Instagram gaf een serverfout. Het wordt zo opnieuw geprobeerd.', blijvend: false, nieuweContainer: true },
  2207003: { soort: 'tijdelijk', melding: 'Instagram kon het bestand niet op tijd ophalen. Het wordt zo opnieuw geprobeerd.', blijvend: false, nieuweContainer: true },
  2207004: { soort: 'media', melding: 'De foto is groter dan 8 MB. Gebruik een kleinere foto.', blijvend: true },
  2207005: { soort: 'media', melding: 'Instagram ondersteunt dit beeldformaat niet. Gebruik een JPEG.', blijvend: true },
  2207006: { soort: 'container', melding: 'Instagram vond het bestand niet (meer). Er wordt een nieuwe poging gedaan.', blijvend: false, nieuweContainer: true },
  2207008: { soort: 'container', melding: 'De voorbereide Instagram-post is verlopen. Er wordt een nieuwe gemaakt.', blijvend: false, nieuweContainer: true },
  2207009: { soort: 'media', melding: 'De beeldverhouding past niet bij Instagram (van 4:5 staand tot 1.91:1 liggend).', blijvend: true },
  2207010: { soort: 'ongeldig', melding: 'De caption is te lang voor Instagram (max. 2200 tekens, 30 hashtags, 20 vermeldingen).', blijvend: true },
  2207020: { soort: 'container', melding: 'De voorbereide Instagram-post is verlopen. Er wordt een nieuwe gemaakt.', blijvend: false, nieuweContainer: true },
  2207026: { soort: 'media', melding: 'Instagram ondersteunt dit videoformaat niet. Gebruik MP4 of MOV (H.264/HEVC, AAC).', blijvend: true },
  2207027: { soort: 'niet_klaar', melding: MELDING.niet_klaar, blijvend: false },
  2207032: { soort: 'tijdelijk', melding: 'Instagram kon de post niet voorbereiden. Het wordt zo opnieuw geprobeerd.', blijvend: false, nieuweContainer: true },
  2207042: { soort: 'limiet', melding: MELDING.daglimiet, blijvend: false },
  2207050: { soort: 'geblokkeerd', melding: 'Het Instagram-account is inactief of beperkt. Open de Instagram-app en los de melding daar op.', blijvend: true },
  2207051: { soort: 'geblokkeerd', melding: 'Instagram heeft deze actie als spam aangemerkt. Bezwaar maken kan in de Instagram-app.', blijvend: true },
  2207052: { soort: 'media', melding: 'Instagram kon het bestand niet ophalen. Probeer het opnieuw of upload het bestand opnieuw.', blijvend: false, nieuweContainer: true },
  2207053: { soort: 'tijdelijk', melding: 'Er ging iets mis bij het uploaden van de video naar Instagram. Het wordt opnieuw geprobeerd.', blijvend: false, nieuweContainer: true }
};

/**
 * Een foutantwoord van de Graph API → MetaFout met een Nederlandse melding. Volgorde: eerst de
 * Instagram-subcodes, dan de algemene codes (https://developers.facebook.com/docs/graph-api/guides/error-handling).
 */
export function vertaalMetaFout(http: number, body: unknown): MetaFout {
  const e = (body && typeof body === 'object' ? (body as GraphFoutBody).error : undefined) ?? {};
  const code = typeof e.code === 'number' ? e.code : null;
  const subcode = typeof e.error_subcode === 'number' ? e.error_subcode : null;
  const detail = `HTTP ${http} code=${code ?? '-'} sub=${subcode ?? '-'} ${e.type ?? ''} ${String(e.message ?? '').slice(0, 160)}`.trim();
  const maak = (soort: MetaFoutSoort, melding: string, blijvend: boolean, nieuweContainer = false) =>
    new MetaFout({ soort, melding, blijvend, nieuweContainer, code, subcode, http, detail });

  if (subcode != null && IG_SUBCODES[subcode]) {
    const s = IG_SUBCODES[subcode];
    return maak(s.soort, s.melding, s.blijvend, s.nieuweContainer ?? false);
  }
  // Token: 190 (ongeldig/verlopen/ingetrokken; subcodes 458–467) en 102 (sessie).
  if (code === 190 || code === 102) {
    return maak('opnieuw_koppelen', MELDING.opnieuw_koppelen, true);
  }
  // Permissies: 10 en 200–299.
  if (code === 10 || (code != null && code >= 200 && code <= 299)) return maak('geen_rechten', MELDING.geen_rechten, true);
  // Limieten: 4 (app), 17 (gebruiker), 32 (pagina), 613, 80001–80014 (business use case).
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code != null && code >= 80001 && code <= 80014)) {
    return maak('limiet', MELDING.limiet, false);
  }
  if (code === 9 || code === 9007) return maak('niet_klaar', MELDING.niet_klaar, false);
  if (code === 368) return maak('geblokkeerd', MELDING.geblokkeerd, true);
  // Storing: 1, 2, -1, 5xx of door Meta als tijdelijk gemarkeerd.
  if (code === 1 || code === 2 || code === -1 || e.is_transient === true || http >= 500) return maak('tijdelijk', MELDING.tijdelijk, false);
  if (code === 100 || code === 24 || code === 36000 || code === 36001 || code === 36003 || code === 36004 || code === 352 || http === 400) {
    // Ongeldige parameter: Meta's eigen gebruikerstekst is vaak het duidelijkst (Engels, kort).
    const uitleg = String(e.error_user_msg ?? e.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return maak('ongeldig', `Meta weigerde de post${uitleg ? `: ${uitleg}` : '.'}`, true);
  }
  if (http === 401) return maak('opnieuw_koppelen', MELDING.opnieuw_koppelen, true);
  if (http === 403) return maak('geen_rechten', MELDING.geen_rechten, true);
  if (http === 429) return maak('limiet', MELDING.limiet, false);
  return maak('tijdelijk', MELDING.tijdelijk, false);
}

/** Netwerkfout of time-out (geen antwoord van Meta). */
export function netwerkFout(e: unknown): MetaFout {
  const naam = (e as { name?: string } | null)?.name ?? '';
  return new MetaFout({ soort: 'tijdelijk', melding: MELDING.netwerk, blijvend: false, detail: `netwerk ${naam}`.trim() });
}

// ---------------------------------------------------------------------------------
// Instagram: containers
// ---------------------------------------------------------------------------------

export interface MediaVoorMeta {
  type: MediaType;
  /** Publieke (signed) URL die Meta ophaalt. */
  url: string;
  alt_tekst: string;
}

export interface PostVoorMeta {
  soort: PostSoort;
  caption: string;
  gebruikers_tags: GebruikersTag[];
  collaborators: string[];
  locatie_id: string | null;
}

/** "@naam" → "naam" (Instagram wil gebruikersnamen zonder @). Lege en dubbele weg. */
export function gebruikersnamen(lijst: string[]): string[] {
  const uit: string[] = [];
  for (const n of lijst) {
    const s = String(n ?? '').trim().replace(/^@+/, '').toLowerCase();
    if (s && /^[a-z0-9._]{1,30}$/.test(s) && !uit.includes(s)) uit.push(s);
  }
  return uit;
}

/** IG user_tags voor één bestand: [{username, x, y}] met x/y binnen 0..1. */
export function userTagsVoor(tags: GebruikersTag[], index: number): { username: string; x: number; y: number }[] {
  const klem = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
  return tags
    .filter((t) => (t.media_index ?? 0) === index)
    .map((t) => ({ username: gebruikersnamen([t.gebruikersnaam])[0] ?? '', x: Math.round(klem(t.x) * 1000) / 1000, y: Math.round(klem(t.y) * 1000) / 1000 }))
    .filter((t) => t.username);
}

export interface IgPlan {
  /** Carrousel: de kinderen eerst (elk een eigen container). */
  kinderen: Params[];
  /** De hoofdcontainer (bij een carrousel komt `children` er nog bij). */
  hoofd: Params;
}

/**
 * De parameters voor POST /{ig-user-id}/media. Foto: image_url + caption, user_tags, alt_text,
 * location_id, collaborators. Carrousel: per bestand een kind (is_carousel_item, user_tags en
 * alt_text op foto's), daarna de hoofdcontainer (media_type CAROUSEL, caption, location_id,
 * collaborators). Reel: media_type REELS, video_url, caption, share_to_feed (ook in het
 * raster), collaborators, location_id (user_tags kan niet bij reels).
 */
export function igContainerPlan(post: PostVoorMeta, media: MediaVoorMeta[], caption: string): IgPlan {
  const collab = gebruikersnamen(post.collaborators).slice(0, 3);
  const gemeen: Params = {
    caption: caption || undefined,
    location_id: post.locatie_id || undefined,
    collaborators: collab.length ? collab : undefined
  };
  const tags = (i: number) => {
    const t = userTagsVoor(post.gebruikers_tags ?? [], i);
    return t.length ? t : undefined;
  };
  const alt = (m: MediaVoorMeta) => (m.alt_tekst?.trim() ? m.alt_tekst.trim().slice(0, 1000) : undefined);

  if (post.soort === 'foto') {
    const m = media[0];
    if (!m || m.type !== 'afbeelding') throw new Error('Een foto-post heeft één afbeelding nodig.');
    return { kinderen: [], hoofd: { image_url: m.url, ...gemeen, user_tags: tags(0), alt_text: alt(m) } };
  }
  if (post.soort === 'reel') {
    const m = media[0];
    if (!m || m.type !== 'video') throw new Error('Een reel heeft één video nodig.');
    return { kinderen: [], hoofd: { media_type: 'REELS', video_url: m.url, share_to_feed: true, ...gemeen } };
  }
  if (post.soort === 'carrousel') {
    if (media.length < 2) throw new Error('Een carrousel heeft minstens twee bestanden nodig.');
    const kinderen = media.map((m, i): Params =>
      m.type === 'video'
        ? { is_carousel_item: true, media_type: 'VIDEO', video_url: m.url }
        : { is_carousel_item: true, image_url: m.url, user_tags: tags(i), alt_text: alt(m) }
    );
    return { kinderen, hoofd: { media_type: 'CAROUSEL', ...gemeen } };
  }
  throw new Error('Instagram kan geen post met alleen tekst plaatsen.');
}

export type ContainerStatus = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';

/** Wat te doen met een container-status. */
export function containerStap(status: string | null | undefined): 'klaar' | 'wachten' | 'opnieuw' | 'al_geplaatst' {
  switch (status) {
    case 'FINISHED':
      return 'klaar';
    case 'IN_PROGRESS':
    case undefined:
    case null:
    case '':
      return 'wachten';
    case 'PUBLISHED':
      return 'al_geplaatst';
    default:
      return 'opnieuw'; // EXPIRED, ERROR of onbekend
  }
}

// ---------------------------------------------------------------------------------
// Facebook: posts
// ---------------------------------------------------------------------------------

/** /{page-id}/photos voor één foto (direct geplaatst) of als onderdeel van meerdere (published=false). */
export function fbFotoParams(m: MediaVoorMeta, caption: string | null, gepubliceerd: boolean): Params {
  return {
    url: m.url,
    caption: gepubliceerd && caption ? caption : undefined,
    published: gepubliceerd ? undefined : false,
    alt_text_custom: m.alt_tekst?.trim() ? m.alt_tekst.trim().slice(0, 1000) : undefined
  };
}

/** /{page-id}/feed met meerdere (al geüploade, ongepubliceerde) foto's. */
export function fbFeedParams(caption: string, fotoIds: string[] = []): Params {
  const p: Params = { message: caption || undefined };
  fotoIds.forEach((id, i) => {
    p[`attached_media[${i}]`] = { media_fbid: id };
  });
  return p;
}

/** Afronden van een Facebook-reel. */
export function fbReelAfrondParams(videoId: string, caption: string): Params {
  return { video_id: videoId, upload_phase: 'finish', video_state: 'PUBLISHED', description: caption || undefined };
}

/** De kopteksten voor het ophalen van een video door Meta (rupload, hosted file). */
export function fbReelUploadKoppen(pageToken: string, bestandUrl: string): Record<string, string> {
  return { Authorization: `OAuth ${pageToken}`, file_url: bestandUrl };
}

/** Status van een Facebook-video (GET /{video-id}?fields=status). */
export function fbVideoStap(status: { video_status?: string; processing_phase?: { status?: string } } | null | undefined): 'klaar' | 'wachten' | 'opnieuw' {
  const v = status?.video_status ?? '';
  if (v === 'ready') return 'klaar';
  if (v === 'error' || v === 'expired' || v === 'upload_failed' || status?.processing_phase?.status === 'error') return 'opnieuw';
  return 'wachten';
}

/** Een Facebook-post-id altijd als "<page-id>_<post-id>" (zoals /published_posts ze geeft). */
export function fbPostId(pageId: string, id: string | null | undefined): string | null {
  const s = String(id ?? '').trim();
  if (!s) return null;
  return s.includes('_') ? s : `${pageId}_${s}`;
}

// ---------------------------------------------------------------------------------
// Sync: externe posts
// ---------------------------------------------------------------------------------

/** Instagram media_type/media_product_type → onze soort. */
export function igSoort(mediaType: string | null | undefined, productType?: string | null): PostSoort {
  if (mediaType === 'CAROUSEL_ALBUM') return 'carrousel';
  if (mediaType === 'VIDEO' || productType === 'REELS') return 'reel';
  return 'foto';
}

/** Facebook-post → onze soort, uit de bijlagen (attachments{media_type,type,subattachments}). */
export function fbSoort(p: { attachments?: { data?: { media_type?: string; type?: string; subattachments?: { data?: unknown[] } }[] } }): PostSoort {
  const a = p.attachments?.data?.[0];
  if (!a) return 'tekst';
  if ((a.subattachments?.data?.length ?? 0) > 1 || a.type === 'album') return 'carrousel';
  if (a.media_type === 'video' || /video|reel/.test(a.type ?? '')) return 'reel';
  if (a.media_type === 'photo' || a.type === 'photo') return 'foto';
  return 'tekst';
}

// ---------------------------------------------------------------------------------
// Inzichten
// ---------------------------------------------------------------------------------

/** De metrics voor één Instagram-post (een onbekende metric laat het hele verzoek mislukken). */
export function igMediaMetrics(mediaType: string | null | undefined, productType: string | null | undefined): string[] {
  if (productType === 'REELS' || (mediaType === 'VIDEO' && productType !== 'FEED')) {
    return ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'];
  }
  return ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'follows', 'profile_visits'];
}

const IG_NAAR_CIJFER: Record<string, keyof InzichtCijfers> = {
  reach: 'bereik',
  views: 'weergaven',
  likes: 'likes',
  comments: 'reacties',
  saved: 'opslagen',
  shares: 'gedeeld',
  total_interactions: 'interacties',
  follows: 'volgers_erbij',
  profile_visits: 'profielbezoeken',
  accounts_engaged: 'betrokken_accounts',
  profile_links_taps: 'linkklikken'
};

interface MetricRij {
  name?: string;
  values?: { value?: unknown; end_time?: string }[];
  total_value?: { value?: unknown };
}

const getal = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Een waarde als object (bv. reacties per soort) → de som. */
const som = (v: unknown): number | null => {
  const g = getal(v);
  if (g != null) return g;
  if (v && typeof v === 'object') {
    let t = 0;
    for (const x of Object.values(v as Record<string, unknown>)) t += getal(x) ?? 0;
    return t;
  }
  return null;
};

/** De laatste (of totale) waarde van een metric. */
function metricWaarde(r: MetricRij): number | null {
  if (r.total_value) return som(r.total_value.value);
  const v = r.values ?? [];
  return v.length ? som(v[v.length - 1].value) : null;
}

/** GET /{ig-media-id}/insights → InzichtCijfers (ms → s voor de kijktijd). */
export function igInzichtenNaarCijfers(data: MetricRij[] | null | undefined): InzichtCijfers {
  const uit: InzichtCijfers = {};
  for (const r of data ?? []) {
    const w = metricWaarde(r);
    if (w == null || !r.name) continue;
    if (r.name === 'ig_reels_avg_watch_time') uit.gem_kijktijd_sec = Math.round(w / 100) / 10;
    else if (r.name === 'ig_reels_video_view_total_time') uit.kijktijd_sec = Math.round(w / 1000);
    else if (IG_NAAR_CIJFER[r.name]) uit[IG_NAAR_CIJFER[r.name] as string] = w;
  }
  return uit;
}

/** De account-metrics voor Instagram (period=day, metric_type=total_value). */
export const IG_ACCOUNT_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_links_taps'];

/** De post-metrics voor Facebook (na de wijzigingen van 2025). */
export const FB_POST_METRICS = ['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_reactions_by_type_total'];
/** De pagina-metrics voor Facebook (period=day). */
export const FB_PAGINA_METRICS = ['page_media_view', 'page_total_media_view_unique', 'page_post_engagements'];

const FB_NAAR_CIJFER: Record<string, keyof InzichtCijfers> = {
  post_media_view: 'weergaven',
  post_total_media_view_unique: 'bereik',
  post_clicks: 'klikken',
  post_reactions_by_type_total: 'likes',
  page_media_view: 'weergaven',
  page_total_media_view_unique: 'bereik',
  page_post_engagements: 'interacties'
};

/**
 * Facebook-post: de insights plus de tellers uit de post zelf (comments.summary, shares).
 * `likes` = alle reacties (vind ik leuk, ❤️, …) samen.
 */
export function fbPostNaarCijfers(
  data: MetricRij[] | null | undefined,
  post?: { comments?: { summary?: { total_count?: number } }; shares?: { count?: number } } | null
): InzichtCijfers {
  const uit: InzichtCijfers = {};
  for (const r of data ?? []) {
    const w = metricWaarde(r);
    if (w == null || !r.name || !FB_NAAR_CIJFER[r.name]) continue;
    uit[FB_NAAR_CIJFER[r.name] as string] = w;
  }
  const reacties = getal(post?.comments?.summary?.total_count);
  if (reacties != null) uit.reacties = reacties;
  const gedeeld = getal(post?.shares?.count);
  if (gedeeld != null) uit.gedeeld = gedeeld;
  return uit;
}

/** Account-inzichten (IG total_value of FB day-reeks, laatste waarde) → cijfers. */
export function accountInzichtenNaarCijfers(data: MetricRij[] | null | undefined): InzichtCijfers {
  const uit: InzichtCijfers = {};
  for (const r of data ?? []) {
    const w = metricWaarde(r);
    if (w == null || !r.name) continue;
    const sleutel = IG_NAAR_CIJFER[r.name] ?? FB_NAAR_CIJFER[r.name];
    if (sleutel) uit[sleutel as string] = w;
  }
  return uit;
}

// ---------------------------------------------------------------------------------
// Tokens en accounts
// ---------------------------------------------------------------------------------

/** Vaste waarden voor social_accounts.fout (de UI toont er een uitleg bij). */
export const ACCOUNT_FOUT = {
  opnieuw_koppelen: 'opnieuw_koppelen',
  verloopt_binnenkort: 'verloopt_binnenkort',
  geen_rechten: 'geen_rechten',
  ontkoppeld: 'ontkoppeld'
} as const;
export type AccountFout = (typeof ACCOUNT_FOUT)[keyof typeof ACCOUNT_FOUT];

export const ACCOUNT_FOUT_LABEL: Record<AccountFout, string> = {
  opnieuw_koppelen: 'De toegang is verlopen of ingetrokken. Koppel opnieuw.',
  verloopt_binnenkort: 'De toegang verloopt binnenkort. Koppel opnieuw om dat te voorkomen.',
  geen_rechten: 'Er ontbreken rechten. Koppel opnieuw en vink alles aan.',
  ontkoppeld: 'Ontkoppeld. Koppel opnieuw om hier weer te plaatsen.'
};

/** Waarschuwen zoveel dagen voordat de toegang (data access) verloopt. */
export const WAARSCHUW_DAGEN = 7;

/**
 * Wanneer de toegang verloopt, uit debug_token: expires_at (0 = nooit, zo bij page tokens) en
 * data_access_expires_at (90 dagen na de laatste login; daarna moet je opnieuw inloggen).
 */
export function verlooptOp(d: { expires_at?: number; data_access_expires_at?: number } | null | undefined): Date | null {
  const kandidaten = [d?.expires_at, d?.data_access_expires_at].filter((x): x is number => typeof x === 'number' && x > 0);
  if (!kandidaten.length) return null;
  return new Date(Math.min(...kandidaten) * 1000);
}

/** De fout voor een account op basis van debug_token (null = in orde). */
export function tokenOordeel(d: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number } | null | undefined, nu: Date): AccountFout | null {
  if (!d || d.is_valid === false) return 'opnieuw_koppelen';
  const op = verlooptOp(d);
  if (op && op.getTime() <= nu.getTime()) return 'opnieuw_koppelen';
  if (op && op.getTime() - nu.getTime() < WAARSCHUW_DAGEN * 86_400_000) return 'verloopt_binnenkort';
  return null;
}

/** Een pagina uit /me/accounts mag plaatsen als je er inhoud mag maken (CREATE_CONTENT of MANAGE). */
export function magPlaatsen(tasks: string[] | null | undefined): boolean {
  if (!tasks) return true; // Meta laat 'tasks' soms weg; dan beslist Meta zelf bij het plaatsen.
  return tasks.includes('CREATE_CONTENT') || tasks.includes('MANAGE');
}

/** AAD voor het versleutelde token: gebonden aan platform + extern id. */
export function tokenAad(platform: string, externId: string): string {
  return `social-meta:${platform}:${externId}`;
}
