import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logFout, logWaarschuwing } from '@/lib/log';
import { amsterdamDatum, amsterdamNaarUtc, MAX_CAPTION } from './kern';
import { alleAccounts, markeerAccount, tokenVan } from './koppeling';
import { graph } from './meta/client';
import { ingericht } from './meta/config';
import {
  ACCOUNT_FOUT,
  accountInzichtenNaarCijfers,
  FB_PAGINA_METRICS,
  FB_POST_METRICS,
  fbPostNaarCijfers,
  fbSoort,
  isProfielWijziging,
  IG_ACCOUNT_METRICS,
  igInzichtenNaarCijfers,
  igMediaMetrics,
  igSoort,
  MetaFout,
  tokenOordeel,
  verlooptOp
} from './meta/kern';
import { debugToken } from './meta/oauth';
import type { InzichtCijfers, PostSoort, SocialAccountRij } from './types';

// Ophalen bij Meta (migratie 0041), per account:
//   1. de tokencontrole (debug_token): ongeldig/verlopen → fout 'opnieuw_koppelen', bijna
//      verlopen → 'verloopt_binnenkort' (een page token kan niet zonder jou ververst worden:
//      opnieuw koppelen ververst hem); token_verloopt_op bijwerken;
//   2. naam, profielfoto en volgers;
//   3. de posts van de laatste SYNC_DAGEN: wat buiten het dashboard is geplaatst komt erbij
//      als bron 'extern' (status 'geplaatst', een kanaal met extern_post_id en permalink);
//      de unieke index (account_id, extern_post_id) voorkomt dubbelen;
//   4. de cijfers per post (social_inzichten, één rij per post per dag; de stand van vandaag
//      wordt bij elke sync overschreven) voor posts van de laatste INZICHT_DAGEN;
//   5. de cijfers van het account per dag (social_account_inzichten) voor gisteren en vandaag.
// De cron doet dit eens per SYNC_INTERVAL_UUR; POST /api/social/sync kan het nu laten doen.

export const SYNC_INTERVAL_UUR = 6;
/** Handmatig niet vaker dan dit (Meta heeft limieten per uur). */
const MIN_HANDMATIG_MIN = 2;
const SYNC_DAGEN = 365;
const INZICHT_DAGEN = 30;
const MAX_INZICHT_POSTS = 25;

interface Uitkomst {
  account: string;
  nieuw: number;
  inzichten: number;
  fout?: string;
}

export async function syncAlles(
  service: SupabaseClient,
  nu: Date,
  opties: { alleenNodig?: boolean; max?: number; deadline?: number } = {}
): Promise<Record<string, unknown>> {
  if (!ingericht()) return { status: 'niet_ingericht' };
  let accounts: SocialAccountRij[];
  try {
    accounts = await alleAccounts(service);
  } catch (e) {
    if (tabelOntbreekt(e) || (e as { code?: string }).code === 'tabel_ontbreekt') return { status: 'migratie_ontbreekt' };
    throw e;
  }
  const grensMs = (opties.alleenNodig ? SYNC_INTERVAL_UUR * 60 : MIN_HANDMATIG_MIN) * 60_000;
  const lijst = accounts
    .filter((a) => a.actief && a.token_enc)
    .filter((a) => !a.laatst_gesynct_op || nu.getTime() - new Date(a.laatst_gesynct_op).getTime() >= grensMs)
    .sort((a, b) => (a.laatst_gesynct_op ?? '').localeCompare(b.laatst_gesynct_op ?? ''))
    .slice(0, opties.max ?? 20);

  const uitkomsten: Uitkomst[] = [];
  for (const a of lijst) {
    if (opties.deadline && opties.deadline - Date.now() < 45_000) break;
    uitkomsten.push(await syncAccount(service, a, nu));
  }
  return {
    status: 'ok',
    accounts: uitkomsten.length,
    nieuw: uitkomsten.reduce((t, u) => t + u.nieuw, 0),
    inzichten: uitkomsten.reduce((t, u) => t + u.inzichten, 0),
    fouten: uitkomsten.filter((u) => u.fout).map((u) => `${u.account}: ${u.fout}`)
  };
}

export async function syncAccount(service: SupabaseClient, account: SocialAccountRij, nu: Date): Promise<Uitkomst> {
  const label = account.gebruikersnaam ? `@${account.gebruikersnaam}` : account.naam;
  const uit: Uitkomst = { account: label, nieuw: 0, inzichten: 0 };
  const token = tokenVan(account);
  if (!token) {
    await markeerAccount(service, account.id, ACCOUNT_FOUT.opnieuw_koppelen);
    return { ...uit, fout: 'De toegang ontbreekt; koppel het account opnieuw.' };
  }
  try {
    // 1. Token
    try {
      const info = await debugToken(token);
      const oordeel = tokenOordeel(info, nu);
      const op = verlooptOp(info);
      await markeerAccount(service, account.id, oordeel, { token_verloopt_op: op ? op.toISOString() : null });
      if (oordeel === 'opnieuw_koppelen') return { ...uit, fout: 'De toegang is verlopen; koppel het account opnieuw.' };
    } catch (e) {
      // debug_token zelf mislukt (storing): gewoon doorgaan, de echte aanroepen zeggen het wel.
      logWaarschuwing('[social-sync] tokencontrole', e instanceof MetaFout ? e.detail : e);
    }

    const r = account.platform === 'instagram' ? await syncInstagram(service, account, token, nu) : await syncFacebook(service, account, token, nu);
    uit.nieuw = r.nieuw;
    uit.inzichten = r.inzichten;
    const u = await service.from('social_accounts').update({ laatst_gesynct_op: nu.toISOString(), ...r.profiel }).eq('id', account.id);
    if (u.error) logFout('[social-sync] account bijwerken', u.error);
  } catch (e) {
    if (e instanceof MetaFout) {
      logWaarschuwing(`[social-sync] ${account.platform} ${e.soort}`, e.detail);
      if (e.soort === 'opnieuw_koppelen') await markeerAccount(service, account.id, ACCOUNT_FOUT.opnieuw_koppelen);
      if (e.soort === 'geen_rechten') await markeerAccount(service, account.id, ACCOUNT_FOUT.geen_rechten);
      // Ook bij een fout niet elke 5 minuten opnieuw: pas na het interval.
      await service.from('social_accounts').update({ laatst_gesynct_op: nu.toISOString() }).eq('id', account.id);
      return { ...uit, fout: e.message };
    }
    logFout('[social-sync] account', e);
    return { ...uit, fout: 'Ophalen mislukt.' };
  }
  return uit;
}

// ---------------------------------------------------------------------------------
// Gedeeld: externe posts en cijfers opslaan
// ---------------------------------------------------------------------------------

interface ExternePost {
  id: string;
  soort: PostSoort;
  caption: string;
  permalink: string | null;
  tijd: string;
  /** Eerste slide of videoomslag (CDN-URL van Meta). */
  beeld: string | null;
}

/** Alleen een https-URL van redelijke lengte bewaren (de rest: geen beeld). */
function veiligBeeld(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('https://') && url.length <= 4000 ? url : null;
}

/** De bekende kanalen van dit account: extern_post_id → kanaal-id. */
async function bekendeKanalen(service: SupabaseClient, accountId: string): Promise<Map<string, string>> {
  const { data, error } = await service.from('social_post_kanalen').select('id,extern_post_id').eq('account_id', accountId).not('extern_post_id', 'is', null);
  if (error) throw error;
  return new Map(((data ?? []) as { id: string; extern_post_id: string }[]).map((r) => [r.extern_post_id, r.id]));
}

/** Nieuwe externe posts opslaan (post + kanaal); de kanaal-id's komen in `bekend`. */
async function slaExternOp(service: SupabaseClient, accountId: string, posts: ExternePost[], bekend: Map<string, string>): Promise<number> {
  let nieuw = 0;
  for (const p of posts) {
    if (bekend.has(p.id)) continue;
    const ins = await service
      .from('social_posts')
      .insert({
        status: 'geplaatst',
        soort: p.soort,
        caption: [...p.caption].slice(0, MAX_CAPTION).join(''),
        bron: 'extern',
        geplaatst_op: p.tijd,
        aangemaakt_op: p.tijd,
        gewijzigd_op: new Date().toISOString()
      })
      .select('id')
      .single();
    if (ins.error || !ins.data) {
      logFout('[social-sync] externe post opslaan', ins.error);
      continue;
    }
    const postId = (ins.data as { id: string }).id;
    const k = await service
      .from('social_post_kanalen')
      .insert({ post_id: postId, account_id: accountId, status: 'geplaatst', extern_post_id: p.id, permalink: p.permalink?.slice(0, 2000) ?? null, geplaatst_op: p.tijd, beeld_url: p.beeld })
      .select('id')
      .single();
    if (k.error || !k.data) {
      // Intussen al opgeslagen (dubbele run of net door het dashboard geplaatst): de lege post weg.
      await service.from('social_posts').delete().eq('id', postId);
      if ((k.error as { code?: string } | null)?.code !== '23505') logFout('[social-sync] extern kanaal opslaan', k.error);
      continue;
    }
    bekend.set(p.id, (k.data as { id: string }).id);
    nieuw++;
  }
  return nieuw;
}

/**
 * Eerder opgeslagen profielwijzigingen (omslagfoto e.d.) weer weg: alleen posts van buiten
 * het dashboard, en hun cijfers. Wat via het dashboard is geplaatst blijft altijd staan.
 */
async function ruimProfielWijzigingenOp(service: SupabaseClient, accountId: string, externIds: string[], bekend: Map<string, string>): Promise<void> {
  const kanaalIds = externIds.map((id) => bekend.get(id)).filter((id): id is string => !!id);
  if (externIds.length) {
    const { error } = await service.from('social_inzichten').delete().eq('account_id', accountId).in('extern_post_id', externIds);
    if (error) logFout('[social-sync] cijfers profielwijziging opruimen', error);
  }
  if (!kanaalIds.length) return;
  const { data, error } = await service.from('social_post_kanalen').select('post_id').in('id', kanaalIds);
  if (error) return logFout('[social-sync] profielwijzigingen zoeken', error);
  const postIds = [...new Set((data ?? []).map((r) => r.post_id as string))];
  if (!postIds.length) return;
  const weg = await service.from('social_posts').delete().in('id', postIds).eq('bron', 'extern');
  if (weg.error) logFout('[social-sync] profielwijzigingen opruimen', weg.error);
  for (const id of externIds) bekend.delete(id);
}

/**
 * De beelden van bekende posts verversen (CDN-URL's van Meta verlopen na een paar dagen).
 * Ook voor posts die via het dashboard zijn geplaatst, zodat elke kaart een beeld heeft.
 */
async function ververBeelden(service: SupabaseClient, accountId: string, posts: ExternePost[], bekend: Map<string, string>): Promise<void> {
  for (const p of posts) {
    const kanaalId = bekend.get(p.id);
    if (!kanaalId || !p.beeld) continue;
    const { error } = await service.from('social_post_kanalen').update({ beeld_url: p.beeld }).eq('id', kanaalId).eq('account_id', accountId);
    if (error) {
      // Migratie 0043 nog niet uitgevoerd: niet blijven proberen.
      if ((error as { code?: string }).code === '42703' || (error as { code?: string }).code === 'PGRST204') return;
      logFout('[social-sync] beeld bijwerken', error);
    }
  }
}

async function slaInzichtenOp(
  service: SupabaseClient,
  rijen: { account_id: string; extern_post_id: string; post_kanaal_id: string | null; datum: string; cijfers: InzichtCijfers }[]
): Promise<number> {
  if (!rijen.length) return 0;
  const opgehaald = new Date().toISOString();
  const { error } = await service
    .from('social_inzichten')
    .upsert(rijen.map((r) => ({ ...r, opgehaald_op: opgehaald })), { onConflict: 'account_id,extern_post_id,datum' });
  if (error) {
    logFout('[social-sync] inzichten opslaan', error);
    return 0;
  }
  return rijen.length;
}

async function slaAccountDagOp(
  service: SupabaseClient,
  accountId: string,
  datum: string,
  c: InzichtCijfers,
  volgers: number | null
): Promise<void> {
  const rij: Record<string, unknown> = {
    account_id: accountId,
    datum,
    bereik: c.bereik ?? null,
    weergaven: c.weergaven ?? null,
    profielbezoeken: c.profielbezoeken ?? null,
    cijfers: c,
    opgehaald_op: new Date().toISOString()
  };
  if (volgers != null) rij.volgers = volgers;
  const { error } = await service.from('social_account_inzichten').upsert(rij, { onConflict: 'account_id,datum' });
  if (error) logFout('[social-sync] accountcijfers opslaan', error);
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/** Begin van vandaag en gisteren in Amsterdam (als Date), plus de datums. */
function dagen(nu: Date): { vandaag: string; gisteren: string; beginVandaag: Date; beginGisteren: Date } {
  const vandaag = amsterdamDatum(nu);
  const g = new Date(`${vandaag}T12:00:00Z`);
  g.setUTCDate(g.getUTCDate() - 1);
  const gisteren = g.toISOString().slice(0, 10);
  const beginVandaag = amsterdamNaarUtc(vandaag, '00:00') ?? new Date(nu.getTime() - 86_400_000);
  const beginGisteren = amsterdamNaarUtc(gisteren, '00:00') ?? new Date(beginVandaag.getTime() - 86_400_000);
  return { vandaag, gisteren, beginVandaag, beginGisteren };
}

// ---------------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------------

interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  media_url?: string;
  thumbnail_url?: string;
}

async function syncInstagram(service: SupabaseClient, a: SocialAccountRij, token: string, nu: Date) {
  const ig = a.extern_id;
  const profiel = await graph<{ username?: string; name?: string; profile_picture_url?: string; followers_count?: number }>(token, `/${ig}`, {
    params: { fields: 'username,name,profile_picture_url,followers_count' }
  });

  const sinds = nu.getTime() - SYNC_DAGEN * 86_400_000;
  const lijst: IgMedia[] = [];
  let na: string | undefined;
  for (let i = 0; i < 6; i++) {
    const d = await graph<{ data?: IgMedia[]; paging?: { cursors?: { after?: string }; next?: string } }>(token, `/${ig}/media`, {
      params: { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,media_url,thumbnail_url', limit: 50, after: na }
    });
    const pagina = (d.data ?? []).filter((m) => typeof m.id === 'string' && /^\d{1,40}$/.test(m.id));
    lijst.push(...pagina);
    const oudste = pagina[pagina.length - 1]?.timestamp;
    na = d.paging?.next ? d.paging?.cursors?.after : undefined;
    if (!na || (oudste && new Date(oudste).getTime() < sinds)) break;
  }
  const recent = lijst.filter((m) => m.timestamp && new Date(m.timestamp).getTime() >= sinds);

  const bekend = await bekendeKanalen(service, a.id);
  const extern = recent.map((m) => ({
    id: m.id,
    soort: igSoort(m.media_type, m.media_product_type),
    caption: m.caption ?? '',
    permalink: m.permalink ?? null,
    tijd: new Date(m.timestamp!).toISOString(),
    // Video: de omslag. Foto en carrousel: media_url is de (eerste) foto.
    beeld: veiligBeeld(m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url ?? m.thumbnail_url)
  }));
  const nieuw = await slaExternOp(service, a.id, extern, bekend);
  await ververBeelden(service, a.id, extern, bekend);

  // Cijfers per post
  const vandaag = amsterdamDatum(nu);
  const inzichtGrens = nu.getTime() - INZICHT_DAGEN * 86_400_000;
  const rijen = [];
  for (const m of recent.filter((x) => new Date(x.timestamp!).getTime() >= inzichtGrens).slice(0, MAX_INZICHT_POSTS)) {
    let cijfers: InzichtCijfers = {};
    try {
      const d = await graph<{ data?: [] }>(token, `/${m.id}/insights`, { params: { metric: igMediaMetrics(m.media_type, m.media_product_type).join(',') } });
      cijfers = igInzichtenNaarCijfers(d.data);
    } catch (e) {
      // Een metric die (voor deze post) niet bestaat laat alles mislukken: dan de basis.
      if (!(e instanceof MetaFout) || e.soort === 'opnieuw_koppelen') throw e;
      try {
        const d = await graph<{ data?: [] }>(token, `/${m.id}/insights`, { params: { metric: 'reach,likes,comments,saved,shares' } });
        cijfers = igInzichtenNaarCijfers(d.data);
      } catch {
        /* geen inzichten voor deze post (bv. te oud of van voor de omzetting naar zakelijk) */
      }
    }
    if (cijfers.likes == null && typeof m.like_count === 'number') cijfers.likes = m.like_count;
    if (cijfers.reacties == null && typeof m.comments_count === 'number') cijfers.reacties = m.comments_count;
    rijen.push({ account_id: a.id, extern_post_id: m.id, post_kanaal_id: bekend.get(m.id) ?? null, datum: vandaag, cijfers });
  }
  // Oudere posts: geen inzichten-aanroep, wel de likes en reacties die Meta gratis meestuurt.
  const metInzicht = new Set(rijen.map((r) => r.extern_post_id));
  for (const m of recent) {
    if (metInzicht.has(m.id) || (typeof m.like_count !== 'number' && typeof m.comments_count !== 'number')) continue;
    const cijfers: InzichtCijfers = {};
    if (typeof m.like_count === 'number') cijfers.likes = m.like_count;
    if (typeof m.comments_count === 'number') cijfers.reacties = m.comments_count;
    rijen.push({ account_id: a.id, extern_post_id: m.id, post_kanaal_id: bekend.get(m.id) ?? null, datum: vandaag, cijfers });
  }
  const inzichten = await slaInzichtenOp(service, rijen);

  // Cijfers van het account: gisteren (volledig) en vandaag (tot nu).
  const d = dagen(nu);
  const volgers = typeof profiel.followers_count === 'number' ? profiel.followers_count : null;
  for (const [datum, van, tot] of [
    [d.gisteren, d.beginGisteren, d.beginVandaag],
    [d.vandaag, d.beginVandaag, nu]
  ] as const) {
    try {
      const r = await graph<{ data?: [] }>(token, `/${ig}/insights`, {
        params: { metric: IG_ACCOUNT_METRICS.join(','), period: 'day', metric_type: 'total_value', since: unix(van), until: Math.max(unix(tot), unix(van) + 1) }
      });
      // Volgers horen bij vandaag; die van gisteren blijven zoals ze toen waren.
      await slaAccountDagOp(service, a.id, datum, accountInzichtenNaarCijfers(r.data), datum === d.vandaag ? volgers : null);
    } catch (e) {
      if (!(e instanceof MetaFout) || e.soort === 'opnieuw_koppelen') throw e;
      logWaarschuwing('[social-sync] ig accountcijfers', e.detail);
      if (datum === d.vandaag && volgers != null) await slaAccountDagOp(service, a.id, datum, {}, volgers);
    }
  }

  return {
    nieuw,
    inzichten,
    profiel: {
      naam: String(profiel.name || profiel.username || a.naam).slice(0, 200),
      gebruikersnaam: profiel.username?.slice(0, 100) ?? a.gebruikersnaam,
      afbeelding_url: profiel.profile_picture_url?.slice(0, 2000) ?? a.afbeelding_url
    }
  };
}

// ---------------------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------------------

interface FbPost {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  story?: string;
  status_type?: string;
  attachments?: { data?: { media_type?: string; type?: string; subattachments?: { data?: unknown[] } }[] };
}

async function syncFacebook(service: SupabaseClient, a: SocialAccountRij, token: string, nu: Date) {
  const page = a.page_id || a.extern_id;
  const profiel = await graph<{ name?: string; followers_count?: number; picture?: { data?: { url?: string } } }>(token, `/${page}`, {
    params: { fields: 'name,followers_count,picture{url}' }
  });

  const sinds = nu.getTime() - SYNC_DAGEN * 86_400_000;
  const d = await graph<{ data?: FbPost[] }>(token, `/${page}/published_posts`, {
    params: { fields: 'id,message,story,status_type,created_time,permalink_url,full_picture,attachments{media_type,type,subattachments}', limit: 100, since: unix(new Date(sinds)) }
  });
  const alles = (d.data ?? []).filter((p) => typeof p.id === 'string' && /^[\d_]{1,80}$/.test(p.id) && p.created_time);
  // Nieuwe omslagfoto, profielfoto e.d. zijn geen echte posts: overslaan.
  const recent = alles.filter((p) => !isProfielWijziging(p));

  const bekend = await bekendeKanalen(service, a.id);
  await ruimProfielWijzigingenOp(service, a.id, alles.filter((p) => isProfielWijziging(p)).map((p) => p.id), bekend);
  const extern = recent.map((p) => ({
    id: p.id,
    soort: fbSoort(p),
    caption: p.message ?? '',
    permalink: p.permalink_url ?? null,
    tijd: new Date(p.created_time!).toISOString(),
    beeld: veiligBeeld(p.full_picture)
  }));
  const nieuw = await slaExternOp(service, a.id, extern, bekend);
  await ververBeelden(service, a.id, extern, bekend);

  const vandaag = amsterdamDatum(nu);
  const inzichtGrens = nu.getTime() - INZICHT_DAGEN * 86_400_000;
  const rijen = [];
  for (const p of recent.filter((x) => new Date(x.created_time!).getTime() >= inzichtGrens).slice(0, MAX_INZICHT_POSTS)) {
    try {
      const [ins, tellers] = await Promise.all([
        graph<{ data?: [] }>(token, `/${p.id}/insights`, { params: { metric: FB_POST_METRICS.join(',') } }).catch((e) => {
          if (e instanceof MetaFout && e.soort !== 'opnieuw_koppelen') return { data: [] as [] };
          throw e;
        }),
        graph<{ comments?: { summary?: { total_count?: number } }; shares?: { count?: number } }>(token, `/${p.id}`, {
          params: { fields: 'comments.limit(0).summary(true),shares' }
        })
      ]);
      rijen.push({ account_id: a.id, extern_post_id: p.id, post_kanaal_id: bekend.get(p.id) ?? null, datum: vandaag, cijfers: fbPostNaarCijfers(ins.data, tellers) });
    } catch (e) {
      if (!(e instanceof MetaFout) || e.soort === 'opnieuw_koppelen') throw e;
    }
  }
  const inzichten = await slaInzichtenOp(service, rijen);

  // Paginacijfers per dag. Facebook telt dagen in Pacific-tijd; end_time is het einde van
  // die dag, dus de datum is end_time min 12 uur (benadering, goed genoeg voor een overzicht).
  const dg = dagen(nu);
  const volgers = typeof profiel.followers_count === 'number' ? profiel.followers_count : null;
  try {
    const r = await graph<{ data?: { name?: string; values?: { value?: unknown; end_time?: string }[] }[] }>(token, `/${page}/insights`, {
      params: { metric: FB_PAGINA_METRICS.join(','), period: 'day', since: unix(dg.beginGisteren), until: unix(nu) }
    });
    const perDag = new Map<string, { name: string; values: { value: unknown }[] }[]>();
    for (const m of r.data ?? []) {
      for (const v of m.values ?? []) {
        if (!v.end_time || !m.name) continue;
        const datum = new Date(new Date(v.end_time).getTime() - 12 * 3_600_000).toISOString().slice(0, 10);
        const lijst = perDag.get(datum) ?? [];
        lijst.push({ name: m.name, values: [{ value: v.value }] });
        perDag.set(datum, lijst);
      }
    }
    for (const [datum, data] of perDag) {
      if (datum !== dg.vandaag && datum !== dg.gisteren) continue;
      await slaAccountDagOp(service, a.id, datum, accountInzichtenNaarCijfers(data), datum === dg.vandaag ? volgers : null);
    }
    if (!perDag.has(dg.vandaag) && volgers != null) await slaAccountDagOp(service, a.id, dg.vandaag, {}, volgers);
  } catch (e) {
    if (!(e instanceof MetaFout) || e.soort === 'opnieuw_koppelen') throw e;
    logWaarschuwing('[social-sync] fb paginacijfers', e.detail);
    if (volgers != null) await slaAccountDagOp(service, a.id, dg.vandaag, {}, volgers);
  }

  return {
    nieuw,
    inzichten,
    profiel: {
      naam: String(profiel.name || a.naam).slice(0, 200),
      afbeelding_url: profiel.picture?.data?.url?.slice(0, 2000) ?? a.afbeelding_url
    }
  };
}
