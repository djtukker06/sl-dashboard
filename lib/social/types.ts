/**
 * Social media management (migratie 0041): de types voor de database, de API en de browser.
 * Zonder imports, zodat zowel de server als de browser (en de testscripts) dit kunnen laden.
 *
 * ## Contract tussen de onderdelen
 *
 * Kanalen in deze versie: Instagram (zakelijk/maker-account dat aan een Facebookpagina hangt,
 * via de Instagram Graph API van Meta) en Facebookpagina's. LinkedIn/TikTok komen later.
 *
 * ### Database (alle tabellen: RLS aan, geen policies, alleen de service-role)
 *   social_accounts           {@link SocialAccountRij}  — token_enc NOOIT naar de browser
 *   social_posts              {@link SocialPostRij}
 *   social_post_kanalen       {@link SocialPostKanaalRij}  (uniek per post + account)
 *   social_media              {@link SocialMediaRij}   bestanden in de privé-bucket {@link MEDIA_BUCKET}
 *   social_inzichten          {@link SocialInzichtRij}  (uniek per account + extern_post_id + datum)
 *   social_account_inzichten  {@link SocialAccountInzichtRij}  (pk account_id + datum)
 * Vóór de migratie: tabelOntbreekt/kolomOntbreekt (lib/db/ontbreekt.ts) → melding
 * "voer migratie 0041 uit (supabase/UITVOEREN_0041.sql)" ({@link MIGRATIE_MELDING}).
 *
 * ### Gedeelde code
 *   lib/social/kern.ts     puur (geen @/-imports): statussen, labels, parsePost, mediaeisen,
 *                          isAanDeBeurt, retry-schema, captionSamenstellen, tijdzone.
 *   lib/social/plaatsen.ts (server) `plaatsPost(service, postId): Promise<PlaatsResultaat>` en
 *                          `verwerkSocialCron(service, nu): Promise<Record<string, unknown>>`.
 *   lib/social/media.ts    (server) signed upload-URL's (uploads gaan rechtstreeks naar
 *                          Storage, nooit via onze server: Vercel ~4,5 MB per request) en
 *                          `publiekeMediaUrl(service, pad, seconden)`: signed URL die Meta ophaalt.
 *
 * ### API (alle routes achter de teamlidcontrole; antwoorden zonder tokens)
 *   GET    /api/social/accounts              → {@link AccountsAntwoord}
 *   GET    /api/social/meta/start            → redirect naar de Meta-login (state-cookie)
 *   GET    /api/social/meta/callback         → opslaan, terug naar /social/koppelingen?gekoppeld=<n>
 *   DELETE /api/social/accounts/[id]         → { ok: true }
 *   POST   /api/social/sync                  → posts + inzichten nu ophalen
 *   GET    /api/cron/social                  → cronRoute (Bearer CRON_SECRET), elke 5 min via pg_cron
 *   GET    /api/social/posts?status=&kanaal=&van=&tot=  → {@link PostsAntwoord} ({@link PostFilter})
 *   POST   /api/social/posts                 body {@link PostInvoer} → {@link PostAntwoord}
 *   GET    /api/social/posts/[id]            → {@link PostAntwoord}
 *   PATCH  /api/social/posts/[id]            body Partial<{@link PostInvoer}> → {@link PostAntwoord}
 *   DELETE /api/social/posts/[id]            → { ok: true }
 *   POST   /api/social/posts/[id]/nu         → {@link PlaatsResultaat} (roept plaatsPost aan)
 *   POST   /api/social/media/upload-url      body {@link UploadUrlVerzoek} → {@link UploadUrlAntwoord}
 *   POST   /api/social/posts/[id]/media      body {@link MediaRegistratie} | { volgorde: string[] } → {@link PostAntwoord}
 *   DELETE /api/social/media/[id]            → { ok: true }
 *   GET    /api/social/inzichten?van=&tot=   → {@link InzichtenAntwoord}
 * Fouten: `{ fout: string }` met een Nederlandse melding (zoals de rest van de app).
 *
 * ### Plaatsen (stipt op tijd)
 * pg_cron roept elke 5 minuten /api/cron/social aan (supabase/UITVOEREN_0041_cron.sql). Een
 * post is aan de beurt volgens `isAanDeBeurt` (kern.ts). Claimen met een conditionele update:
 * `update social_posts set status='bezig' where id=… and status='ingepland'`; alleen wie een
 * rij terugkrijgt plaatst. Reels: container `REEL_VOORBEREIDING_MIN` minuten vooraf aanmaken
 * (container_id opslaan), op het moment zelf publiceren. Mislukt een kanaal: `volgendePoging`
 * (kern.ts) zet volgende_poging_op, na de laatste herkansing status 'mislukt'.
 */

export type Platform = 'instagram' | 'facebook';
export type PostStatus = 'concept' | 'ingepland' | 'bezig' | 'geplaatst' | 'deels' | 'mislukt';
export type PostSoort = 'foto' | 'carrousel' | 'reel' | 'tekst';
export type HashtagsPlek = 'caption' | 'reactie';
export type PostBron = 'dashboard' | 'extern';
export type MediaType = 'afbeelding' | 'video';

/** De privé-bucket met de foto's en video's (pad = <post-id>/<bestand>). */
export const MEDIA_BUCKET = 'social-media';
export const MIGRATIE_MELDING = 'Voer migratie 0041 uit (supabase/UITVOEREN_0041.sql).';

/** Een gebruikerstag op een foto (IG user_tags). x en y van 0 t/m 1 (linksboven = 0,0). */
export interface GebruikersTag {
  /** Instagram-gebruikersnaam zonder @. */
  gebruikersnaam: string;
  x: number;
  y: number;
  /** Welk bestand (0 = het eerste; bij een carrousel de plek in de carrousel). */
  media_index: number;
}

/**
 * Cijfers van een post (social_inzichten.cijfers) of extra cijfers van een account. Alles
 * optioneel: niet elk platform of elke soort post levert alles.
 */
export interface InzichtCijfers {
  bereik?: number;
  weergaven?: number;
  likes?: number;
  reacties?: number;
  opslagen?: number;
  gedeeld?: number;
  profielbezoeken?: number;
  volgers_erbij?: number;
  kijktijd_sec?: number;
  /** Gemiddelde kijktijd van een reel in seconden. */
  gem_kijktijd_sec?: number;
  interacties?: number;
  [sleutel: string]: number | undefined;
}

// ---------------------------------------------------------------------------------
// Rijen zoals ze in de database staan (alleen op de server gebruiken)
// ---------------------------------------------------------------------------------

export interface SocialAccountRij {
  id: string;
  platform: Platform;
  /** Instagram: IG-user-id; Facebook: page-id. */
  extern_id: string;
  naam: string;
  gebruikersnaam: string | null;
  afbeelding_url: string | null;
  /** De Facebookpagina waar het IG-account aan hangt, of de pagina zelf. */
  page_id: string | null;
  /** Versleuteld page access token (AES-256-GCM). Nooit naar de browser of in logs. */
  token_enc: string;
  token_verloopt_op: string | null;
  scopes: string;
  gekoppeld_door: string | null;
  gekoppeld_op: string;
  laatst_gesynct_op: string | null;
  /** Bv. 'opnieuw_koppelen' als de toegang verlopen of ingetrokken is. */
  fout: string | null;
  actief: boolean;
}

export interface SocialPostRij {
  id: string;
  status: PostStatus;
  soort: PostSoort;
  caption: string;
  eerste_reactie: string;
  /** Los veld ("#a #b"); komt achter de caption of in de eerste reactie (hashtags_plek). */
  hashtags: string;
  hashtags_plek: HashtagsPlek;
  locatie_id: string | null;
  locatie_naam: string | null;
  gebruikers_tags: GebruikersTag[];
  collaborators: string[];
  gepland_op: string | null;
  geplaatst_op: string | null;
  notities: string;
  bron: PostBron;
  aangemaakt_door: string | null;
  aangemaakt_op: string;
  gewijzigd_op: string;
}

export interface SocialPostKanaalRij {
  id: string;
  post_id: string;
  account_id: string;
  status: PostStatus;
  /** Afwijkende caption voor dit kanaal (null = die van de post). */
  caption_eigen: string | null;
  /** IG-container (reels vooraf aangemaakt). */
  container_id: string | null;
  extern_post_id: string | null;
  permalink: string | null;
  fout: string | null;
  /** Aantal mislukte pogingen tot nu toe. */
  pogingen: number;
  volgende_poging_op: string | null;
  geplaatst_op: string | null;
}

export interface SocialMediaRij {
  id: string;
  post_id: string;
  volgorde: number;
  /** Pad in de bucket {@link MEDIA_BUCKET}: <post-id>/<bestand>. */
  pad: string;
  type: MediaType;
  mime: string;
  breedte: number | null;
  hoogte: number | null;
  duur_sec: number | null;
  alt_tekst: string;
  grootte: number | null;
  aangemaakt_op: string;
}

export interface SocialInzichtRij {
  id: string;
  /** null voor posts die buiten het dashboard zijn geplaatst. */
  post_kanaal_id: string | null;
  account_id: string;
  extern_post_id: string;
  /** YYYY-MM-DD (Europe/Amsterdam). */
  datum: string;
  cijfers: InzichtCijfers;
  opgehaald_op: string;
}

export interface SocialAccountInzichtRij {
  account_id: string;
  datum: string;
  volgers: number | null;
  bereik: number | null;
  weergaven: number | null;
  profielbezoeken: number | null;
  cijfers: InzichtCijfers;
  opgehaald_op: string;
}

// ---------------------------------------------------------------------------------
// Naar de browser (DTO's): nooit tokens, container-id's of storage-paden
// ---------------------------------------------------------------------------------

/** Een gekoppeld account zoals de browser het ziet. Maak met `accountNaarDto` (kern.ts). */
export interface AccountDto {
  id: string;
  platform: Platform;
  extern_id: string;
  naam: string;
  gebruikersnaam: string | null;
  afbeelding_url: string | null;
  page_id: string | null;
  token_verloopt_op: string | null;
  gekoppeld_op: string;
  laatst_gesynct_op: string | null;
  fout: string | null;
  actief: boolean;
}

export interface AccountsAntwoord {
  accounts: AccountDto[];
  /** false als META_APP_ID/META_APP_SECRET/de sleutel ontbreken (koppelen kan dan niet). */
  ingericht: boolean;
  /** Gezet als de migratie nog niet is uitgevoerd ({@link MIGRATIE_MELDING}). */
  melding?: string;
}

export interface PostKanaalDto {
  id: string;
  account_id: string;
  platform: Platform;
  account_naam: string;
  account_gebruikersnaam: string | null;
  status: PostStatus;
  caption_eigen: string | null;
  extern_post_id: string | null;
  permalink: string | null;
  fout: string | null;
  pogingen: number;
  volgende_poging_op: string | null;
  geplaatst_op: string | null;
}

export interface MediaDto {
  id: string;
  volgorde: number;
  type: MediaType;
  mime: string;
  breedte: number | null;
  hoogte: number | null;
  duur_sec: number | null;
  alt_tekst: string;
  grootte: number | null;
  /** Kortlevende signed URL om te tonen (null als hij niet gemaakt kon worden). */
  url: string | null;
}

export interface PostDto {
  id: string;
  status: PostStatus;
  soort: PostSoort;
  caption: string;
  eerste_reactie: string;
  hashtags: string;
  hashtags_plek: HashtagsPlek;
  locatie_id: string | null;
  locatie_naam: string | null;
  gebruikers_tags: GebruikersTag[];
  collaborators: string[];
  gepland_op: string | null;
  geplaatst_op: string | null;
  notities: string;
  bron: PostBron;
  aangemaakt_door: string | null;
  aangemaakt_op: string;
  gewijzigd_op: string;
  kanalen: PostKanaalDto[];
  media: MediaDto[];
  /** Opgetelde laatste cijfers over alle kanalen (alleen bij geplaatste posts). */
  inzichten?: InzichtCijfers;
}

export interface PostsAntwoord {
  posts: PostDto[];
  melding?: string;
}

export interface PostAntwoord {
  post: PostDto;
  /** Niet-blokkerende opmerkingen (bv. "beeld wordt opgeschaald"). */
  waarschuwingen?: string[];
}

/** Query van GET /api/social/posts. van/tot = YYYY-MM-DD (Europe/Amsterdam), inclusief. */
export interface PostFilter {
  status?: PostStatus;
  /** account-id */
  kanaal?: string;
  van?: string;
  tot?: string;
}

/** Wat de browser stuurt bij POST/PATCH van een post. Controleren met `parsePost` (kern.ts). */
export interface PostInvoer {
  /** Alleen 'concept' of 'ingepland' (de rest zet de server zelf). Standaard 'concept'. */
  status?: 'concept' | 'ingepland';
  soort: PostSoort;
  caption?: string;
  eerste_reactie?: string;
  hashtags?: string;
  hashtags_plek?: HashtagsPlek;
  locatie_id?: string | null;
  locatie_naam?: string | null;
  gebruikers_tags?: GebruikersTag[];
  collaborators?: string[];
  /** ISO-tijdstip (UTC), bv. uit `amsterdamNaarUtc('2026-11-26', '19:30').toISOString()`. */
  gepland_op?: string | null;
  notities?: string;
  kanalen?: { account_id: string; caption_eigen?: string | null }[];
}

/** Een gecontroleerde post, klaar om te schrijven (uitkomst van `parsePost`). */
export interface GeldigePost {
  status: 'concept' | 'ingepland';
  soort: PostSoort;
  caption: string;
  eerste_reactie: string;
  hashtags: string;
  hashtags_plek: HashtagsPlek;
  locatie_id: string | null;
  locatie_naam: string | null;
  gebruikers_tags: GebruikersTag[];
  collaborators: string[];
  gepland_op: string | null;
  notities: string;
  kanalen: { account_id: string; caption_eigen: string | null }[];
}

/** De eigenschappen van een bestand die de mediaeisen controleren (vóór en na upload). */
export interface MediaMeta {
  type: MediaType;
  mime: string;
  breedte: number | null;
  hoogte: number | null;
  duur_sec: number | null;
  grootte: number | null;
}

export interface UploadUrlVerzoek {
  post_id: string;
  bestandsnaam: string;
  mime: string;
  grootte: number;
}

/** Upload in de browser met supabase.storage.from(MEDIA_BUCKET).uploadToSignedUrl(pad, token, bestand). */
export interface UploadUrlAntwoord {
  pad: string;
  token: string;
  signedUrl: string;
}

/** Na een geslaagde upload: het bestand registreren bij de post. */
export interface MediaRegistratie extends MediaMeta {
  pad: string;
  alt_tekst?: string;
  volgorde?: number;
}

export interface PlaatsResultaat {
  status: 'geplaatst' | 'deels' | 'mislukt';
  fouten: string[];
}

export interface AccountInzichtDto {
  datum: string;
  volgers: number | null;
  bereik: number | null;
  weergaven: number | null;
  profielbezoeken: number | null;
  cijfers: InzichtCijfers;
}

export interface PostInzichtDto {
  /** null bij een post die buiten het dashboard is geplaatst. */
  post_id: string | null;
  post_kanaal_id: string | null;
  account_id: string;
  extern_post_id: string;
  permalink: string | null;
  geplaatst_op: string | null;
  /** De laatst opgehaalde stand. */
  cijfers: InzichtCijfers;
}

export interface InzichtenAntwoord {
  van: string;
  tot: string;
  accounts: { account: AccountDto; reeks: AccountInzichtDto[] }[];
  posts: PostInzichtDto[];
  melding?: string;
}
