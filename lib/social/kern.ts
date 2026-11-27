import type {
  AccountDto,
  GebruikersTag,
  GeldigePost,
  HashtagsPlek,
  MediaMeta,
  Platform,
  PostSoort,
  PostStatus,
  SocialAccountRij
} from './types';

// Social media management (migratie 0041), alles zonder database of netwerk: statussen en
// labels, de controle van een post (parsePost) en van de media (controleerMedia), wanneer
// een post aan de beurt is, het herkansingsschema, het samenstellen van de caption en de
// omrekening Europe/Amsterdam ↔ UTC. Zonder @/-imports, zodat scripts/test-social.mjs dit
// direct kan testen en de browser het ook kan gebruiken (bv. de mediacheck vóór de upload).
//
// Bronnen voor de eisen (opgezocht november 2026):
//   - Instagram Graph API, IG User Media:
//     https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
//     caption max. 2200 tekens, 30 hashtags, 20 @-vermeldingen; collaborators max. 3; foto's
//     alleen JPEG, max. 8 MB, beeldverhouding 4:5 t/m 1.91:1, breedte 320–1440 px (kleiner
//     wordt opgeschaald, groter verkleind); reels MP4/MOV, 3 s t/m 15 min, max. 1920 px breed,
//     9:16 aanbevolen; alt-tekst max. 1000 tekens (alleen foto's). Carrousels: de docs
//     noemen nu tot 20 items, wij houden conservatief 10 aan. Carrousel-video's: 3–60 s
//     (oudere specificatie, conservatief).
//   - Facebook Page Photos: https://developers.facebook.com/docs/graph-api/reference/page/photos/
//     JPEG/PNG (ook bmp/gif/tiff), max. 10 MB. Geen WebP.
//   - Facebook Reels: https://developers.facebook.com/docs/video-api/guides/reels-publishing
//     9:16, min. 540×960, 3–90 s, 24–60 fps.
//   - Bucket social-media (0041): max. 50 MB per bestand; dat is ook de grens voor video's.

// ---------------------------------------------------------------------------------
// Statussen en labels
// ---------------------------------------------------------------------------------

export const STATUSSEN: PostStatus[] = ['concept', 'ingepland', 'bezig', 'geplaatst', 'deels', 'mislukt'];
export const STATUS_LABEL: Record<PostStatus, string> = {
  concept: 'Concept',
  ingepland: 'Ingepland',
  bezig: 'Bezig met plaatsen',
  geplaatst: 'Geplaatst',
  deels: 'Deels geplaatst',
  mislukt: 'Mislukt'
};
export const SOORTEN: PostSoort[] = ['foto', 'carrousel', 'reel', 'tekst'];
export const SOORT_LABEL: Record<PostSoort, string> = {
  foto: 'Foto',
  carrousel: 'Carrousel',
  reel: 'Reel',
  tekst: 'Alleen tekst'
};
export const PLATFORMS: Platform[] = ['instagram', 'facebook'];
export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook'
};
/** Welke soorten een platform kan plaatsen. Instagram heeft altijd beeld nodig. */
export const SOORTEN_PER_PLATFORM: Record<Platform, PostSoort[]> = {
  instagram: ['foto', 'carrousel', 'reel'],
  facebook: ['foto', 'carrousel', 'reel', 'tekst']
};

export function isStatus(s: unknown): s is PostStatus {
  return typeof s === 'string' && (STATUSSEN as string[]).includes(s);
}
export function isSoort(s: unknown): s is PostSoort {
  return typeof s === 'string' && (SOORTEN as string[]).includes(s);
}
/** Een post met deze status verandert niet meer vanzelf (geplaatst, deels, mislukt). */
export function isEindStatus(s: PostStatus): boolean {
  return s === 'geplaatst' || s === 'deels' || s === 'mislukt';
}
/** Mag een teamlid de post nog bewerken? Alleen zolang hij niet (bezig met) geplaatst is. */
export function isBewerkbaar(s: PostStatus): boolean {
  return s === 'concept' || s === 'ingepland' || s === 'mislukt';
}

/**
 * De status van een post uit die van zijn kanalen: alles geplaatst → 'geplaatst', iets
 * geplaatst en iets mislukt → 'deels', alles mislukt → 'mislukt', nog iets bezig → 'bezig',
 * anders 'ingepland' (er komt nog een herkansing). Geen kanalen → 'concept'.
 */
export function postStatusUitKanalen(statussen: PostStatus[]): PostStatus {
  if (!statussen.length) return 'concept';
  if (statussen.every((s) => s === 'geplaatst')) return 'geplaatst';
  if (statussen.some((s) => s === 'bezig')) return 'bezig';
  if (statussen.some((s) => s === 'ingepland')) return 'ingepland';
  if (statussen.every((s) => s === 'mislukt')) return 'mislukt';
  if (statussen.some((s) => s === 'geplaatst' || s === 'deels')) return 'deels';
  return 'concept';
}

/** Een account voor de browser: zonder token_enc, scopes of gekoppeld_door. */
export function accountNaarDto(r: SocialAccountRij): AccountDto {
  return {
    id: r.id,
    platform: r.platform,
    extern_id: r.extern_id,
    naam: r.naam,
    gebruikersnaam: r.gebruikersnaam,
    afbeelding_url: r.afbeelding_url,
    page_id: r.page_id,
    token_verloopt_op: r.token_verloopt_op,
    gekoppeld_op: r.gekoppeld_op,
    laatst_gesynct_op: r.laatst_gesynct_op,
    fout: r.fout,
    actief: r.actief
  };
}

// ---------------------------------------------------------------------------------
// Grenzen
// ---------------------------------------------------------------------------------

export const MAX_CAPTION = 2200;
export const MAX_TITEL = 120;
export const MAX_HASHTAGS = 30;
export const MAX_VERMELDINGEN = 20;
export const MAX_GEBRUIKERSTAGS = 20;
export const MAX_COLLABORATORS = 3;
export const CARROUSEL_MIN = 2;
export const CARROUSEL_MAX = 10;
export const MAX_ALT_TEKST = 1000;
export const MAX_NOTITIES = 5000;
/** Hoe ver vooruit een post ingepland kan worden. */
export const MAX_VOORUIT_DAGEN = 365;
export const MAX_BESTAND_BYTES = 50 * 1024 * 1024;
/** Wat de bucket social-media accepteert (zie 0041). */
export const TOEGESTANE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'] as const;

const GEBRUIKERSNAAM = /^[A-Za-z0-9._]{1,30}$/;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;
const VERMELDING = /(^|[^\p{L}\p{N}_.@])@([A-Za-z0-9._]{1,30})/gu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aantal hashtags in een tekst (#woord, ook met cijfers, letters met accent of _). */
export function telHashtags(tekst: string): number {
  return (tekst.match(HASHTAG) ?? []).length;
}

/** Aantal @-vermeldingen in een tekst (geen e-mailadressen). */
export function telVermeldingen(tekst: string): number {
  return [...tekst.matchAll(VERMELDING)].length;
}

/** Tekens zoals Instagram ze telt (code points, dus een emoji telt niet dubbel). */
export function aantalTekens(tekst: string): number {
  return [...tekst].length;
}

/**
 * Maakt van wat iemand in het hashtagveld typt een nette lijst: "zomer, #Strand  bbq" →
 * "#zomer #Strand #bbq". Dubbelen (hoofdletterongevoelig) vallen weg; woorden met tekens die
 * niet in een hashtag kunnen staan in `ongeldig`.
 */
export function normaliseerHashtags(invoer: string): { tekst: string; tags: string[]; ongeldig: string[] } {
  const tags: string[] = [];
  const ongeldig: string[] = [];
  const gezien = new Set<string>();
  for (const ruw of String(invoer ?? '').split(/[\s,;]+/)) {
    const woord = ruw.replace(/^#+/, '');
    if (!woord) continue;
    if (!/^[\p{L}\p{N}_]+$/u.test(woord)) {
      ongeldig.push(ruw);
      continue;
    }
    const sleutel = woord.toLocaleLowerCase('nl');
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    tags.push(`#${woord}`);
  }
  return { tekst: tags.join(' '), tags, ongeldig };
}

/**
 * De caption en eerste reactie zoals ze naar Meta gaan. De hashtags komen met een witregel
 * achter de caption (plek 'caption') of achter/als de eerste reactie (plek 'reactie').
 * `captionEigen` (per kanaal) vervangt de caption van de post als hij is ingevuld.
 */
export function captionSamenstellen(
  post: { caption: string; hashtags: string; hashtags_plek: HashtagsPlek; eerste_reactie: string },
  captionEigen?: string | null
): { caption: string; eersteReactie: string } {
  const basis = (captionEigen != null && captionEigen.trim() ? captionEigen : post.caption).trim();
  const tags = post.hashtags.trim();
  const reactie = post.eerste_reactie.trim();
  const plak = (a: string, b: string) => (a && b ? `${a}\n\n${b}` : a || b);
  if (post.hashtags_plek === 'reactie') return { caption: basis, eersteReactie: plak(reactie, tags) };
  return { caption: plak(basis, tags), eersteReactie: reactie };
}

// ---------------------------------------------------------------------------------
// Mediaeisen
// ---------------------------------------------------------------------------------

export interface MediaEisen {
  /** Toegestane mime-types voor dit bestand op dit platform. */
  mime: string[];
  maxBytes: number;
  /** Beeldverhouding breedte/hoogte (inclusief, met een kleine marge). */
  minVerhouding?: number;
  maxVerhouding?: number;
  minBreedte?: number;
  maxBreedte?: number;
  minHoogte?: number;
  minDuur?: number;
  maxDuur?: number;
}

const MB = 1024 * 1024;
const MARGE_VERHOUDING = 0.01;
/** 9:16 voor reels; daarbuiten een waarschuwing (Instagram snijdt bij, Facebook kan weigeren). */
const REEL_VERHOUDING = 9 / 16;

/**
 * De eisen per platform, soort en mediatype. `null` = dit mediatype kan hier niet.
 */
export function mediaEisen(platform: Platform, soort: PostSoort, type: 'afbeelding' | 'video'): MediaEisen | null {
  if (soort === 'tekst') return null;
  if (platform === 'instagram') {
    if (type === 'afbeelding') {
      if (soort === 'reel') return null;
      return { mime: ['image/jpeg'], maxBytes: 8 * MB, minVerhouding: 4 / 5, maxVerhouding: 1.91 };
    }
    if (soort === 'reel') return { mime: ['video/mp4', 'video/quicktime'], maxBytes: MAX_BESTAND_BYTES, maxBreedte: 1920, minDuur: 3, maxDuur: 15 * 60 };
    if (soort === 'carrousel')
      return { mime: ['video/mp4', 'video/quicktime'], maxBytes: MAX_BESTAND_BYTES, minVerhouding: 4 / 5, maxVerhouding: 1.91, maxBreedte: 1920, minDuur: 3, maxDuur: 60 };
    return null; // 'foto' = één afbeelding
  }
  // Facebook
  if (type === 'afbeelding') {
    if (soort === 'reel') return null;
    return { mime: ['image/jpeg', 'image/png'], maxBytes: 10 * MB };
  }
  if (soort === 'reel') return { mime: ['video/mp4', 'video/quicktime'], maxBytes: MAX_BESTAND_BYTES, minBreedte: 540, minHoogte: 960, minDuur: 3, maxDuur: 90 };
  return null; // Facebook-carrousels (meerdere foto's) kunnen alleen foto's bevatten
}

const mbTekst = (b: number) => `${Math.round(b / MB)} MB`;
const duurTekst = (s: number) => (s >= 60 ? `${Math.round((s / 60) * 10) / 10} min` : `${s} s`);

/**
 * Controleert één bestand voor alle gekozen platforms. Bruikbaar in de browser vóór de
 * upload (met de afmetingen en duur uit een <img>/<video>) en op de server bij het
 * registreren en inplannen. `fouten` blokkeren, `waarschuwingen` niet.
 */
export function controleerBestand(
  meta: MediaMeta,
  soort: PostSoort,
  platforms: Platform[],
  nummer?: number
): { fouten: string[]; waarschuwingen: string[] } {
  const fouten: string[] = [];
  const waarschuwingen: string[] = [];
  const wie = nummer != null ? `Bestand ${nummer}` : 'Dit bestand';
  const isVideo = meta.type === 'video';
  if (!(TOEGESTANE_MIME as readonly string[]).includes(meta.mime)) {
    fouten.push(`${wie}: alleen JPEG, PNG, WebP, MP4 of MOV.`);
    return { fouten, waarschuwingen };
  }
  if ((meta.mime.startsWith('video/') ? 'video' : 'afbeelding') !== meta.type) fouten.push(`${wie}: type en bestandsformaat passen niet bij elkaar.`);
  if (meta.grootte != null && meta.grootte > MAX_BESTAND_BYTES) fouten.push(`${wie} is groter dan ${mbTekst(MAX_BESTAND_BYTES)}.`);
  const verhouding = meta.breedte && meta.hoogte ? meta.breedte / meta.hoogte : null;

  for (const platform of [...new Set(platforms)]) {
    const p = PLATFORM_LABEL[platform];
    const eis = mediaEisen(platform, soort, meta.type);
    if (!eis) {
      if (soort === 'reel') fouten.push(`${wie}: een reel is één video.`);
      else if (soort === 'foto') fouten.push(`${wie}: een foto-post is één afbeelding; kies "Reel" voor een video.`);
      else if (soort === 'carrousel' && isVideo) fouten.push(`${wie}: ${p} kan geen video in een carrousel plaatsen.`);
      else fouten.push(`${wie}: past niet bij een ${SOORT_LABEL[soort].toLowerCase()}-post.`);
      continue;
    }
    if (!eis.mime.includes(meta.mime)) {
      fouten.push(
        meta.type === 'afbeelding'
          ? `${wie}: ${p} accepteert alleen ${eis.mime.map((m) => m.replace('image/', '').toUpperCase()).join(' of ')}; sla de afbeelding op als JPEG.`
          : `${wie}: ${p} accepteert alleen MP4 of MOV.`
      );
    }
    if (meta.grootte != null && meta.grootte > eis.maxBytes) fouten.push(`${wie} is te groot voor ${p} (max. ${mbTekst(eis.maxBytes)}).`);
    if (verhouding != null && eis.minVerhouding != null && eis.maxVerhouding != null) {
      if (verhouding < eis.minVerhouding - MARGE_VERHOUDING || verhouding > eis.maxVerhouding + MARGE_VERHOUDING) {
        fouten.push(`${wie}: de beeldverhouding past niet op ${p} (tussen 4:5 staand en 1,91:1 liggend). Snijd hem bij.`);
      }
    }
    if (meta.breedte != null && eis.maxBreedte != null && meta.breedte > eis.maxBreedte) fouten.push(`${wie} is te breed voor ${p} (max. ${eis.maxBreedte} px).`);
    if (eis.minBreedte != null && eis.minHoogte != null && meta.breedte != null && meta.hoogte != null && (meta.breedte < eis.minBreedte || meta.hoogte < eis.minHoogte)) {
      fouten.push(`${wie} is te klein voor een reel op ${p} (min. ${eis.minBreedte}×${eis.minHoogte} px).`);
    }
    if (isVideo && meta.duur_sec != null) {
      if (eis.minDuur != null && meta.duur_sec < eis.minDuur) fouten.push(`${wie} is te kort voor ${p} (min. ${duurTekst(eis.minDuur)}).`);
      if (eis.maxDuur != null && meta.duur_sec > eis.maxDuur) fouten.push(`${wie} is te lang voor ${p} (max. ${duurTekst(eis.maxDuur)}).`);
    }
    if (platform === 'instagram' && meta.type === 'afbeelding' && meta.breedte != null && meta.breedte < 320) {
      waarschuwingen.push(`${wie} is smaller dan 320 px; Instagram schaalt hem op (minder scherp).`);
    }
  }
  if (soort === 'reel' && verhouding != null && Math.abs(verhouding - REEL_VERHOUDING) > 0.02) {
    waarschuwingen.push(`${wie}: een reel is het best in 9:16 (staand); anders wordt hij bijgesneden.`);
  }
  if (isVideo && meta.duur_sec == null) waarschuwingen.push(`${wie}: de lengte van de video is onbekend.`);
  return { fouten: [...new Set(fouten)], waarschuwingen: [...new Set(waarschuwingen)] };
}

/**
 * Controleert alle media van een post: het aantal per soort (foto = 1 afbeelding, reel = 1
 * video, carrousel 2–10, tekst = geen media) en elk bestand met `controleerBestand`.
 */
export function controleerMedia(soort: PostSoort, media: MediaMeta[], platforms: Platform[]): { fouten: string[]; waarschuwingen: string[] } {
  const fouten: string[] = [];
  const waarschuwingen: string[] = [];
  const n = media.length;
  if (soort === 'tekst') {
    if (n) fouten.push('Een tekstpost heeft geen foto of video. Kies een andere soort of haal de bestanden weg.');
    return { fouten, waarschuwingen };
  }
  if (soort === 'foto' && n !== 1) fouten.push(n ? 'Een foto-post heeft precies één afbeelding; kies "Carrousel" voor meer.' : 'Voeg een afbeelding toe.');
  if (soort === 'reel' && n !== 1) fouten.push(n ? 'Een reel heeft precies één video.' : 'Voeg een video toe.');
  if (soort === 'carrousel' && (n < CARROUSEL_MIN || n > CARROUSEL_MAX)) fouten.push(`Een carrousel heeft ${CARROUSEL_MIN} t/m ${CARROUSEL_MAX} bestanden (nu ${n}).`);
  media.forEach((m, i) => {
    const r = controleerBestand(m, soort, platforms, n > 1 ? i + 1 : undefined);
    fouten.push(...r.fouten);
    waarschuwingen.push(...r.waarschuwingen);
  });
  return { fouten: [...new Set(fouten)], waarschuwingen: [...new Set(waarschuwingen)] };
}

// ---------------------------------------------------------------------------------
// parsePost
// ---------------------------------------------------------------------------------

export type ParseUitkomst = { ok: true; post: GeldigePost; waarschuwingen: string[] } | { ok: false; fout: string; fouten: string[] };

export interface ParseOpties {
  /** Het huidige tijdstip (voor "gepland_op in de toekomst"). */
  nu: Date;
  /** De gekoppelde accounts (uit social_accounts); kanalen moeten hierin staan en actief zijn. */
  accounts: { id: string; platform: Platform; actief: boolean }[];
  /**
   * De media van de post (bij PATCH: wat al geüpload is). Bij inplannen verplicht: zonder
   * media kan alleen een tekstpost worden ingepland. Bij een concept wordt het aantal niet
   * gecontroleerd, wel of de bestanden passen.
   */
  media?: MediaMeta[];
}

const tekst = (v: unknown, max: number): string | null => {
  if (v == null) return '';
  if (typeof v !== 'string') return null;
  return aantalTekens(v) > max ? null : v;
};
const leegNaarNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Controleert wat de browser stuurt en maakt er een {@link GeldigePost} van. Alle meldingen
 * in het Nederlands; `fout` is de eerste (voor een toast), `fouten` allemaal.
 *
 * Regels: soort bekend; caption ≤ 2200 tekens (ook samen met de hashtags als die in de
 * caption komen, en per kanaal met caption_eigen); max. 30 hashtags en 20 @-vermeldingen;
 * max. 20 gebruikerstags (alleen op afbeeldingen, alleen Instagram) en 3 collaborators;
 * kanalen bestaan en zijn actief; Instagram kan geen tekstpost; inplannen vraagt minstens
 * één kanaal, een tijdstip in de toekomst en de juiste media; een concept mag zonder datum
 * en zonder kanalen.
 *
 * Voor PATCH: voeg eerst de bestaande post en de wijzigingen samen en controleer het geheel.
 */
export function parsePost(invoer: unknown, opties: ParseOpties): ParseUitkomst {
  const fouten: string[] = [];
  const waarschuwingen: string[] = [];
  const b = (invoer && typeof invoer === 'object' ? invoer : {}) as Record<string, unknown>;

  const status = b.status == null ? 'concept' : b.status;
  if (status !== 'concept' && status !== 'ingepland') fouten.push('Een post kan alleen als concept of ingepland worden opgeslagen.');
  const soort = b.soort;
  if (!isSoort(soort)) {
    return { ok: false, fout: 'Kies de soort post (foto, carrousel, reel of tekst).', fouten: ['Kies de soort post (foto, carrousel, reel of tekst).'] };
  }
  const inplannen = status === 'ingepland';

  const titel = tekst(b.titel, MAX_TITEL);
  if (titel == null) fouten.push(`De titel is te lang (max. ${MAX_TITEL} tekens).`);
  const caption = tekst(b.caption, MAX_CAPTION);
  if (caption == null) fouten.push(`De caption is te lang (max. ${MAX_CAPTION} tekens).`);
  const eersteReactie = tekst(b.eerste_reactie, MAX_CAPTION);
  if (eersteReactie == null) fouten.push(`De eerste reactie is te lang (max. ${MAX_CAPTION} tekens).`);
  const hashtagsRuw = tekst(b.hashtags, MAX_CAPTION);
  if (hashtagsRuw == null) fouten.push('Te veel hashtags.');
  const ht = normaliseerHashtags(hashtagsRuw ?? '');
  if (ht.ongeldig.length) fouten.push(`Ongeldige hashtag: ${ht.ongeldig.slice(0, 3).join(', ')} (alleen letters, cijfers en _).`);
  const plek: HashtagsPlek = b.hashtags_plek === 'reactie' ? 'reactie' : 'caption';
  if (b.hashtags_plek != null && b.hashtags_plek !== 'caption' && b.hashtags_plek !== 'reactie') fouten.push('Kies waar de hashtags komen: in de caption of in de eerste reactie.');
  const notities = tekst(b.notities, MAX_NOTITIES);
  if (notities == null) fouten.push(`De notities zijn te lang (max. ${MAX_NOTITIES} tekens).`);

  // Kanalen
  const kanalen: GeldigePost['kanalen'] = [];
  const platforms: Platform[] = [];
  if (b.kanalen != null && !Array.isArray(b.kanalen)) fouten.push('Ongeldige kanalen.');
  for (const k of Array.isArray(b.kanalen) ? b.kanalen : []) {
    const id = k && typeof k === 'object' ? (k as Record<string, unknown>).account_id : null;
    const acc = typeof id === 'string' ? opties.accounts.find((a) => a.id === id) : undefined;
    if (!acc) {
      fouten.push('Onbekend kanaal; koppel het account opnieuw of kies een ander.');
      continue;
    }
    if (!acc.actief) fouten.push(`Het ${PLATFORM_LABEL[acc.platform]}-account staat uit.`);
    if (kanalen.some((x) => x.account_id === acc.id)) continue;
    const eigen = tekst((k as Record<string, unknown>).caption_eigen, MAX_CAPTION);
    if (eigen == null) fouten.push(`De eigen caption voor ${PLATFORM_LABEL[acc.platform]} is te lang (max. ${MAX_CAPTION} tekens).`);
    kanalen.push({ account_id: acc.id, caption_eigen: leegNaarNull(eigen) });
    platforms.push(acc.platform);
  }
  if (inplannen && !kanalen.length) fouten.push('Kies minstens één kanaal.');
  for (const p of new Set(platforms)) {
    if (!SOORTEN_PER_PLATFORM[p].includes(soort)) fouten.push(`${PLATFORM_LABEL[p]} kan geen ${soort === 'tekst' ? 'post zonder foto of video' : SOORT_LABEL[soort].toLowerCase()} plaatsen.`);
  }

  // Caption + hashtags zoals ze geplaatst worden, per kanaal
  if (caption != null && eersteReactie != null) {
    const varianten = kanalen.length ? kanalen.map((k) => k.caption_eigen) : [null];
    for (const eigen of varianten) {
      const s = captionSamenstellen({ caption, hashtags: ht.tekst, hashtags_plek: plek, eerste_reactie: eersteReactie }, eigen);
      if (aantalTekens(s.caption) > MAX_CAPTION) fouten.push(`De caption met hashtags is te lang (max. ${MAX_CAPTION} tekens).`);
      if (aantalTekens(s.eersteReactie) > MAX_CAPTION) fouten.push(`De eerste reactie met hashtags is te lang (max. ${MAX_CAPTION} tekens).`);
      if (telHashtags(s.caption) > MAX_HASHTAGS) fouten.push(`Te veel hashtags in de caption (max. ${MAX_HASHTAGS}).`);
      if (telHashtags(s.eersteReactie) > MAX_HASHTAGS) fouten.push(`Te veel hashtags in de eerste reactie (max. ${MAX_HASHTAGS}).`);
      if (telVermeldingen(s.caption) > MAX_VERMELDINGEN) fouten.push(`Te veel @-vermeldingen in de caption (max. ${MAX_VERMELDINGEN}).`);
    }
  }
  if (soort === 'tekst' && inplannen && !(caption ?? '').trim()) fouten.push('Een tekstpost heeft een tekst nodig.');

  // Gebruikerstags
  const tags: GebruikersTag[] = [];
  if (b.gebruikers_tags != null && !Array.isArray(b.gebruikers_tags)) fouten.push('Ongeldige gebruikerstags.');
  const tagLijst = Array.isArray(b.gebruikers_tags) ? b.gebruikers_tags : [];
  if (tagLijst.length > MAX_GEBRUIKERSTAGS) fouten.push(`Te veel getagde personen (max. ${MAX_GEBRUIKERSTAGS}).`);
  for (const t of tagLijst.slice(0, MAX_GEBRUIKERSTAGS)) {
    const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
    const naam = typeof o.gebruikersnaam === 'string' ? o.gebruikersnaam.trim().replace(/^@/, '') : '';
    const x = Number(o.x);
    const y = Number(o.y);
    const index = o.media_index == null ? 0 : Number(o.media_index);
    if (!GEBRUIKERSNAAM.test(naam)) {
      fouten.push(`Ongeldige Instagram-naam bij een tag: ${naam || '(leeg)'}.`);
      continue;
    }
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
      fouten.push(`De tag @${naam} staat buiten de foto.`);
      continue;
    }
    if (!Number.isInteger(index) || index < 0 || index >= CARROUSEL_MAX) {
      fouten.push(`De tag @${naam} hoort bij een onbekend bestand.`);
      continue;
    }
    const m = opties.media?.[index];
    if (opties.media && !m) fouten.push(`De tag @${naam} hoort bij een bestand dat er niet (meer) is.`);
    else if (m && m.type !== 'afbeelding') fouten.push(`@${naam}: personen taggen kan alleen op een afbeelding.`);
    if (tags.some((g) => g.gebruikersnaam.toLowerCase() === naam.toLowerCase() && g.media_index === index)) continue;
    tags.push({ gebruikersnaam: naam, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, media_index: index });
  }
  if (tags.length && soort === 'tekst') fouten.push('Een tekstpost kan geen getagde personen hebben.');

  // Collaborators
  const collaborators: string[] = [];
  if (b.collaborators != null && !Array.isArray(b.collaborators)) fouten.push('Ongeldige collaborators.');
  for (const c of Array.isArray(b.collaborators) ? b.collaborators : []) {
    const naam = typeof c === 'string' ? c.trim().replace(/^@/, '') : '';
    if (!naam) continue;
    if (!GEBRUIKERSNAAM.test(naam)) {
      fouten.push(`Ongeldige Instagram-naam bij collaborators: ${naam}.`);
      continue;
    }
    if (!collaborators.some((x) => x.toLowerCase() === naam.toLowerCase())) collaborators.push(naam);
  }
  if (collaborators.length > MAX_COLLABORATORS) fouten.push(`Max. ${MAX_COLLABORATORS} collaborators.`);
  if (collaborators.length && platforms.length && !platforms.includes('instagram')) waarschuwingen.push('Collaborators werken alleen op Instagram.');

  // Locatie
  const locatieId = leegNaarNull(b.locatie_id);
  if (locatieId && !/^\d{1,30}$/.test(locatieId)) fouten.push('Ongeldige locatie; kies hem opnieuw.');
  const locatieNaam = leegNaarNull(b.locatie_naam);
  if (locatieNaam && aantalTekens(locatieNaam) > 200) fouten.push('De naam van de locatie is te lang.');

  // Tijdstip
  let geplandOp: string | null = null;
  if (b.gepland_op != null && b.gepland_op !== '') {
    const d = typeof b.gepland_op === 'string' ? new Date(b.gepland_op) : null;
    if (!d || Number.isNaN(d.getTime())) fouten.push('Ongeldige datum of tijd.');
    else geplandOp = d.toISOString();
  }
  if (inplannen) {
    if (!geplandOp) fouten.push('Kies een datum en tijd om in te plannen.');
    else if (new Date(geplandOp).getTime() <= opties.nu.getTime()) fouten.push('Het tijdstip ligt in het verleden; kies een moment in de toekomst of plaats hem nu.');
    else if (new Date(geplandOp).getTime() - opties.nu.getTime() > MAX_VOORUIT_DAGEN * 86_400_000) fouten.push(`Inplannen kan tot ${MAX_VOORUIT_DAGEN} dagen vooruit.`);
  }

  // Media
  if (opties.media || inplannen) {
    const m = controleerMedia(soort, opties.media ?? [], platforms);
    if (inplannen) fouten.push(...m.fouten);
    else fouten.push(...m.fouten.filter((f) => /^Bestand|^Dit bestand/.test(f)));
    waarschuwingen.push(...m.waarschuwingen);
  }

  const uniek = [...new Set(fouten)];
  if (uniek.length) return { ok: false, fout: uniek[0], fouten: uniek };
  return {
    ok: true,
    waarschuwingen: [...new Set(waarschuwingen)],
    post: {
      status: status as 'concept' | 'ingepland',
      soort,
      titel: (titel ?? '').replace(/\s+/g, ' ').trim(),
      caption: (caption ?? '').trim(),
      eerste_reactie: (eersteReactie ?? '').trim(),
      hashtags: ht.tekst,
      hashtags_plek: plek,
      locatie_id: locatieId,
      locatie_naam: locatieId ? locatieNaam : null,
      gebruikers_tags: tags,
      collaborators,
      gepland_op: geplandOp,
      notities: (notities ?? '').trim(),
      kanalen
    }
  };
}

// ---------------------------------------------------------------------------------
// Wanneer aan de beurt, herkansingen
// ---------------------------------------------------------------------------------

/** De cron draait elke 5 minuten (pg_cron). */
export const CRON_INTERVAL_MIN = 5;
/**
 * Een post mag zoveel ms vóór zijn tijdstip mee in een run, zodat een run die net vóór de
 * minuut start (19:29:59) een post van 19:30 niet 5 minuten laat liggen.
 */
export const VOORUIT_MARGE_MS = 60_000;
/** Reels: de container zoveel minuten vooraf aanmaken (Meta moet de video verwerken). */
export const REEL_VOORBEREIDING_MIN = 15;
/** Is een post meer dan zoveel uur over tijd (cron lag stil), dan niet meer vanzelf plaatsen. */
export const MAX_TE_LAAT_UUR = 12;

const tijd = (t: string | Date | null | undefined): number | null => {
  if (t == null) return null;
  const ms = (t instanceof Date ? t : new Date(t)).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** Moet een ingeplande post in deze run geplaatst worden? (gepland_op ≤ nu + marge) */
export function isAanDeBeurt(geplandOp: string | Date | null | undefined, nu: Date, margeMs = VOORUIT_MARGE_MS): boolean {
  const t = tijd(geplandOp);
  return t != null && t <= nu.getTime() + margeMs;
}

/** Moet de reel-container nu worden aangemaakt? (binnen REEL_VOORBEREIDING_MIN vóór het tijdstip) */
export function isReelVoorbereidingAanDeBeurt(geplandOp: string | Date | null | undefined, nu: Date): boolean {
  const t = tijd(geplandOp);
  return t != null && t <= nu.getTime() + REEL_VOORBEREIDING_MIN * 60_000;
}

/** Is de post zo ver over tijd dat hij niet meer vanzelf geplaatst moet worden? */
export function isTeLaat(geplandOp: string | Date | null | undefined, nu: Date): boolean {
  const t = tijd(geplandOp);
  return t != null && nu.getTime() - t > MAX_TE_LAAT_UUR * 3_600_000;
}

/** Herkansingen na een mislukte poging: na 5, 15 en 60 minuten. */
export const HERKANSING_MIN = [5, 15, 60] as const;
/** Max. aantal herkansingen (dus max. 4 pogingen in totaal). */
export const MAX_HERKANSINGEN = HERKANSING_MIN.length;

/**
 * Wanneer de volgende poging is, na `pogingen` mislukte pogingen (inclusief deze).
 * 1 → nu + 5 min, 2 → + 15 min, 3 → + 60 min, 4 of meer → null (opgeven: status 'mislukt').
 * `blijvend` = een fout die een herkansing niet oplost (bv. ongeldige media, token ingetrokken).
 */
export function volgendePoging(pogingen: number, nu: Date, blijvend = false): Date | null {
  if (blijvend || pogingen < 1 || pogingen > MAX_HERKANSINGEN) return null;
  return new Date(nu.getTime() + HERKANSING_MIN[pogingen - 1] * 60_000);
}

// ---------------------------------------------------------------------------------
// Tijdzone: Europe/Amsterdam ↔ UTC
// ---------------------------------------------------------------------------------

export const TIJDZONE = 'Europe/Amsterdam';

const DELEN = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIJDZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function amsterdamDelen(d: Date): { j: number; m: number; d: number; u: number; min: number; s: number } {
  const p = Object.fromEntries(DELEN.formatToParts(d).map((x) => [x.type, x.value]));
  return { j: Number(p.year), m: Number(p.month), d: Number(p.day), u: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

/** Verschil Amsterdam − UTC in ms op dat moment (+1 u in de winter, +2 u in de zomer). */
function verschuiving(ms: number): number {
  const a = amsterdamDelen(new Date(ms));
  return Date.UTC(a.j, a.m - 1, a.d, a.u, a.min, a.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * Datum + tijd zoals in Amsterdam getypt → het echte tijdstip (UTC).
 * amsterdamNaarUtc('2026-11-26', '19:30') → 2026-11-26T18:30:00.000Z.
 * Een tijd die niet bestaat (klok vooruit, 02:30 eind maart) wordt 03:30; een dubbele tijd
 * (klok terug, 02:30 eind oktober) is de eerste (zomertijd). null bij ongeldige invoer.
 */
export function amsterdamNaarUtc(datum: string, tijdTekst: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(tijdTekst);
  if (!dm || !tm) return null;
  const [j, m, d, u, min] = [Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(tm[1]), Number(tm[2])];
  if (m < 1 || m > 12 || d < 1 || d > 31 || u > 23 || min > 59) return null;
  const alsUtc = Date.UTC(j, m - 1, d, u, min);
  const check = new Date(alsUtc);
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  // Probeer beide mogelijke verschuivingen; neem de eerste die terugrekent naar dezelfde tijd.
  const kandidaten = [alsUtc - verschuiving(alsUtc - 2 * 3_600_000), alsUtc - verschuiving(alsUtc), alsUtc - verschuiving(alsUtc + 2 * 3_600_000)].sort((a, b) => a - b);
  for (const k of kandidaten) {
    const a = amsterdamDelen(new Date(k));
    if (a.j === j && a.m === m && a.d === d && a.u === u && a.min === min) return new Date(k);
  }
  // Bestaat niet (zomertijd begint): het uur erna.
  // Met de wintertijd van vóór de omschakeling gerekend: 02:30 (+1 u) = 01:30 UTC = 03:30 zomertijd.
  return new Date(alsUtc - verschuiving(alsUtc - 2 * 3_600_000));
}

const twee = (n: number) => String(n).padStart(2, '0');

/** Een tijdstip als datum en tijd in Amsterdam: { datum: 'YYYY-MM-DD', tijd: 'HH:MM' }. */
export function utcNaarAmsterdam(t: string | Date): { datum: string; tijd: string } {
  const a = amsterdamDelen(t instanceof Date ? t : new Date(t));
  return { datum: `${a.j}-${twee(a.m)}-${twee(a.d)}`, tijd: `${twee(a.u)}:${twee(a.min)}` };
}

/** De datum (YYYY-MM-DD) in Amsterdam, bv. voor social_inzichten.datum. */
export function amsterdamDatum(t: string | Date): string {
  return utcNaarAmsterdam(t).datum;
}

const WEERGAVE = new Intl.DateTimeFormat('nl-NL', { timeZone: TIJDZONE, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const WEERGAVE_JAAR = new Intl.DateTimeFormat('nl-NL', { timeZone: TIJDZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * "donderdag 26 november 19:30" (Amsterdamse tijd). Met het jaar erbij als dat anders is dan
 * het jaar van `nu`: "vrijdag 1 januari 2027 09:00".
 */
export function formatGepland(t: string | Date, nu: Date = new Date()): string {
  const d = t instanceof Date ? t : new Date(t);
  const ander = amsterdamDelen(d).j !== amsterdamDelen(nu).j;
  const p = Object.fromEntries((ander ? WEERGAVE_JAAR : WEERGAVE).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}${ander ? ` ${p.year}` : ''} ${p.hour}:${p.minute}`;
}

// ---------------------------------------------------------------------------------
// Media-paden
// ---------------------------------------------------------------------------------

/** Een veilig pad in de bucket: <post-id>/<willekeurig>-<naam>. `willekeurig` = bv. 8 hex. */
export function maakMediaPad(postId: string, bestandsnaam: string, willekeurig: string): string | null {
  if (!UUID.test(postId) || !/^[a-z0-9]{4,32}$/i.test(willekeurig)) return null;
  const naam = String(bestandsnaam ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-*\.[-.]*/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(-80);
  return `${postId.toLowerCase()}/${willekeurig}-${naam || 'bestand'}`;
}

/** Hoort dit pad bij deze post? (geen ../, geen andere map) */
export function isMediaPadVanPost(pad: string, postId: string): boolean {
  return typeof pad === 'string' && UUID.test(postId) && new RegExp(`^${postId.toLowerCase()}/[a-z0-9][a-z0-9.-]{0,120}$`).test(pad) && !pad.includes('..');
}
