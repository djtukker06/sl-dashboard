import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logFout, logWaarschuwing } from '@/lib/log';
import {
  captionSamenstellen,
  controleerMedia,
  isAanDeBeurt,
  isReelVoorbereidingAanDeBeurt,
  isTeLaat,
  postStatusUitKanalen,
  PLATFORM_LABEL,
  REEL_VOORBEREIDING_MIN,
  SOORTEN_PER_PLATFORM,
  utcNaarAmsterdam,
  volgendePoging
} from './kern';
import { accountsMetIds, markeerAccount, tokenVan } from './koppeling';
import { publiekeMediaUrl } from './media';
import { fbReelUpload, graph, wacht } from './meta/client';
import { ingericht } from './meta/config';
import {
  ACCOUNT_FOUT,
  containerStap,
  fbFeedParams,
  fbFotoParams,
  fbPostId,
  fbReelAfrondParams,
  fbVideoStap,
  igContainerPlan,
  MetaFout,
  type MediaVoorMeta,
  type Params
} from './meta/kern';
import { syncAlles } from './sync';
import { MIGRATIE_MELDING, type PlaatsResultaat, type PostStatus, type SocialAccountRij, type SocialMediaRij, type SocialPostKanaalRij, type SocialPostRij } from './types';

// Automatisch plaatsen op Instagram en Facebook (migratie 0041).
//
// Stipt op tijd: pg_cron roept elke 5 minuten /api/cron/social aan (UITVOEREN_0041_cron.sql),
// en `verwerkSocialCron` doet dan, in deze volgorde (het tijdkritische eerst):
//   1. onderbroken runs opruimen: een post die al >15 min op 'bezig' staat (functie viel
//      om) → die kanalen 'mislukt' met een duidelijke melding. Nooit blind opnieuw: misschien
//      staat hij al online, en dubbel plaatsen is erger dan een melding;
//   2. reels voorbereiden: REEL_VOORBEREIDING_MIN minuten vóór het tijdstip de container
//      aanmaken (Instagram) of de video laten uploaden (Facebook), zodat Meta de video al
//      heeft verwerkt als hij geplaatst moet worden;
//   3. plaatsen: alles wat aan de beurt is (isAanDeBeurt) en kanalen waarvan de herkansing
//      (volgende_poging_op) is verstreken;
//   4. eens per ~6 uur per account: externe posts, inzichten en de tokencontrole (sync.ts).
//
// Nooit dubbel: een post wordt eerst geclaimd met een conditionele update (status
// 'ingepland' → 'bezig', alleen als hij nog 'ingepland' was) en daarna elk kanaal apart
// (zelfde truc), zoals lib/invoice/terugkerend.ts. Wie geen rij terugkrijgt, doet niets.
//
// Mislukt een kanaal, dan krijgt het een Nederlandse fout (de UI toont die), pogingen + 1 en
// een herkansing volgens `volgendePoging` (na 5, 15, 60 min). Fouten die een herkansing niet
// oplost (ongeldige media, token ingetrokken) gaan direct naar 'mislukt'. De post-status is
// de samenvatting van zijn kanalen (`postStatusUitKanalen`).

const POST_KOLOMMEN =
  'id,status,soort,caption,eerste_reactie,hashtags,hashtags_plek,locatie_id,locatie_naam,gebruikers_tags,collaborators,gepland_op,geplaatst_op,notities,bron,aangemaakt_door,aangemaakt_op,gewijzigd_op';
const KANAAL_KOLOMMEN = 'id,post_id,account_id,status,caption_eigen,container_id,extern_post_id,permalink,fout,pogingen,volgende_poging_op,geplaatst_op';
const MEDIA_KOLOMMEN = 'id,post_id,volgorde,pad,type,mime,breedte,hoogte,duur_sec,alt_tekst,grootte,aangemaakt_op';

/** Zo lang mag een post op 'bezig' staan voordat hij als onderbroken geldt. */
const ONDERBROKEN_MIN = 15;
/** Signed URL's voor Meta: video's langer (verwerking duurt even), foto's korter. */
const URL_SEC_FOTO = 60 * 60;
const URL_SEC_VIDEO = 3 * 60 * 60;
/** Een video die Meta na zoveel minuten na het tijdstip nog verwerkt, telt als poging. */
const NIET_KLAAR_GEDULD_MIN = 30;
/** Een cronrun stopt met nieuw werk na zoveel ms (maxDuration van de route is 300 s). */
export const CRON_BUDGET_MS = 240_000;

export const ONDERBROKEN_MELDING =
  'Het plaatsen is onderbroken. Controleer op Instagram/Facebook of de post er staat; zo niet, plaats hem opnieuw.';
const NIET_INGERICHT = 'Meta is nog niet ingericht op de server (META_APP_ID, META_APP_SECRET en een sleutel).';

interface Ctx {
  service: SupabaseClient;
  nu: Date;
  /** Tijdstip (ms) waarna geen nieuw werk meer begint. */
  deadline: number;
}

const tijdOver = (ctx: Ctx) => ctx.deadline - Date.now();

// ---------------------------------------------------------------------------------
// Plaatsen van één post
// ---------------------------------------------------------------------------------

/**
 * Plaatst een post nu op al zijn (nog niet geplaatste) kanalen. Standaard handmatig ("Nu
 * plaatsen"): een concept, ingeplande, mislukte of deels geplaatste post mag; de pogingen
 * beginnen opnieuw. De cron gebruikt `{ handmatig: false }`: alleen ingeplande posts en
 * alleen kanalen waarvan de (her)kansing is aangebroken.
 */
export async function plaatsPost(
  service: SupabaseClient,
  postId: string,
  opties: { handmatig?: boolean; nu?: Date; deadline?: number } = {}
): Promise<PlaatsResultaat> {
  const nu = opties.nu ?? new Date();
  const ctx: Ctx = { service, nu, deadline: opties.deadline ?? Date.now() + CRON_BUDGET_MS };
  const r = await plaatsIntern(ctx, postId, opties.handmatig ?? true);
  return { status: r.status, fouten: r.fouten };
}

interface InternResultaat extends PlaatsResultaat {
  geclaimd: boolean;
  geplaatst: number;
  herkansing: number;
  mislukt: number;
}

async function plaatsIntern(ctx: Ctx, postId: string, handmatig: boolean): Promise<InternResultaat> {
  const leeg = (fout: string, geclaimd = false): InternResultaat => ({ status: 'mislukt', fouten: [fout], geclaimd, geplaatst: 0, herkansing: 0, mislukt: 0 });
  if (!ingericht()) return leeg(NIET_INGERICHT);
  const { service, nu } = ctx;

  const p = await service.from('social_posts').select(POST_KOLOMMEN).eq('id', postId).maybeSingle();
  if (p.error) {
    if (tabelOntbreekt(p.error)) return leeg(MIGRATIE_MELDING);
    logFout('[social] post lezen', p.error);
    return leeg('De post kon niet worden gelezen.');
  }
  const post = p.data as SocialPostRij | null;
  if (!post) return leeg('Deze post bestaat niet (meer).');
  if (post.bron === 'extern') return leeg('Deze post is buiten het dashboard geplaatst.');

  // 1. De post claimen (alleen als de status nog is wat we lazen).
  const magVan: PostStatus[] = handmatig ? ['concept', 'ingepland', 'mislukt', 'deels'] : ['ingepland'];
  if (!magVan.includes(post.status)) {
    return leeg(post.status === 'bezig' ? 'Deze post wordt op dit moment al geplaatst.' : 'Deze post is al geplaatst.');
  }
  const claimVelden: Record<string, unknown> = { status: 'bezig', gewijzigd_op: nu.toISOString() };
  // "Nu plaatsen": het tijdstip wordt nu (nodig voor een herkansing: 'ingepland' vraagt een datum).
  if (handmatig && (!post.gepland_op || new Date(post.gepland_op).getTime() > nu.getTime())) claimVelden.gepland_op = nu.toISOString();
  const claim = await service.from('social_posts').update(claimVelden).eq('id', post.id).eq('status', post.status).select('id').maybeSingle();
  if (claim.error) {
    logFout('[social] post claimen', claim.error);
    return leeg('De post kon niet worden vastgezet om te plaatsen.');
  }
  if (!claim.data) return leeg('Deze post wordt op dit moment al geplaatst.');
  if (claimVelden.gepland_op) post.gepland_op = claimVelden.gepland_op as string;

  const uit: InternResultaat = { status: 'mislukt', fouten: [], geclaimd: true, geplaatst: 0, herkansing: 0, mislukt: 0 };
  try {
    const [k, m] = await Promise.all([
      service.from('social_post_kanalen').select(KANAAL_KOLOMMEN).eq('post_id', post.id),
      service.from('social_media').select(MEDIA_KOLOMMEN).eq('post_id', post.id).order('volgorde')
    ]);
    if (k.error || m.error) throw k.error ?? m.error;
    const kanalen = (k.data ?? []) as SocialPostKanaalRij[];
    const media = (m.data ?? []) as SocialMediaRij[];
    if (!kanalen.length) uit.fouten.push('Er is geen kanaal gekozen.');
    const accounts = await accountsMetIds(service, kanalen.map((x) => x.account_id));

    // 2. Welke kanalen nu? Handmatig: alles wat nog niet geplaatst is. Cron: ingepland en de
    //    herkansing (als die er is) is aangebroken.
    const aanDeBeurt = kanalen.filter((x) =>
      handmatig
        ? x.status === 'concept' || x.status === 'ingepland' || x.status === 'mislukt'
        : (x.status === 'ingepland' || x.status === 'concept') && (!x.volgende_poging_op || new Date(x.volgende_poging_op).getTime() <= nu.getTime())
    );

    for (const kanaal of aanDeBeurt) {
      const account = accounts.get(kanaal.account_id);
      const naam = account ? accountLabel(account) : 'Onbekend account';
      if (tijdOver(ctx) < 20_000) {
        // Geen tijd meer in deze run: de volgende run (5 min) pakt hem op.
        if (!handmatig) continue;
        uit.fouten.push(`${naam}: niet geplaatst (geen tijd meer); probeer het zo opnieuw.`);
        continue;
      }
      // 3. Het kanaal claimen.
      const kc = await service
        .from('social_post_kanalen')
        .update({ status: 'bezig', ...(handmatig ? { pogingen: 0, fout: null, volgende_poging_op: null } : {}) })
        .eq('id', kanaal.id)
        .eq('status', kanaal.status)
        .select('id')
        .maybeSingle();
      if (kc.error || !kc.data) continue;
      if (handmatig) kanaal.pogingen = 0;

      const r = await plaatsKanaal(ctx, post, kanaal, account ?? null, media);
      if (r.ok) {
        uit.geplaatst++;
        if (r.waarschuwing) uit.fouten.push(`${naam}: ${r.waarschuwing}`);
      } else if (r.volgende) {
        uit.herkansing++;
        uit.fouten.push(`${naam}: ${r.melding} Nieuwe poging om ${utcNaarAmsterdam(r.volgende).tijd}.`);
      } else if (r.wachten) {
        uit.herkansing++;
        uit.fouten.push(`${naam}: ${r.melding} Hij wordt over een paar minuten geplaatst.`);
      } else {
        uit.mislukt++;
        uit.fouten.push(`${naam}: ${r.melding}`);
      }
    }
  } catch (e) {
    logFout('[social] plaatsen', e);
    uit.fouten.push('Er ging iets mis bij het plaatsen. Probeer het opnieuw.');
  } finally {
    // 4. De claim loslaten: de post-status is de samenvatting van zijn kanalen.
    const status = await werkPostStatusBij(service, post.id);
    uit.status = status === 'geplaatst' ? 'geplaatst' : status === 'deels' || uit.geplaatst > 0 ? 'deels' : 'mislukt';
  }
  return uit;
}

function accountLabel(a: SocialAccountRij): string {
  return `${PLATFORM_LABEL[a.platform]} (${a.gebruikersnaam ? `@${a.gebruikersnaam}` : a.naam})`;
}

/** De post-status opnieuw uit de kanalen; geplaatst_op = het eerste geplaatste kanaal. */
async function werkPostStatusBij(service: SupabaseClient, postId: string): Promise<PostStatus> {
  const { data, error } = await service.from('social_post_kanalen').select('status,geplaatst_op').eq('post_id', postId);
  if (error) {
    logFout('[social] kanalen lezen', error);
    // Niet op 'bezig' laten hangen: terug naar ingepland, de volgende run kijkt opnieuw.
    await service.from('social_posts').update({ status: 'ingepland' }).eq('id', postId).eq('status', 'bezig');
    return 'ingepland';
  }
  const rijen = (data ?? []) as { status: PostStatus; geplaatst_op: string | null }[];
  let status = postStatusUitKanalen(rijen.map((r) => r.status));
  // Een post zonder kanalen of met alleen concept-kanalen gaat terug naar mislukt i.p.v. "concept".
  if (status === 'concept') status = 'mislukt';
  const geplaatst = rijen.map((r) => r.geplaatst_op).filter((t): t is string => Boolean(t)).sort()[0] ?? null;
  const u = await service
    .from('social_posts')
    .update({ status, geplaatst_op: geplaatst, gewijzigd_op: new Date().toISOString() })
    .eq('id', postId)
    .eq('status', 'bezig');
  if (u.error) logFout('[social] poststatus bijwerken', u.error);
  return status;
}

// ---------------------------------------------------------------------------------
// Eén kanaal
// ---------------------------------------------------------------------------------

type KanaalUitkomst =
  | { ok: true; waarschuwing: string | null }
  | { ok: false; melding: string; volgende: Date | null; wachten: boolean };

interface Geplaatst {
  externId: string;
  permalink: string | null;
}

async function plaatsKanaal(
  ctx: Ctx,
  post: SocialPostRij,
  kanaal: SocialPostKanaalRij,
  account: SocialAccountRij | null,
  media: SocialMediaRij[]
): Promise<KanaalUitkomst> {
  const { service } = ctx;
  // Het (eventueel net aangemaakte) container-id bijhouden, zodat een herkansing het hergebruikt.
  const stand = { containerId: kanaal.container_id };
  try {
    const token = account ? tokenVan(account) : null;
    if (!account || !account.actief || !token) {
      throw new MetaFout({
        soort: 'opnieuw_koppelen',
        melding: 'Dit account is ontkoppeld of de toegang is verlopen. Koppel het opnieuw via Social → Koppelingen.',
        blijvend: true
      });
    }
    // De mediaeisen nog één keer (bij "Nu plaatsen" kan de controle bij het inplannen ontbreken).
    if (!SOORTEN_PER_PLATFORM[account.platform].includes(post.soort)) {
      throw new MetaFout({ soort: 'ongeldig', melding: `Dit soort post kan niet op ${PLATFORM_LABEL[account.platform]}.`, blijvend: true });
    }
    const check = controleerMedia(post.soort, media, [account.platform]);
    if (check.fouten.length) throw new MetaFout({ soort: 'media', melding: check.fouten.join(' '), blijvend: true });

    const { caption, eersteReactie } = captionSamenstellen(post, kanaal.caption_eigen);
    const metaMedia = await mediaVoorMeta(service, media);
    const g =
      account.platform === 'instagram'
        ? await plaatsInstagram(ctx, account, token, post, metaMedia, caption, kanaal, stand)
        : await plaatsFacebook(ctx, account, token, post, metaMedia, caption, kanaal, stand);

    let waarschuwing: string | null = null;
    if (eersteReactie) {
      try {
        await graph(token, `/${g.externId}/comments`, { methode: 'POST', params: { message: eersteReactie } });
      } catch (e) {
        const m = e instanceof MetaFout ? e.message : 'onbekende fout';
        if (e instanceof MetaFout) logWaarschuwing('[social] eerste reactie', e.detail);
        waarschuwing = `Geplaatst, maar de eerste reactie lukte niet (${m}) Plaats hem zelf in de app.`;
      }
    }
    await slaGeplaatstOp(service, kanaal, account.id, g, waarschuwing, stand.containerId);
    return { ok: true, waarschuwing };
  } catch (e) {
    return verwerkFout(ctx, post, kanaal, account, e, stand.containerId);
  }
}

async function mediaVoorMeta(service: SupabaseClient, media: SocialMediaRij[]): Promise<MediaVoorMeta[]> {
  const uit: MediaVoorMeta[] = [];
  for (const m of media) {
    try {
      uit.push({ type: m.type, url: await publiekeMediaUrl(service, m.pad, m.type === 'video' ? URL_SEC_VIDEO : URL_SEC_FOTO), alt_tekst: m.alt_tekst ?? '' });
    } catch {
      throw new MetaFout({ soort: 'tijdelijk', melding: 'Een bestand kon niet worden klaargezet voor Meta.', blijvend: false });
    }
  }
  return uit;
}

async function slaGeplaatstOp(
  service: SupabaseClient,
  kanaal: SocialPostKanaalRij,
  accountId: string,
  g: Geplaatst,
  waarschuwing: string | null,
  containerId: string | null
): Promise<void> {
  const velden = {
    status: 'geplaatst',
    extern_post_id: g.externId.slice(0, 100),
    permalink: g.permalink?.slice(0, 2000) ?? null,
    geplaatst_op: new Date().toISOString(),
    fout: waarschuwing ? waarschuwing.slice(0, 1000) : null,
    volgende_poging_op: null,
    container_id: containerId
  };
  let u = await service.from('social_post_kanalen').update(velden).eq('id', kanaal.id);
  if (u.error && (u.error as { code?: string }).code === '23505') {
    // De sync was sneller en heeft deze post al als 'extern' opgeslagen: die kopie weg.
    await verwijderExterneKopie(service, accountId, velden.extern_post_id);
    u = await service.from('social_post_kanalen').update(velden).eq('id', kanaal.id);
  }
  if (u.error) logFout('[social] geplaatst opslaan', u.error);
}

async function verwijderExterneKopie(service: SupabaseClient, accountId: string, externId: string): Promise<void> {
  const { data } = await service.from('social_post_kanalen').select('post_id').eq('account_id', accountId).eq('extern_post_id', externId);
  const ids = ((data ?? []) as { post_id: string }[]).map((r) => r.post_id);
  if (ids.length) await service.from('social_posts').delete().in('id', ids).eq('bron', 'extern');
}

async function verwerkFout(
  ctx: Ctx,
  post: SocialPostRij,
  kanaal: SocialPostKanaalRij,
  account: SocialAccountRij | null,
  e: unknown,
  containerId: string | null
): Promise<KanaalUitkomst> {
  const { service, nu } = ctx;
  const fout =
    e instanceof MetaFout
      ? e
      : new MetaFout({ soort: 'tijdelijk', melding: 'Er ging iets mis bij het plaatsen. Het wordt zo opnieuw geprobeerd.', blijvend: false });
  if (e instanceof MetaFout) {
    if (e.detail) logWaarschuwing(`[social] plaatsen ${account?.platform ?? ''} ${fout.soort}`, e.detail);
  } else logFout('[social] plaatsen', e);

  if (account && fout.soort === 'opnieuw_koppelen' && account.actief) await markeerAccount(service, account.id, ACCOUNT_FOUT.opnieuw_koppelen);
  if (account && fout.soort === 'geen_rechten') await markeerAccount(service, account.id, ACCOUNT_FOUT.geen_rechten);

  // Een video die Meta nog verwerkt, kort na het tijdstip: geen poging, gewoon de volgende run.
  const sindsTijdstip = post.gepland_op ? nu.getTime() - new Date(post.gepland_op).getTime() : 0;
  if (fout.soort === 'niet_klaar' && sindsTijdstip < NIET_KLAAR_GEDULD_MIN * 60_000) {
    await service
      .from('social_post_kanalen')
      .update({ status: 'ingepland', fout: null, volgende_poging_op: null, container_id: containerId })
      .eq('id', kanaal.id);
    return { ok: false, melding: fout.message, volgende: null, wachten: true };
  }

  const pogingen = (kanaal.pogingen ?? 0) + 1;
  const volgende = volgendePoging(pogingen, nu, fout.blijvend);
  const u = await service
    .from('social_post_kanalen')
    .update({
      status: volgende ? 'ingepland' : 'mislukt',
      pogingen,
      volgende_poging_op: volgende ? volgende.toISOString() : null,
      fout: fout.message.slice(0, 1000),
      container_id: fout.nieuweContainer ? null : containerId
    })
    .eq('id', kanaal.id);
  if (u.error) logFout('[social] fout opslaan', u.error);
  return { ok: false, melding: fout.message, volgende, wachten: false };
}

// ---------------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------------

/** Wacht tot een container klaar is (status_code FINISHED), of gooit niet_klaar/container. */
async function wachtOpContainer(ctx: Ctx, token: string, id: string, maxMs: number, stapMs: number): Promise<void> {
  const tot = Math.min(Date.now() + maxMs, ctx.deadline);
  for (;;) {
    const s = await graph<{ status_code?: string; status?: string }>(token, `/${id}`, { params: { fields: 'status_code,status' } });
    const stap = containerStap(s.status_code);
    if (stap === 'klaar') return;
    if (stap === 'al_geplaatst') {
      throw new MetaFout({ soort: 'ongeldig', melding: 'Deze post lijkt al op Instagram te staan. Controleer het account.', blijvend: true });
    }
    if (stap === 'opnieuw') {
      const reden = String(s.status ?? '').replace(/\s+/g, ' ').slice(0, 160);
      throw new MetaFout({
        soort: 'container',
        melding: `Instagram kon het bestand niet verwerken${reden ? ` (${reden})` : ''}. Er wordt een nieuwe poging gedaan.`,
        blijvend: false,
        nieuweContainer: true
      });
    }
    if (Date.now() + stapMs > tot) throw new MetaFout({ soort: 'niet_klaar', melding: 'Instagram is de video nog aan het verwerken.', blijvend: false });
    await wacht(stapMs);
  }
}

async function maakIgContainer(token: string, igId: string, params: Params): Promise<string> {
  const r = await graph<{ id?: string }>(token, `/${igId}/media`, { methode: 'POST', params });
  if (!r.id) throw new MetaFout({ soort: 'tijdelijk', melding: 'Instagram gaf geen container terug. Het wordt zo opnieuw geprobeerd.', blijvend: false });
  return r.id;
}

async function plaatsInstagram(
  ctx: Ctx,
  account: SocialAccountRij,
  token: string,
  post: SocialPostRij,
  media: MediaVoorMeta[],
  caption: string,
  kanaal: SocialPostKanaalRij,
  stand: { containerId: string | null }
): Promise<Geplaatst> {
  const igId = account.extern_id;
  const plan = igContainerPlan(post, media, caption);
  let containerId: string;

  if (post.soort === 'reel') {
    containerId = stand.containerId ?? '';
    if (!containerId) {
      containerId = await maakIgContainer(token, igId, plan.hoofd);
      stand.containerId = containerId;
      // Meteen bewaren: lukt het nu niet, dan gebruikt de herkansing dezelfde container.
      await ctx.service.from('social_post_kanalen').update({ container_id: containerId }).eq('id', kanaal.id);
    }
    await wachtOpContainer(ctx, token, containerId, 90_000, 5_000);
  } else if (post.soort === 'carrousel') {
    const kinderen: string[] = [];
    for (const k of plan.kinderen) kinderen.push(await maakIgContainer(token, igId, k));
    const heeftVideo = media.some((m) => m.type === 'video');
    for (const k of kinderen) await wachtOpContainer(ctx, token, k, heeftVideo ? 90_000 : 30_000, heeftVideo ? 5_000 : 2_000);
    containerId = await maakIgContainer(token, igId, { ...plan.hoofd, children: kinderen.join(',') });
    await wachtOpContainer(ctx, token, containerId, 30_000, 2_000);
  } else {
    containerId = await maakIgContainer(token, igId, plan.hoofd);
    await wachtOpContainer(ctx, token, containerId, 30_000, 2_000);
  }

  const pub = await graph<{ id?: string }>(token, `/${igId}/media_publish`, { methode: 'POST', params: { creation_id: containerId } });
  if (!pub.id) throw new MetaFout({ soort: 'tijdelijk', melding: 'Instagram bevestigde het plaatsen niet. Controleer het account.', blijvend: true });
  let permalink: string | null = null;
  try {
    permalink = (await graph<{ permalink?: string }>(token, `/${pub.id}`, { params: { fields: 'permalink' } })).permalink ?? null;
  } catch {
    /* de link is fijn, niet nodig */
  }
  return { externId: pub.id, permalink };
}

// ---------------------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------------------

const fbLink = (l: string | null | undefined) => (!l ? null : l.startsWith('http') ? l : `https://www.facebook.com${l.startsWith('/') ? '' : '/'}${l}`);

async function fbPermalink(token: string, id: string): Promise<string | null> {
  try {
    return fbLink((await graph<{ permalink_url?: string }>(token, `/${id}`, { params: { fields: 'permalink_url' } })).permalink_url);
  } catch {
    return null;
  }
}

/** Start een Facebook-reel en laat Meta de video ophalen; geeft het video-id. */
async function startFbReel(token: string, pageId: string, videoUrl: string): Promise<string> {
  const s = await graph<{ video_id?: string }>(token, `/${pageId}/video_reels`, { methode: 'POST', params: { upload_phase: 'start' } });
  if (!s.video_id) throw new MetaFout({ soort: 'tijdelijk', melding: 'Facebook kon de reel niet starten. Het wordt zo opnieuw geprobeerd.', blijvend: false });
  await fbReelUpload(token, s.video_id, videoUrl);
  return s.video_id;
}

async function wachtOpFbVideo(ctx: Ctx, token: string, videoId: string, maxMs: number): Promise<void> {
  const tot = Math.min(Date.now() + maxMs, ctx.deadline);
  for (;;) {
    const s = await graph<{ status?: { video_status?: string; processing_phase?: { status?: string } } }>(token, `/${videoId}`, { params: { fields: 'status' } });
    const stap = fbVideoStap(s.status);
    if (stap === 'klaar') return;
    if (stap === 'opnieuw') {
      throw new MetaFout({ soort: 'container', melding: 'Facebook kon de video niet verwerken. Er wordt een nieuwe poging gedaan.', blijvend: false, nieuweContainer: true });
    }
    if (Date.now() + 5_000 > tot) throw new MetaFout({ soort: 'niet_klaar', melding: 'Facebook is de video nog aan het verwerken.', blijvend: false });
    await wacht(5_000);
  }
}

async function plaatsFacebook(
  ctx: Ctx,
  account: SocialAccountRij,
  token: string,
  post: SocialPostRij,
  media: MediaVoorMeta[],
  caption: string,
  kanaal: SocialPostKanaalRij,
  stand: { containerId: string | null }
): Promise<Geplaatst> {
  const pageId = account.page_id || account.extern_id;

  if (post.soort === 'tekst') {
    if (!caption) throw new MetaFout({ soort: 'ongeldig', melding: 'Een tekstpost heeft tekst nodig.', blijvend: true });
    const r = await graph<{ id?: string }>(token, `/${pageId}/feed`, { methode: 'POST', params: fbFeedParams(caption) });
    const id = fbPostId(pageId, r.id);
    if (!id) throw new MetaFout({ soort: 'tijdelijk', melding: 'Facebook bevestigde het plaatsen niet.', blijvend: true });
    return { externId: id, permalink: await fbPermalink(token, id) };
  }

  if (post.soort === 'foto') {
    const r = await graph<{ id?: string; post_id?: string }>(token, `/${pageId}/photos`, { methode: 'POST', params: fbFotoParams(media[0], caption, true) });
    const id = fbPostId(pageId, r.post_id ?? r.id);
    if (!id) throw new MetaFout({ soort: 'tijdelijk', melding: 'Facebook bevestigde het plaatsen niet.', blijvend: true });
    return { externId: id, permalink: await fbPermalink(token, id) };
  }

  if (post.soort === 'carrousel') {
    const fotoIds: string[] = [];
    for (const m of media) {
      const r = await graph<{ id?: string }>(token, `/${pageId}/photos`, { methode: 'POST', params: fbFotoParams(m, null, false) });
      if (!r.id) throw new MetaFout({ soort: 'tijdelijk', melding: 'Facebook kon een foto niet uploaden.', blijvend: false });
      fotoIds.push(r.id);
    }
    const r = await graph<{ id?: string }>(token, `/${pageId}/feed`, { methode: 'POST', params: fbFeedParams(caption, fotoIds) });
    const id = fbPostId(pageId, r.id);
    if (!id) throw new MetaFout({ soort: 'tijdelijk', melding: 'Facebook bevestigde het plaatsen niet.', blijvend: true });
    return { externId: id, permalink: await fbPermalink(token, id) };
  }

  // Reel
  let videoId = stand.containerId ?? '';
  if (!videoId) {
    videoId = await startFbReel(token, pageId, media[0].url);
    stand.containerId = videoId;
    await ctx.service.from('social_post_kanalen').update({ container_id: videoId }).eq('id', kanaal.id);
  }
  await wachtOpFbVideo(ctx, token, videoId, 90_000);
  const af = await graph<{ success?: boolean }>(token, `/${pageId}/video_reels`, { methode: 'POST', params: fbReelAfrondParams(videoId, caption) });
  if (af.success !== true) throw new MetaFout({ soort: 'tijdelijk', melding: 'Facebook bevestigde het plaatsen van de reel niet.', blijvend: false });
  let externId = `${pageId}_${videoId}`;
  let permalink: string | null = null;
  try {
    const info = await graph<{ post_id?: string; permalink_url?: string }>(token, `/${videoId}`, { params: { fields: 'post_id,permalink_url' } });
    externId = fbPostId(pageId, info.post_id) ?? externId;
    permalink = fbLink(info.permalink_url);
  } catch {
    /* id en link zijn fijn, niet nodig */
  }
  return { externId, permalink };
}

// ---------------------------------------------------------------------------------
// Reels voorbereiden
// ---------------------------------------------------------------------------------

async function bereidReelsVoor(ctx: Ctx): Promise<number> {
  const { service, nu } = ctx;
  const grens = new Date(nu.getTime() + REEL_VOORBEREIDING_MIN * 60_000).toISOString();
  const { data: posts, error } = await service
    .from('social_posts')
    .select(POST_KOLOMMEN)
    .eq('status', 'ingepland')
    .eq('soort', 'reel')
    .gt('gepland_op', nu.toISOString())
    .lte('gepland_op', grens)
    .limit(20);
  if (error) throw error;
  const lijst = ((posts ?? []) as SocialPostRij[]).filter((p) => isReelVoorbereidingAanDeBeurt(p.gepland_op, nu) && !isAanDeBeurt(p.gepland_op, nu));
  if (!lijst.length) return 0;

  const [k, m] = await Promise.all([
    service.from('social_post_kanalen').select(KANAAL_KOLOMMEN).in('post_id', lijst.map((p) => p.id)).is('container_id', null).in('status', ['ingepland', 'concept']),
    service.from('social_media').select(MEDIA_KOLOMMEN).in('post_id', lijst.map((p) => p.id)).order('volgorde')
  ]);
  if (k.error || m.error) throw k.error ?? m.error;
  const kanalen = (k.data ?? []) as SocialPostKanaalRij[];
  const media = (m.data ?? []) as SocialMediaRij[];
  const accounts = await accountsMetIds(service, kanalen.map((x) => x.account_id));

  let klaar = 0;
  for (const kanaal of kanalen) {
    if (tijdOver(ctx) < 60_000) break;
    const post = lijst.find((p) => p.id === kanaal.post_id);
    const account = accounts.get(kanaal.account_id);
    const token = account?.actief ? tokenVan(account) : null;
    if (!post || !account || !token) continue;
    const eigen = media.filter((x) => x.post_id === post.id);
    if (controleerMedia(post.soort, eigen, [account.platform]).fouten.length) continue; // bij het plaatsen komt de fout
    try {
      const metaMedia = await mediaVoorMeta(service, eigen);
      const { caption } = captionSamenstellen(post, kanaal.caption_eigen);
      const id =
        account.platform === 'instagram'
          ? await maakIgContainer(token, account.extern_id, igContainerPlan(post, metaMedia, caption).hoofd)
          : await startFbReel(token, account.page_id || account.extern_id, metaMedia[0].url);
      // Alleen als nog niemand anders er een heeft gezet (twee runs tegelijk).
      const u = await service.from('social_post_kanalen').update({ container_id: id }).eq('id', kanaal.id).is('container_id', null).select('id').maybeSingle();
      if (u.data) klaar++;
    } catch (e) {
      // Niet erg: bij het plaatsen wordt de container alsnog gemaakt (en dan komt de fout).
      logWaarschuwing('[social] reel voorbereiden', e instanceof MetaFout ? e.detail : e);
    }
  }
  return klaar;
}

// ---------------------------------------------------------------------------------
// Onderbroken runs
// ---------------------------------------------------------------------------------

async function ruimOnderbrokenOp(ctx: Ctx): Promise<number> {
  const { service, nu } = ctx;
  const grens = new Date(nu.getTime() - ONDERBROKEN_MIN * 60_000).toISOString();
  const { data, error } = await service.from('social_posts').select('id').eq('status', 'bezig').lt('gewijzigd_op', grens).limit(50);
  if (error) throw error;
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    await service.from('social_post_kanalen').update({ status: 'mislukt', fout: ONDERBROKEN_MELDING, volgende_poging_op: null }).eq('post_id', id).eq('status', 'bezig');
    await werkPostStatusBij(service, id);
  }
  return ids.length;
}

/** Posts die meer dan MAX_TE_LAAT_UUR over tijd zijn (de planner lag stil): niet meer vanzelf. */
async function markeerTeLaat(ctx: Ctx, post: SocialPostRij): Promise<boolean> {
  const { service, nu } = ctx;
  const claim = await service.from('social_posts').update({ status: 'bezig', gewijzigd_op: nu.toISOString() }).eq('id', post.id).eq('status', 'ingepland').select('id').maybeSingle();
  if (!claim.data) return false;
  await service
    .from('social_post_kanalen')
    .update({
      status: 'mislukt',
      fout: 'Niet geplaatst: de post was meer dan 12 uur over tijd (de planner heeft stilgelegen). Plan hem opnieuw in of plaats hem nu.',
      volgende_poging_op: null
    })
    .eq('post_id', post.id)
    .in('status', ['ingepland', 'concept']);
  await werkPostStatusBij(service, post.id);
  return true;
}

// ---------------------------------------------------------------------------------
// De cron
// ---------------------------------------------------------------------------------

/**
 * Eén run van /api/cron/social (elke 5 minuten). Werkt ook zonder Meta-instellingen (dan
 * 'niet_ingericht', niets gedaan) en vóór migratie 0041 ('migratie_ontbreekt').
 */
export async function verwerkSocialCron(service: SupabaseClient, nu: Date): Promise<Record<string, unknown>> {
  if (!ingericht()) return { status: 'niet_ingericht' };
  const ctx: Ctx = { service, nu, deadline: Date.now() + CRON_BUDGET_MS };
  const uit: Record<string, unknown> = { status: 'ok' };

  try {
    uit.onderbroken = await ruimOnderbrokenOp(ctx);
  } catch (e) {
    if (tabelOntbreekt(e)) return { status: 'migratie_ontbreekt' };
    logFout('[social-cron] opruimen', e);
  }

  try {
    uit.voorbereid = await bereidReelsVoor(ctx);
  } catch (e) {
    logFout('[social-cron] reels voorbereiden', e);
  }

  let geplaatst = 0;
  let herkansing = 0;
  let mislukt = 0;
  let teLaat = 0;
  try {
    const grens = new Date(nu.getTime() + 60_000).toISOString();
    const { data, error } = await service.from('social_posts').select(POST_KOLOMMEN).eq('status', 'ingepland').lte('gepland_op', grens).order('gepland_op').limit(50);
    if (error) throw error;
    const posts = ((data ?? []) as SocialPostRij[]).filter((p) => isAanDeBeurt(p.gepland_op, nu));
    // Alleen posts met een kanaal dat nu aan de beurt is (niet steeds claimen voor een herkansing die nog wacht).
    const k = posts.length
      ? await service.from('social_post_kanalen').select('post_id,status,volgende_poging_op').in('post_id', posts.map((p) => p.id)).in('status', ['ingepland', 'concept'])
      : { data: [], error: null };
    if (k.error) throw k.error;
    const klaar = new Set(
      ((k.data ?? []) as { post_id: string; volgende_poging_op: string | null }[])
        .filter((r) => !r.volgende_poging_op || new Date(r.volgende_poging_op).getTime() <= nu.getTime())
        .map((r) => r.post_id)
    );
    for (const post of posts) {
      if (tijdOver(ctx) < 30_000) break;
      if (isTeLaat(post.gepland_op, nu)) {
        if (await markeerTeLaat(ctx, post)) teLaat++;
        continue;
      }
      if (!klaar.has(post.id)) continue;
      const r = await plaatsIntern(ctx, post.id, false);
      geplaatst += r.geplaatst;
      herkansing += r.herkansing;
      mislukt += r.mislukt;
    }
  } catch (e) {
    logFout('[social-cron] plaatsen', e);
    uit.status = 'plaatsen_mislukt';
  }
  Object.assign(uit, { geplaatst, herkansing, mislukt, te_laat: teLaat });

  // Sync en tokencontrole alleen met tijd over (eens per ~6 uur per account, max. 2 per run).
  if (tijdOver(ctx) > 90_000) {
    try {
      uit.sync = await syncAlles(service, nu, { alleenNodig: true, max: 2, deadline: ctx.deadline });
    } catch (e) {
      logFout('[social-cron] sync', e);
    }
  }
  return uit;
}
