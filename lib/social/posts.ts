import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { teamlidRoute, type Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { bucketOntbreekt, kolomOntbreekt } from '@/lib/db/ontbreekt';
import { logFout } from '@/lib/log';
import {
  CARROUSEL_MAX,
  MAX_ALT_TEKST,
  MAX_BESTAND_BYTES,
  TOEGESTANE_MIME,
  amsterdamNaarUtc,
  controleerBestand,
  isBewerkbaar,
  isMediaPadVanPost,
  isStatus,
  parsePost
} from './kern';
import { MediaFout, bekijkUrls, bestandsGrootte, nieuwMediaPad, uploadUrl, verwijderBestanden } from './media';
import { alleenNotities, isDatum, samenvoegen, statussenVoorFilter, volgendeDag } from './weergave';
import {
  MIGRATIE_MELDING,
  type AccountDto,
  type GeldigePost,
  type InzichtCijfers,
  type MediaMeta,
  type MediaType,
  type Platform,
  type PostDto,
  type PostFilter,
  type PostInvoer,
  type PostStatus,
  type SocialMediaRij,
  type SocialPostKanaalRij,
  type SocialPostRij,
  type UploadUrlAntwoord
} from './types';

// Posts, kanalen en media van het social media management (migratie 0041) lezen en
// schrijven. De tabellen hebben RLS zonder policies: alles gaat via de service-role, en
// alleen ná de teamlidcontrole (socialRoute hieronder, of vereisTeamlidPagina in een pagina).
// Naar de browser gaan alleen DTO's (types.ts): nooit tokens, container-id's of storage-paden.
//
// Plaatsen doet lib/social/plaatsen.ts (cron en "Nu plaatsen"). Die claimt een post met
// `status 'ingepland' → 'bezig'`; daarom wijzigt en verwijdert deze module alleen met een
// conditionele update/delete (status nog bewerkbaar), zodat een cronrun en een bewerking
// elkaar nooit overschrijven.

// ---------------------------------------------------------------------------------
// Fouten en de route-wikkel
// ---------------------------------------------------------------------------------

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export class SocialFout extends Error {
  status: number;
  code?: string;
  fouten?: string[];
  constructor(status: number, message: string, opties: { code?: string; fouten?: string[] } = {}) {
    super(message);
    this.status = status;
    this.code = opties.code;
    this.fouten = opties.fouten;
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: GEEN_CACHE });
}

/** Foutantwoord: `error` (zoals de rest van de app) én `fout` (het social-contract). */
export function fout(status: number, melding: string, extra: { code?: string; fouten?: string[] } = {}) {
  return json({ error: melding, fout: melding, ...(extra.code ? { code: extra.code } : {}), ...(extra.fouten?.length ? { fouten: extra.fouten } : {}) }, status);
}

/** Een Supabase-fout als SocialFout (503 met de migratiemelding vóór migratie 0041). */
export function dbFout(error: unknown): SocialFout {
  if (kolomOntbreekt(error) || bucketOntbreekt(error)) return new SocialFout(503, MIGRATIE_MELDING, { code: 'migratie' });
  const code = (error as { code?: string } | null)?.code;
  if (code === '23514') return new SocialFout(400, 'De invoer voldoet niet aan de regels. Controleer de velden.');
  if (code === '23505') return new SocialFout(409, 'Dit bestaat al.');
  if (code === '23503') return new SocialFout(400, 'Dat kanaal of die post bestaat niet (meer).');
  if (code === '22P02' || code === '22003') return new SocialFout(400, 'Ongeldige invoer.');
  logFout('[social]', error);
  return new SocialFout(500, 'Er ging iets mis bij het ophalen of opslaan van de posts.');
}

type Handler<C> = (request: Request, ctx: C, service: SupabaseClient, lid: Teamlid) => Promise<Response>;

/**
 * Wikkelt een social-route: teamlidcontrole (eerste stap, via teamlidRoute: sessie, actief
 * teamlid, herkomstcheck bij wijzigende verzoeken), daarna een service-role-cliënt met het
 * bewijs van die controle, en nette Nederlandse fouten.
 */
export function socialRoute<C>(fn: Handler<C>, label = 'social') {
  return teamlidRoute<C>(
    async (request, ctx, lid) => {
      try {
        return await fn(request, ctx, createServiceRoleClient(lid.bewijs), lid);
      } catch (e) {
        if (e instanceof SocialFout) return fout(e.status, e.message, { code: e.code, fouten: e.fouten });
        if (e instanceof MediaFout) return fout(e.status, e.message, { code: e.code });
        if (kolomOntbreekt(e)) return fout(503, MIGRATIE_MELDING, { code: 'migratie' });
        throw e;
      }
    },
    { label }
  );
}

/** Leest de JSON-body; ongeldige JSON of geen object → {}. */
export async function leesJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------------
// Kolommen (bewust zonder token_enc, scopes, gekoppeld_door en container_id)
// ---------------------------------------------------------------------------------

const POST_KOLOMMEN =
  'id,status,soort,titel,caption,eerste_reactie,hashtags,hashtags_plek,locatie_id,locatie_naam,gebruikers_tags,collaborators,gepland_op,geplaatst_op,notities,bron,aangemaakt_door,aangemaakt_op,gewijzigd_op';
const KANAAL_KOLOMMEN = 'id,post_id,account_id,status,caption_eigen,extern_post_id,permalink,fout,pogingen,volgende_poging_op,geplaatst_op,beeld_url';
export const ACCOUNT_KOLOMMEN = 'id,platform,extern_id,naam,gebruikersnaam,afbeelding_url,page_id,token_verloopt_op,gekoppeld_op,laatst_gesynct_op,fout,actief';
const MEDIA_KOLOMMEN = 'id,post_id,volgorde,pad,type,mime,breedte,hoogte,duur_sec,alt_tekst,grootte';

type KanaalRij = Omit<SocialPostKanaalRij, 'container_id'>;
type MediaRij = Omit<SocialMediaRij, 'aangemaakt_op'>;

const BEWERKBAAR: PostStatus[] = ['concept', 'ingepland', 'mislukt'];
const MAX_LIJST = 500;

/** `.in()` in stukken (lange lijsten passen niet in één URL). */
async function inStukken<T>(ids: string[], fn: (stuk: string[]) => Promise<T[]>, grootte = 150): Promise<T[]> {
  const uit: T[] = [];
  for (let i = 0; i < ids.length; i += grootte) uit.push(...(await fn(ids.slice(i, i + grootte))));
  return uit;
}

// ---------------------------------------------------------------------------------
// Lezen
// ---------------------------------------------------------------------------------

/** Alle gekoppelde accounts als DTO (zonder token). */
export async function leesAccounts(service: SupabaseClient): Promise<AccountDto[]> {
  const { data, error } = await service.from('social_accounts').select(ACCOUNT_KOLOMMEN).order('platform').order('naam');
  if (error) throw dbFout(error);
  return (data ?? []) as AccountDto[];
}

/** Van elke post-kanaal de laatst opgehaalde cijfers. */
async function laatsteCijfers(service: SupabaseClient, kanaalIds: string[]): Promise<Map<string, InzichtCijfers>> {
  const uit = new Map<string, InzichtCijfers>();
  const rijen = await inStukken(kanaalIds, async (stuk) => {
    const { data, error } = await service
      .from('social_inzichten')
      .select('post_kanaal_id,datum,cijfers')
      .in('post_kanaal_id', stuk)
      .order('datum', { ascending: false })
      .limit(5000);
    if (error) throw dbFout(error);
    return (data ?? []) as { post_kanaal_id: string; datum: string; cijfers: InzichtCijfers }[];
  });
  for (const r of rijen) if (!uit.has(r.post_kanaal_id)) uit.set(r.post_kanaal_id, r.cijfers ?? {});
  return uit;
}

/** Rijen van social_posts → PostDto's met kanalen, media (signed URL's) en cijfers. */
export async function naarDtos(service: SupabaseClient, posts: SocialPostRij[], accounts?: AccountDto[]): Promise<PostDto[]> {
  if (!posts.length) return [];
  const ids = posts.map((p) => p.id);
  const [kanalen, media, accs] = await Promise.all([
    inStukken(ids, async (stuk) => {
      const { data, error } = await service.from('social_post_kanalen').select(KANAAL_KOLOMMEN).in('post_id', stuk);
      if (error) throw dbFout(error);
      return (data ?? []) as KanaalRij[];
    }),
    inStukken(ids, async (stuk) => {
      const { data, error } = await service.from('social_media').select(MEDIA_KOLOMMEN).in('post_id', stuk).order('volgorde');
      if (error) throw dbFout(error);
      return (data ?? []) as MediaRij[];
    }),
    accounts ? Promise.resolve(accounts) : leesAccounts(service)
  ]);
  const accountVan = new Map(accs.map((a) => [a.id, a]));
  const geplaatst = kanalen.filter((k) => k.extern_post_id);
  const [urls, cijfers] = await Promise.all([
    bekijkUrls(service, media.map((m) => m.pad)),
    geplaatst.length ? laatsteCijfers(service, geplaatst.map((k) => k.id)) : Promise.resolve(new Map<string, InzichtCijfers>())
  ]);

  return posts.map((p) => {
    const eigenKanalen = kanalen.filter((k) => k.post_id === p.id);
    const kanaalCijfers = eigenKanalen.map((k) => cijfers.get(k.id)).filter((c): c is InzichtCijfers => !!c);
    const dto: PostDto = {
      ...p,
      gebruikers_tags: Array.isArray(p.gebruikers_tags) ? p.gebruikers_tags : [],
      collaborators: Array.isArray(p.collaborators) ? p.collaborators : [],
      kanalen: eigenKanalen.map((k) => {
        const a = accountVan.get(k.account_id);
        return {
          id: k.id,
          account_id: k.account_id,
          platform: (a?.platform ?? 'instagram') as Platform,
          account_naam: a?.naam ?? 'Ontkoppeld account',
          account_gebruikersnaam: a?.gebruikersnaam ?? null,
          status: k.status,
          caption_eigen: k.caption_eigen,
          extern_post_id: k.extern_post_id,
          permalink: k.permalink,
          fout: k.fout,
          pogingen: k.pogingen,
          volgende_poging_op: k.volgende_poging_op,
          geplaatst_op: k.geplaatst_op,
          beeld_url: k.beeld_url ?? null
        };
      }),
      media: media
        .filter((m) => m.post_id === p.id)
        .sort((a, b) => a.volgorde - b.volgorde)
        .map((m) => ({
          id: m.id,
          volgorde: m.volgorde,
          type: m.type,
          mime: m.mime,
          breedte: m.breedte,
          hoogte: m.hoogte,
          duur_sec: m.duur_sec == null ? null : Number(m.duur_sec),
          alt_tekst: m.alt_tekst,
          grootte: m.grootte == null ? null : Number(m.grootte),
          url: urls.get(m.pad) ?? null
        }))
    };
    if (kanaalCijfers.length) {
      const som: InzichtCijfers = {};
      for (const c of kanaalCijfers) for (const [k, v] of Object.entries(c)) if (typeof v === 'number') som[k] = (som[k] ?? 0) + v;
      dto.inzichten = som;
    }
    return dto;
  });
}

/** Controleert en vertaalt de query van GET /api/social/posts. */
export function parseFilter(params: URLSearchParams): PostFilter {
  const f: PostFilter = {};
  const status = params.get('status');
  if (status) {
    if (!isStatus(status)) throw new SocialFout(400, 'Onbekende status.');
    f.status = status;
  }
  const kanaal = params.get('kanaal');
  if (kanaal) {
    if (!/^[0-9a-f-]{36}$/i.test(kanaal)) throw new SocialFout(400, 'Onbekend kanaal.');
    f.kanaal = kanaal;
  }
  for (const k of ['van', 'tot'] as const) {
    const v = params.get(k);
    if (!v) continue;
    if (!isDatum(v)) throw new SocialFout(400, 'Ongeldige datum (YYYY-MM-DD).');
    f[k] = v;
  }
  if (f.van && f.tot && f.van > f.tot) throw new SocialFout(400, 'De begindatum ligt na de einddatum.');
  return f;
}

/**
 * Posts volgens het filter. Met van/tot: posts die in die periode gepland of geplaatst zijn,
 * plus concepten zonder datum (die horen bij geen enkele maand en zouden anders zoekraken).
 */
export async function leesPosts(service: SupabaseClient, f: PostFilter): Promise<PostDto[]> {
  let q = service.from('social_posts').select(POST_KOLOMMEN).order('gewijzigd_op', { ascending: false }).limit(MAX_LIJST);
  if (f.status) q = q.in('status', statussenVoorFilter(f.status));
  if (f.kanaal) {
    const { data, error } = await service.from('social_post_kanalen').select('post_id').eq('account_id', f.kanaal).limit(2000);
    if (error) throw dbFout(error);
    const ids = [...new Set((data ?? []).map((r) => r.post_id as string))];
    if (!ids.length) return [];
    q = q.in('id', ids.slice(0, MAX_LIJST));
  }
  if (f.van || f.tot) {
    const van = f.van ? amsterdamNaarUtc(f.van, '00:00')!.toISOString() : null;
    const tot = f.tot ? amsterdamNaarUtc(volgendeDag(f.tot), '00:00')!.toISOString() : null;
    const binnen = (kolom: string) => [van ? `${kolom}.gte."${van}"` : null, tot ? `${kolom}.lt."${tot}"` : null].filter(Boolean).join(',');
    q = q.or(`and(${binnen('gepland_op')}),and(${binnen('geplaatst_op')}),and(gepland_op.is.null,geplaatst_op.is.null)`);
  }
  const { data, error } = await q;
  if (error) throw dbFout(error);
  return naarDtos(service, (data ?? []) as SocialPostRij[]);
}

async function leesPostRij(service: SupabaseClient, id: string): Promise<SocialPostRij | null> {
  const { data, error } = await service.from('social_posts').select(POST_KOLOMMEN).eq('id', id).maybeSingle();
  if (error) throw dbFout(error);
  return (data as SocialPostRij | null) ?? null;
}

/** Eén post als DTO, of null als hij niet (meer) bestaat. */
export async function leesPost(service: SupabaseClient, id: string): Promise<PostDto | null> {
  const rij = await leesPostRij(service, id);
  if (!rij) return null;
  const [dto] = await naarDtos(service, [rij]);
  return dto ?? null;
}

async function moetPost(service: SupabaseClient, id: string): Promise<PostDto> {
  const p = await leesPost(service, id);
  if (!p) throw new SocialFout(404, 'Deze post bestaat niet (meer).');
  return p;
}

const NIET_BEWERKBAAR = 'Deze post is al geplaatst of wordt nu geplaatst; alleen de notities kun je nog aanpassen.';

async function mediaRijen(service: SupabaseClient, postId: string): Promise<MediaRij[]> {
  const { data, error } = await service.from('social_media').select(MEDIA_KOLOMMEN).eq('post_id', postId).order('volgorde');
  if (error) throw dbFout(error);
  return (data ?? []) as MediaRij[];
}

const naarMeta = (m: MediaRij): MediaMeta => ({
  type: m.type,
  mime: m.mime,
  breedte: m.breedte,
  hoogte: m.hoogte,
  duur_sec: m.duur_sec == null ? null : Number(m.duur_sec),
  grootte: m.grootte == null ? null : Number(m.grootte)
});

async function parseAccounts(service: SupabaseClient) {
  const { data, error } = await service.from('social_accounts').select('id,platform,actief');
  if (error) throw dbFout(error);
  return (data ?? []) as { id: string; platform: Platform; actief: boolean }[];
}

// ---------------------------------------------------------------------------------
// Schrijven
// ---------------------------------------------------------------------------------

const postVelden = (g: GeldigePost) => ({
  status: g.status,
  soort: g.soort,
  titel: g.titel,
  caption: g.caption,
  eerste_reactie: g.eerste_reactie,
  hashtags: g.hashtags,
  hashtags_plek: g.hashtags_plek,
  locatie_id: g.locatie_id,
  locatie_naam: g.locatie_naam,
  gebruikers_tags: g.gebruikers_tags,
  collaborators: g.collaborators,
  gepland_op: g.gepland_op,
  notities: g.notities
});

/**
 * De kanalen van een post gelijktrekken met de nieuwe lijst. Elke (her)planning begint
 * schoon: status gelijk aan de post, geen fout, geen pogingen en geen oude reel-container
 * (die hoort bij de vorige caption/het vorige bestand).
 */
async function zetKanalen(service: SupabaseClient, postId: string, g: GeldigePost): Promise<void> {
  const nieuw = new Set(g.kanalen.map((k) => k.account_id));
  const { data: bestaand, error } = await service.from('social_post_kanalen').select('id,account_id').eq('post_id', postId);
  if (error) throw dbFout(error);
  const weg = (bestaand ?? []).filter((k) => !nieuw.has(k.account_id as string)).map((k) => k.id as string);
  if (weg.length) {
    const { error: e } = await service.from('social_post_kanalen').delete().in('id', weg);
    if (e) throw dbFout(e);
  }
  if (!g.kanalen.length) return;
  const { error: e } = await service.from('social_post_kanalen').upsert(
    g.kanalen.map((k) => ({
      post_id: postId,
      account_id: k.account_id,
      caption_eigen: k.caption_eigen,
      status: g.status,
      fout: null,
      pogingen: 0,
      volgende_poging_op: null,
      container_id: null
    })),
    { onConflict: 'post_id,account_id' }
  );
  if (e) throw dbFout(e);
}

/** POST /api/social/posts: een nieuwe post (concept of ingepland). */
export async function maakPost(service: SupabaseClient, lid: Teamlid, invoer: unknown): Promise<{ post: PostDto; waarschuwingen: string[] }> {
  const r = parsePost(invoer, { nu: new Date(), accounts: await parseAccounts(service), media: [] });
  if (!r.ok) throw new SocialFout(400, r.fout, { fouten: r.fouten, code: 'ongeldig' });
  const { data, error } = await service
    .from('social_posts')
    .insert({ ...postVelden(r.post), bron: 'dashboard', aangemaakt_door: lid.userId })
    .select('id')
    .single();
  if (error) throw dbFout(error);
  const id = data.id as string;
  await zetKanalen(service, id, r.post);
  return { post: await moetPost(service, id), waarschuwingen: r.waarschuwingen };
}

/**
 * PATCH /api/social/posts/[id]. De bestaande post en de wijzigingen samen worden als geheel
 * gecontroleerd (parsePost, met de al geüploade media). Een post die (bezig met) geplaatst
 * is, accepteert alleen nog notities.
 */
export async function wijzigPost(service: SupabaseClient, id: string, body: Record<string, unknown>): Promise<{ post: PostDto; waarschuwingen: string[] }> {
  const bestaand = await moetPost(service, id);
  // Alleen notities: altijd toegestaan en zonder de rest opnieuw te controleren (een
  // mislukte post blijft dan ook 'mislukt' in plaats van terug te vallen naar concept).
  if (alleenNotities(body) || !isBewerkbaar(bestaand.status)) {
    if (!alleenNotities(body)) throw new SocialFout(409, NIET_BEWERKBAAR, { code: 'niet_bewerkbaar' });
    const notities = typeof body.notities === 'string' ? body.notities.trim() : '';
    if ([...notities].length > 5000) throw new SocialFout(400, 'De notities zijn te lang (max. 5000 tekens).');
    const { error } = await service.from('social_posts').update({ notities, gewijzigd_op: new Date().toISOString() }).eq('id', id);
    if (error) throw dbFout(error);
    return { post: await moetPost(service, id), waarschuwingen: [] };
  }

  const media = await mediaRijen(service, id);
  const samen = samenvoegen(bestaand, body as Partial<PostInvoer>);
  const r = parsePost(samen, { nu: new Date(), accounts: await parseAccounts(service), media: media.map(naarMeta) });
  if (!r.ok) throw new SocialFout(400, r.fout, { fouten: r.fouten, code: 'ongeldig' });

  const { data, error } = await service
    .from('social_posts')
    .update({ ...postVelden(r.post), gewijzigd_op: new Date().toISOString() })
    .eq('id', id)
    .in('status', BEWERKBAAR)
    .select('id');
  if (error) throw dbFout(error);
  if (!data?.length) throw new SocialFout(409, 'De post wordt op dit moment geplaatst; probeer het zo opnieuw.', { code: 'bezig' });
  await zetKanalen(service, id, r.post);
  return { post: await moetPost(service, id), waarschuwingen: r.waarschuwingen };
}

/**
 * DELETE /api/social/posts/[id]. Een ingeplande post wordt geannuleerd (terug naar concept,
 * er wordt niets geplaatst); met `definitief` of bij een andere status gaat hij weg, met zijn
 * bestanden. Een post die nu geplaatst wordt, blijft staan. Een geplaatste post verdwijnt
 * alleen uit het dashboard, niet van Instagram of Facebook.
 */
export async function verwijderPost(service: SupabaseClient, id: string, definitief: boolean): Promise<{ geannuleerd: boolean; post?: PostDto }> {
  const bestaand = await moetPost(service, id);
  if (bestaand.status === 'bezig') throw new SocialFout(409, 'De post wordt op dit moment geplaatst en kan nu niet weg.', { code: 'bezig' });

  if (bestaand.status === 'ingepland' && !definitief) {
    const { data, error } = await service
      .from('social_posts')
      .update({ status: 'concept', gewijzigd_op: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'ingepland')
      .select('id');
    if (error) throw dbFout(error);
    if (!data?.length) throw new SocialFout(409, 'De post wordt op dit moment geplaatst; annuleren lukt niet meer.', { code: 'bezig' });
    const { error: e } = await service
      .from('social_post_kanalen')
      .update({ status: 'concept', container_id: null, volgende_poging_op: null })
      .eq('post_id', id)
      .eq('status', 'ingepland');
    if (e) throw dbFout(e);
    return { geannuleerd: true, post: await moetPost(service, id) };
  }

  const paden = (await mediaRijen(service, id)).map((m) => m.pad);
  const { data, error } = await service.from('social_posts').delete().eq('id', id).neq('status', 'bezig').select('id');
  if (error) throw dbFout(error);
  if (!data?.length) throw new SocialFout(409, 'De post wordt op dit moment geplaatst en kan nu niet weg.', { code: 'bezig' });
  await verwijderBestanden(service, paden);
  return { geannuleerd: false };
}

/**
 * Voorbereiding van "Nu plaatsen": de post wordt gecontroleerd alsof hij nu ingepland wordt
 * en krijgt status 'ingepland' met het huidige tijdstip. Daarna roept de route plaatsPost
 * aan, die hem claimt ('ingepland' → 'bezig'); een cronrun die tegelijk loopt, claimt hem
 * dan niet nog eens.
 */
export async function klaarVoorNu(service: SupabaseClient, id: string): Promise<void> {
  const bestaand = await moetPost(service, id);
  if (!isBewerkbaar(bestaand.status)) throw new SocialFout(409, 'Deze post is al geplaatst of wordt nu geplaatst.', { code: 'niet_bewerkbaar' });
  const nu = new Date();
  const media = await mediaRijen(service, id);
  // Een tijdstip net na `nu`, zodat de controle "in de toekomst" slaagt.
  const samen = samenvoegen(bestaand, { status: 'ingepland', gepland_op: new Date(nu.getTime() + 1000).toISOString() });
  const r = parsePost(samen, { nu, accounts: await parseAccounts(service), media: media.map(naarMeta) });
  if (!r.ok) throw new SocialFout(400, r.fout, { fouten: r.fouten, code: 'ongeldig' });
  const post = { ...r.post, gepland_op: nu.toISOString() };
  const { data, error } = await service
    .from('social_posts')
    .update({ ...postVelden(post), gewijzigd_op: nu.toISOString() })
    .eq('id', id)
    .in('status', BEWERKBAAR)
    .select('id');
  if (error) throw dbFout(error);
  if (!data?.length) throw new SocialFout(409, 'De post wordt op dit moment al geplaatst.', { code: 'bezig' });
  await zetKanalen(service, id, post);
}

// ---------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------

async function moetBewerkbarePost(service: SupabaseClient, postId: string): Promise<SocialPostRij> {
  const p = await leesPostRij(service, postId);
  if (!p) throw new SocialFout(404, 'Deze post bestaat niet (meer).');
  if (!isBewerkbaar(p.status)) throw new SocialFout(409, 'De bestanden van een geplaatste post kun je niet meer wijzigen.', { code: 'niet_bewerkbaar' });
  return p;
}

const isMime = (m: unknown): m is string => typeof m === 'string' && (TOEGESTANE_MIME as readonly string[]).includes(m);
const MB = 1024 * 1024;

/** POST /api/social/media/upload-url: pad kiezen en een signed upload-URL maken. */
export async function maakUploadUrl(service: SupabaseClient, body: Record<string, unknown>): Promise<UploadUrlAntwoord> {
  const postId = typeof body.post_id === 'string' ? body.post_id : '';
  if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new SocialFout(400, 'Sla de post eerst op.');
  if (!isMime(body.mime)) throw new SocialFout(400, 'Alleen JPEG, PNG, WebP, MP4 of MOV.');
  const grootte = Number(body.grootte);
  if (!Number.isFinite(grootte) || grootte <= 0) throw new SocialFout(400, 'Dit bestand is leeg.');
  if (grootte > MAX_BESTAND_BYTES) throw new SocialFout(400, `Dit bestand is te groot (max. ${MAX_BESTAND_BYTES / MB} MB).`);
  await moetBewerkbarePost(service, postId);
  const { count, error } = await service.from('social_media').select('id', { count: 'exact', head: true }).eq('post_id', postId);
  if (error) throw dbFout(error);
  if ((count ?? 0) >= CARROUSEL_MAX) throw new SocialFout(400, `Een post heeft max. ${CARROUSEL_MAX} bestanden.`);
  const pad = nieuwMediaPad(postId, String(body.bestandsnaam ?? 'bestand'));
  if (!pad) throw new SocialFout(400, 'Ongeldige post.');
  return uploadUrl(service, pad);
}

const positiefGeheel = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== '' && Number.isInteger(n) && n > 0 && n < 100_000 ? n : null;
};

/**
 * POST /api/social/posts/[id]/media, drie vormen:
 *   { pad, type, mime, breedte, hoogte, duur_sec, alt_tekst? }  een geüpload bestand aanmelden
 *   { volgorde: [media-id, …] }                                  de volgorde vastleggen
 *   { media_id, alt_tekst }                                       de alt-tekst van één bestand
 */
export async function wijzigMedia(service: SupabaseClient, postId: string, body: Record<string, unknown>): Promise<{ post: PostDto; waarschuwingen: string[] }> {
  const post = await moetBewerkbarePost(service, postId);
  const bestaand = await mediaRijen(service, postId);

  if (Array.isArray(body.volgorde)) {
    const ids = body.volgorde.filter((x): x is string => typeof x === 'string');
    const eigen = new Set(bestaand.map((m) => m.id));
    if (ids.length !== bestaand.length || new Set(ids).size !== ids.length || !ids.every((x) => eigen.has(x))) {
      throw new SocialFout(400, 'De volgorde klopt niet meer; vernieuw de pagina.');
    }
    for (const [i, mediaId] of ids.entries()) {
      const { error } = await service.from('social_media').update({ volgorde: i }).eq('id', mediaId).eq('post_id', postId);
      if (error) throw dbFout(error);
    }
    await raakAan(service, postId);
    return { post: await moetPost(service, postId), waarschuwingen: [] };
  }

  if (typeof body.media_id === 'string') {
    const m = bestaand.find((x) => x.id === body.media_id);
    if (!m) throw new SocialFout(404, 'Dit bestand bestaat niet (meer).');
    const alt = typeof body.alt_tekst === 'string' ? body.alt_tekst.trim() : '';
    if ([...alt].length > MAX_ALT_TEKST) throw new SocialFout(400, `De alt-tekst is te lang (max. ${MAX_ALT_TEKST} tekens).`);
    const { error } = await service.from('social_media').update({ alt_tekst: alt }).eq('id', m.id);
    if (error) throw dbFout(error);
    await raakAan(service, postId);
    return { post: await moetPost(service, postId), waarschuwingen: [] };
  }

  // Aanmelden na de upload.
  const pad = typeof body.pad === 'string' ? body.pad : '';
  if (!isMediaPadVanPost(pad, postId)) throw new SocialFout(400, 'Ongeldig bestand.');
  if (!isMime(body.mime)) throw new SocialFout(400, 'Alleen JPEG, PNG, WebP, MP4 of MOV.');
  const type: MediaType = body.mime.startsWith('video/') ? 'video' : 'afbeelding';
  if (body.type != null && body.type !== type) throw new SocialFout(400, 'Type en bestandsformaat passen niet bij elkaar.');
  if (bestaand.some((m) => m.pad === pad)) return { post: await moetPost(service, postId), waarschuwingen: [] };
  if (bestaand.length >= CARROUSEL_MAX) throw new SocialFout(400, `Een post heeft max. ${CARROUSEL_MAX} bestanden.`);
  const grootte = await bestandsGrootte(service, pad);
  if (grootte == null) throw new SocialFout(400, 'Het bestand is (nog) niet geüpload. Probeer het opnieuw.');
  if (grootte > MAX_BESTAND_BYTES) {
    await verwijderBestanden(service, [pad]);
    throw new SocialFout(400, `Dit bestand is te groot (max. ${MAX_BESTAND_BYTES / MB} MB).`);
  }
  const duur = body.duur_sec == null || body.duur_sec === '' ? null : Number(body.duur_sec);
  const alt = typeof body.alt_tekst === 'string' ? body.alt_tekst.trim().slice(0, MAX_ALT_TEKST) : '';
  const meta: MediaMeta = {
    type,
    mime: body.mime,
    breedte: positiefGeheel(body.breedte),
    hoogte: positiefGeheel(body.hoogte),
    duur_sec: duur != null && Number.isFinite(duur) && duur >= 0 ? Math.round(duur * 100) / 100 : null,
    grootte
  };
  const volgorde = bestaand.length ? Math.max(...bestaand.map((m) => m.volgorde)) + 1 : 0;
  const { error } = await service.from('social_media').insert({ post_id: postId, pad, volgorde, alt_tekst: alt, ...meta });
  if (error) throw dbFout(error);
  await raakAan(service, postId);

  // De controle per bestand geeft hier alleen waarschuwingen: bij een concept mag de soort of
  // het kanaal nog veranderen. Inplannen controleert alles opnieuw (parsePost).
  const { data: kanalen } = await service.from('social_post_kanalen').select('account_id').eq('post_id', postId);
  const accounts = await parseAccounts(service);
  const platforms = (kanalen ?? []).map((k) => accounts.find((a) => a.id === k.account_id)?.platform).filter((p): p is Platform => !!p);
  const c = controleerBestand(meta, post.soort, platforms);
  return { post: await moetPost(service, postId), waarschuwingen: [...c.fouten, ...c.waarschuwingen] };
}

/** DELETE /api/social/media/[id]: bestand weg uit de post en uit Storage. */
export async function verwijderMedia(service: SupabaseClient, mediaId: string): Promise<{ post: PostDto }> {
  const { data, error } = await service.from('social_media').select('id,post_id,pad').eq('id', mediaId).maybeSingle();
  if (error) throw dbFout(error);
  if (!data) throw new SocialFout(404, 'Dit bestand bestaat niet (meer).');
  await moetBewerkbarePost(service, data.post_id as string);
  const { error: e } = await service.from('social_media').delete().eq('id', mediaId);
  if (e) throw dbFout(e);
  await verwijderBestanden(service, [data.pad as string]);
  await raakAan(service, data.post_id as string);
  return { post: await moetPost(service, data.post_id as string) };
}

/**
 * Na een wijziging aan de bestanden: gewijzigd_op bijwerken én een vooraf gemaakte
 * reel-container (of vooraf geüploade Facebook-video) vergeten, want die hoort bij het oude
 * bestand. De cron maakt hem dan opnieuw. Kanalen die nu 'bezig' zijn blijven ongemoeid.
 */
async function raakAan(service: SupabaseClient, postId: string): Promise<void> {
  const { error } = await service.from('social_posts').update({ gewijzigd_op: new Date().toISOString() }).eq('id', postId).in('status', BEWERKBAAR);
  if (error) throw dbFout(error);
  const { error: e } = await service
    .from('social_post_kanalen')
    .update({ container_id: null })
    .eq('post_id', postId)
    .in('status', BEWERKBAAR)
    .not('container_id', 'is', null);
  if (e) throw dbFout(e);
}

// ---------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------

/** De eerstvolgende ingeplande posts en het aantal concepten (dashboardkaart). */
export async function dashboardSocial(service: SupabaseClient, aantal = 3): Promise<{ komend: PostDto[]; concepten: number; mislukt: number }> {
  const sinds = new Date(Date.now() - 60 * 60_000).toISOString();
  const [komend, concepten, mislukt] = await Promise.all([
    service.from('social_posts').select(POST_KOLOMMEN).in('status', ['ingepland', 'bezig']).gte('gepland_op', sinds).order('gepland_op').limit(aantal),
    service.from('social_posts').select('id', { count: 'exact', head: true }).eq('status', 'concept'),
    service.from('social_posts').select('id', { count: 'exact', head: true }).in('status', ['mislukt', 'deels']).gte('gewijzigd_op', new Date(Date.now() - 7 * 86_400_000).toISOString())
  ]);
  for (const r of [komend, concepten, mislukt]) if (r.error) throw dbFout(r.error);
  return {
    komend: await naarDtos(service, (komend.data ?? []) as SocialPostRij[]),
    concepten: concepten.count ?? 0,
    mislukt: mislukt.count ?? 0
  };
}

// ---------------------------------------------------------------------------------
// Pagina's (server components): na vereisTeamlidPagina
// ---------------------------------------------------------------------------------

/** De accounts voor een pagina; vóór migratie 0041 een lege lijst met de melding. */
export async function accountsVoorPagina(lid: Teamlid): Promise<{ accounts: AccountDto[]; melding: string | null }> {
  try {
    return { accounts: await leesAccounts(createServiceRoleClient(lid.bewijs)), melding: null };
  } catch (e) {
    if (e instanceof SocialFout && e.code === 'migratie') return { accounts: [], melding: MIGRATIE_MELDING };
    throw e;
  }
}

/** Eén post voor de editor-pagina (null = bestaat niet; migratie ontbreekt → melding). */
export async function postVoorPagina(lid: Teamlid, id: string): Promise<{ post: PostDto | null; melding: string | null }> {
  try {
    return { post: await leesPost(createServiceRoleClient(lid.bewijs), id), melding: null };
  } catch (e) {
    if (e instanceof SocialFout && e.code === 'migratie') return { post: null, melding: MIGRATIE_MELDING };
    throw e;
  }
}
