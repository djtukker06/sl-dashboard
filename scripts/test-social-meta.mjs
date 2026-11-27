// Tests voor de Meta-koppeling en het automatisch plaatsen (migratie 0041), zonder database
// en zonder netwerk:
//   - lib/social/meta/kern.ts: versie, login-URL, verzoeken bouwen (token nooit in de URL),
//     fouten vertalen (opnieuw proberen of niet), Instagram-containers, Facebook-posts,
//     inzichten omzetten, tokencontrole;
//   - samen met lib/social/kern.ts: het herkansingsschema na een Meta-fout;
//   - lib/social/meta/state.ts: eigen state-geheim (een Drive-state geldt niet voor Meta);
//   - bron: claimen met een conditionele update, de cron via cronRoute en in proxy.ts, de
//     routes achter de teamcheck, geen tokens in logs of URL's, de pg_cron-SQL.
//   node --experimental-strip-types scripts/test-social-meta.mjs
import fs from "node:fs";
import assert from "node:assert/strict";
import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (/^\\.\\.?\\//.test(spec) && !/\\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.endsWith('.ts')) return next(spec + '.ts', ctx);
  return next(spec, ctx);
}`),
  import.meta.url
);
const M = await import("../lib/social/meta/kern.ts");
const K = await import("../lib/social/kern.ts");
const S = await import("../lib/social/meta/state.ts");
const D = await import("../lib/drive/state.ts");
const GA = await import("../lib/google-agenda/state.ts");

let geslaagd = 0;
let mislukt = 0;
function test(naam, fn) {
  try {
    fn();
    geslaagd++;
  } catch (e) {
    mislukt++;
    console.error(`✗ ${naam}\n  ${e.message}`);
  }
}
const lees = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const bestaat = (p) => fs.existsSync(new URL(`../${p}`, import.meta.url));

const TOKEN = "EAAB-geheim-page-token-1234567890";
const NU = new Date("2026-11-26T18:00:00Z");

// ---------------------------------------------------------------------------------
// Versie en login
// ---------------------------------------------------------------------------------

test("graph-versie: standaard v27.0, alleen geldige vXX.0 uit de env", () => {
  assert.equal(M.graphVersie(undefined), "v27.0");
  assert.equal(M.graphVersie(""), "v27.0");
  assert.equal(M.graphVersie("v26.0"), "v26.0");
  assert.equal(M.graphVersie("26"), "v27.0");
  assert.equal(M.graphVersie("v26.0/../me"), "v27.0");
});

test("login-URL: config_id (Facebook Login for Business) of anders de scope-lijst", () => {
  const met = new URL(M.loginUrl({ versie: "v27.0", appId: "123", redirectUri: "https://x.nl/api/social/meta/callback", state: "abc", configId: "999888" }));
  assert.equal(met.origin, "https://www.facebook.com");
  assert.equal(met.pathname, "/v27.0/dialog/oauth");
  assert.equal(met.searchParams.get("config_id"), "999888");
  assert.equal(met.searchParams.get("scope"), null);
  assert.equal(met.searchParams.get("response_type"), "code");
  assert.equal(met.searchParams.get("state"), "abc");
  assert.equal(met.searchParams.get("redirect_uri"), "https://x.nl/api/social/meta/callback");
  const zonder = new URL(M.loginUrl({ versie: "v27.0", appId: "123", redirectUri: "https://x.nl/cb", state: "s" }));
  const scopes = zonder.searchParams.get("scope").split(",");
  for (const s of ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management"]) {
    assert.ok(scopes.includes(s), s);
  }
  assert.ok(!zonder.searchParams.has("config_id"));
});

test("ontbrekende scopes", () => {
  assert.deepEqual(M.ontbrekendeScopes([...M.SCOPES]), []);
  assert.ok(M.ontbrekendeScopes(["pages_show_list"]).includes("instagram_content_publish"));
});

// ---------------------------------------------------------------------------------
// Verzoeken bouwen
// ---------------------------------------------------------------------------------

test("GET: token in de Authorization-kop, nooit in de URL; appsecret_proof erbij", () => {
  const v = M.bouwVerzoek({ versie: "v27.0", pad: "/17841400000/media", params: { fields: "id,caption", limit: 50 }, token: TOKEN, appSecret: "appgeheim" });
  assert.ok(v.url.startsWith("https://graph.facebook.com/v27.0/17841400000/media?"));
  assert.ok(!v.url.includes(TOKEN), "token niet in de URL");
  assert.ok(!v.url.includes("access_token"), "geen access_token-parameter");
  assert.equal(v.init.headers.Authorization, `Bearer ${TOKEN}`);
  const u = new URL(v.url);
  assert.equal(u.searchParams.get("appsecret_proof"), M.appsecretProof(TOKEN, "appgeheim"));
  assert.match(u.searchParams.get("appsecret_proof"), /^[0-9a-f]{64}$/);
  assert.equal(v.init.body, undefined);
});

test("POST: parameters als formulier in de body, arrays/objecten als JSON, lege weg", () => {
  const v = M.bouwVerzoek({
    versie: "v27.0",
    pad: "/1784/media",
    methode: "POST",
    params: { image_url: "https://x/y.jpg", collaborators: ["a", "b"], user_tags: [{ username: "c", x: 0.5, y: 0.5 }], location_id: null, caption: "" },
    token: TOKEN,
    appSecret: "s"
  });
  assert.equal(v.url, "https://graph.facebook.com/v27.0/1784/media");
  assert.equal(v.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  const b = new URLSearchParams(v.init.body);
  assert.equal(b.get("collaborators"), '["a","b"]');
  assert.equal(b.get("user_tags"), '[{"username":"c","x":0.5,"y":0.5}]');
  assert.ok(!b.has("location_id") && !b.has("caption"));
  assert.ok(!v.init.body.includes(TOKEN));
});

test("verzoek: ongeldige paden geweigerd", () => {
  assert.throws(() => M.bouwVerzoek({ versie: "v27.0", pad: "/../me" }));
  assert.throws(() => M.bouwVerzoek({ versie: "v27.0", pad: "/me?x=1" }));
  assert.throws(() => M.bouwVerzoek({ versie: "v27.0", pad: "https://evil.nl/x" }));
  assert.doesNotThrow(() => M.bouwVerzoek({ versie: "v27.0", pad: "me/accounts" }));
});

// ---------------------------------------------------------------------------------
// Fouten vertalen
// ---------------------------------------------------------------------------------

const fb = (code, sub, extra = {}) => ({ error: { message: "x", type: "OAuthException", code, error_subcode: sub, ...extra } });

test("fout: token verlopen/ingetrokken → opnieuw koppelen, blijvend", () => {
  for (const [code, sub] of [[190, 463], [190, 460], [102, undefined]]) {
    const f = M.vertaalMetaFout(400, fb(code, sub));
    assert.equal(f.soort, "opnieuw_koppelen");
    assert.equal(f.blijvend, true);
    assert.match(f.message, /Koppel het account opnieuw/);
  }
  assert.equal(M.vertaalMetaFout(401, {}).soort, "opnieuw_koppelen");
});

test("fout: permissies (10, 200–299) → geen rechten, blijvend", () => {
  assert.equal(M.vertaalMetaFout(403, fb(10)).soort, "geen_rechten");
  assert.equal(M.vertaalMetaFout(400, fb(200)).soort, "geen_rechten");
  assert.equal(M.vertaalMetaFout(400, fb(299)).blijvend, true);
});

test("fout: limieten en storingen → opnieuw proberen", () => {
  for (const code of [4, 17, 32, 613, 80002]) {
    const f = M.vertaalMetaFout(400, fb(code));
    assert.equal(f.soort, "limiet", String(code));
    assert.equal(f.blijvend, false);
  }
  for (const [http, body] of [[500, fb(1)], [500, fb(2)], [503, {}], [400, fb(100, undefined, { is_transient: true })]]) {
    const f = M.vertaalMetaFout(http, body);
    assert.equal(f.soort, "tijdelijk");
    assert.equal(f.blijvend, false);
  }
});

test("fout: Instagram-subcodes", () => {
  const groot = M.vertaalMetaFout(400, fb(36000, 2207004));
  assert.equal(groot.soort, "media");
  assert.equal(groot.blijvend, true);
  assert.match(groot.message, /8 MB/);
  assert.match(M.vertaalMetaFout(400, fb(36003, 2207009)).message, /4:5/);
  assert.equal(M.vertaalMetaFout(400, fb(36004, 2207010)).blijvend, true);
  const nietKlaar = M.vertaalMetaFout(400, fb(9007, 2207027));
  assert.equal(nietKlaar.soort, "niet_klaar");
  assert.equal(nietKlaar.blijvend, false);
  const verlopen = M.vertaalMetaFout(400, fb(24, 2207008));
  assert.equal(verlopen.nieuweContainer, true);
  assert.equal(verlopen.blijvend, false);
  const dag = M.vertaalMetaFout(400, fb(9, 2207042));
  assert.equal(dag.soort, "limiet");
  assert.match(dag.message, /daglimiet/);
  assert.equal(M.vertaalMetaFout(400, fb(25, 2207050)).soort, "geblokkeerd");
  assert.equal(M.vertaalMetaFout(400, fb(4, 2207051)).blijvend, true, "spam: subcode wint van code 4 (limiet)");
  assert.equal(M.vertaalMetaFout(500, fb(-1, 2207001)).nieuweContainer, true);
});

test("fout: ongeldige parameter → blijvend, met de korte uitleg van Meta", () => {
  const f = M.vertaalMetaFout(400, fb(100, 33, { error_user_msg: "The user  tagged does not exist." }));
  assert.equal(f.soort, "ongeldig");
  assert.equal(f.blijvend, true);
  assert.match(f.message, /^Meta weigerde de post: The user tagged does not exist\.$/);
});

test("fout: detail voor de logs zonder token, en ingekort", () => {
  const f = M.vertaalMetaFout(400, { error: { message: "y".repeat(500), code: 100 } });
  assert.ok(f.detail.length <= 300);
  assert.match(f.detail, /code=100/);
  const n = M.netwerkFout(Object.assign(new Error(`fetch failed ${TOKEN}`), { name: "TimeoutError" }));
  assert.equal(n.soort, "tijdelijk");
  assert.ok(!n.detail.includes(TOKEN) && !n.message.includes(TOKEN));
});

test("herkansing na een Meta-fout: tijdelijk 5/15/60 min, daarna op; blijvend direct op", () => {
  const tijdelijk = M.vertaalMetaFout(503, {});
  const stappen = [1, 2, 3, 4].map((p) => K.volgendePoging(p, NU, tijdelijk.blijvend));
  assert.deepEqual(
    stappen.map((d) => (d ? (d.getTime() - NU.getTime()) / 60_000 : null)),
    [5, 15, 60, null]
  );
  const blijvend = M.vertaalMetaFout(400, fb(36000, 2207004));
  assert.equal(K.volgendePoging(1, NU, blijvend.blijvend), null);
});

// ---------------------------------------------------------------------------------
// Instagram-containers
// ---------------------------------------------------------------------------------

const POST = (soort, extra = {}) => ({ soort, caption: "", gebruikers_tags: [], collaborators: [], locatie_id: null, ...extra });
const FOTO = (n = 0) => ({ type: "afbeelding", url: `https://sb.test/f${n}.jpg?token=x`, alt_tekst: n ? `alt ${n}` : "" });
const VIDEO = { type: "video", url: "https://sb.test/v.mp4?token=x", alt_tekst: "" };

test("IG foto: image_url, caption, tags (alleen index 0), alt_text, locatie, collaborators zonder @", () => {
  const p = M.igContainerPlan(
    POST("foto", {
      gebruikers_tags: [
        { gebruikersnaam: "@Studio.Levant", x: 1.4, y: -0.2, media_index: 0 },
        { gebruikersnaam: "ander", x: 0.5, y: 0.5, media_index: 1 }
      ],
      collaborators: ["@marith", "marith", "  "],
      locatie_id: "1234567"
    }),
    [FOTO(1)],
    "Hallo #studio"
  );
  assert.deepEqual(p.kinderen, []);
  assert.equal(p.hoofd.image_url, FOTO(1).url);
  assert.equal(p.hoofd.caption, "Hallo #studio");
  assert.deepEqual(p.hoofd.user_tags, [{ username: "studio.levant", x: 1, y: 0 }]);
  assert.deepEqual(p.hoofd.collaborators, ["marith"]);
  assert.equal(p.hoofd.location_id, "1234567");
  assert.equal(p.hoofd.alt_text, "alt 1");
  assert.equal(p.hoofd.media_type, undefined);
});

test("IG carrousel: kinderen met is_carousel_item, video als VIDEO, hoofd CAROUSEL met caption", () => {
  const p = M.igContainerPlan(POST("carrousel", { gebruikers_tags: [{ gebruikersnaam: "x", x: 0.1, y: 0.2, media_index: 1 }] }), [FOTO(0), FOTO(1), VIDEO], "Tekst");
  assert.equal(p.kinderen.length, 3);
  assert.ok(p.kinderen.every((k) => k.is_carousel_item === true && k.caption === undefined));
  assert.equal(p.kinderen[0].user_tags, undefined);
  assert.deepEqual(p.kinderen[1].user_tags, [{ username: "x", x: 0.1, y: 0.2 }]);
  assert.equal(p.kinderen[1].alt_text, "alt 1");
  assert.deepEqual(p.kinderen[2], { is_carousel_item: true, media_type: "VIDEO", video_url: VIDEO.url });
  assert.equal(p.hoofd.media_type, "CAROUSEL");
  assert.equal(p.hoofd.caption, "Tekst");
  assert.throws(() => M.igContainerPlan(POST("carrousel"), [FOTO(0)], ""));
});

test("IG reel: REELS + video_url + share_to_feed, geen user_tags of alt_text", () => {
  const p = M.igContainerPlan(POST("reel", { gebruikers_tags: [{ gebruikersnaam: "x", x: 0.5, y: 0.5, media_index: 0 }], collaborators: ["a", "b", "c", "d"] }), [VIDEO], "Kijk");
  assert.equal(p.hoofd.media_type, "REELS");
  assert.equal(p.hoofd.video_url, VIDEO.url);
  assert.equal(p.hoofd.share_to_feed, true);
  assert.equal(p.hoofd.user_tags, undefined);
  assert.equal(p.hoofd.alt_text, undefined);
  assert.equal(p.hoofd.collaborators.length, 3, "max. 3 collaborators");
  assert.throws(() => M.igContainerPlan(POST("reel"), [FOTO(0)], ""));
  assert.throws(() => M.igContainerPlan(POST("tekst"), [], "x"), /Instagram/);
});

test("container-status → stap", () => {
  assert.equal(M.containerStap("FINISHED"), "klaar");
  assert.equal(M.containerStap("IN_PROGRESS"), "wachten");
  assert.equal(M.containerStap(undefined), "wachten");
  assert.equal(M.containerStap("ERROR"), "opnieuw");
  assert.equal(M.containerStap("EXPIRED"), "opnieuw");
  assert.equal(M.containerStap("PUBLISHED"), "al_geplaatst");
});

// ---------------------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------------------

test("FB foto's en feed met attached_media", () => {
  assert.deepEqual(M.fbFotoParams(FOTO(1), "Hoi", true), { url: FOTO(1).url, caption: "Hoi", published: undefined, alt_text_custom: "alt 1" });
  const los = M.fbFotoParams(FOTO(0), "Hoi", false);
  assert.equal(los.published, false);
  assert.equal(los.caption, undefined, "caption hoort bij de feedpost, niet bij de losse foto");
  const feed = M.fbFeedParams("Tekst", ["11", "22"]);
  const body = new URLSearchParams(M.bouwVerzoek({ versie: "v27.0", pad: "/1/feed", methode: "POST", params: feed }).init.body);
  assert.equal(body.get("message"), "Tekst");
  assert.equal(body.get("attached_media[0]"), '{"media_fbid":"11"}');
  assert.equal(body.get("attached_media[1]"), '{"media_fbid":"22"}');
});

test("FB reel: afronden, upload-koppen, videostatus en post-id", () => {
  assert.deepEqual(M.fbReelAfrondParams("55", "Kijk"), { video_id: "55", upload_phase: "finish", video_state: "PUBLISHED", description: "Kijk" });
  assert.deepEqual(M.fbReelUploadKoppen("tok", "https://sb.test/v.mp4"), { Authorization: "OAuth tok", file_url: "https://sb.test/v.mp4" });
  assert.equal(M.fbVideoStap({ video_status: "ready" }), "klaar");
  assert.equal(M.fbVideoStap({ video_status: "processing" }), "wachten");
  assert.equal(M.fbVideoStap({ video_status: "upload_complete", processing_phase: { status: "error" } }), "opnieuw");
  assert.equal(M.fbVideoStap(null), "wachten");
  assert.equal(M.fbPostId("100", "200"), "100_200");
  assert.equal(M.fbPostId("100", "100_200"), "100_200");
  assert.equal(M.fbPostId("100", ""), null);
});

// ---------------------------------------------------------------------------------
// Sync en inzichten
// ---------------------------------------------------------------------------------

test("soort van externe posts", () => {
  assert.equal(M.igSoort("IMAGE", "FEED"), "foto");
  assert.equal(M.igSoort("CAROUSEL_ALBUM", "FEED"), "carrousel");
  assert.equal(M.igSoort("VIDEO", "REELS"), "reel");
  assert.equal(M.fbSoort({}), "tekst");
  assert.equal(M.fbSoort({ attachments: { data: [{ media_type: "photo", type: "photo" }] } }), "foto");
  assert.equal(M.fbSoort({ attachments: { data: [{ media_type: "album", type: "album", subattachments: { data: [1, 2] } }] } }), "carrousel");
  assert.equal(M.fbSoort({ attachments: { data: [{ media_type: "video", type: "video_inline" }] } }), "reel");
});

test("IG-metrics: geen 'impressions' meer; reels met kijktijd, feed met profielbezoeken", () => {
  const feed = M.igMediaMetrics("IMAGE", "FEED");
  const reel = M.igMediaMetrics("VIDEO", "REELS");
  for (const l of [feed, reel, M.IG_ACCOUNT_METRICS]) {
    assert.ok(!l.includes("impressions") && !l.includes("plays") && !l.includes("video_views"));
    assert.ok(l.includes("views") && l.includes("reach"));
  }
  assert.ok(reel.includes("ig_reels_avg_watch_time") && !reel.includes("profile_visits"));
  assert.ok(feed.includes("profile_visits") && !feed.includes("ig_reels_avg_watch_time"));
  for (const m of [...M.FB_POST_METRICS, ...M.FB_PAGINA_METRICS]) assert.ok(!/impressions|page_fans/.test(m), m);
});

test("inzichten omzetten naar onze cijfers", () => {
  const ig = M.igInzichtenNaarCijfers([
    { name: "reach", values: [{ value: 120 }] },
    { name: "views", values: [{ value: 300 }] },
    { name: "saved", values: [{ value: 4 }] },
    { name: "ig_reels_avg_watch_time", values: [{ value: 6543 }] },
    { name: "ig_reels_video_view_total_time", values: [{ value: 123456 }] },
    { name: "onbekend", values: [{ value: 1 }] }
  ]);
  assert.deepEqual(ig, { bereik: 120, weergaven: 300, opslagen: 4, gem_kijktijd_sec: 6.5, kijktijd_sec: 123 });
  const acc = M.accountInzichtenNaarCijfers([{ name: "reach", total_value: { value: 900 } }, { name: "accounts_engaged", total_value: { value: 40 } }]);
  assert.deepEqual(acc, { bereik: 900, betrokken_accounts: 40 });
  const fbc = M.fbPostNaarCijfers(
    [
      { name: "post_media_view", values: [{ value: 50 }] },
      { name: "post_reactions_by_type_total", values: [{ value: { like: 3, love: 2 } }] }
    ],
    { comments: { summary: { total_count: 7 } }, shares: { count: 1 } }
  );
  assert.deepEqual(fbc, { weergaven: 50, likes: 5, reacties: 7, gedeeld: 1 });
});

// ---------------------------------------------------------------------------------
// Tokens en accounts
// ---------------------------------------------------------------------------------

test("tokencontrole: ongeldig/verlopen → opnieuw koppelen, < 7 dagen → waarschuwing", () => {
  const s = (d) => Math.floor((NU.getTime() + d * 86_400_000) / 1000);
  assert.equal(M.tokenOordeel({ is_valid: false }, NU), "opnieuw_koppelen");
  assert.equal(M.tokenOordeel(null, NU), "opnieuw_koppelen");
  assert.equal(M.tokenOordeel({ is_valid: true, expires_at: 0, data_access_expires_at: s(-1) }, NU), "opnieuw_koppelen");
  assert.equal(M.tokenOordeel({ is_valid: true, expires_at: 0, data_access_expires_at: s(3) }, NU), "verloopt_binnenkort");
  assert.equal(M.tokenOordeel({ is_valid: true, expires_at: 0, data_access_expires_at: s(60) }, NU), null);
  assert.equal(M.verlooptOp({ expires_at: 0, data_access_expires_at: 0 }), null);
  assert.equal(M.verlooptOp({ expires_at: s(10), data_access_expires_at: s(5) }).getTime(), s(5) * 1000);
});

test("pagina's: alleen met CREATE_CONTENT of MANAGE; AAD per platform + id", () => {
  assert.equal(M.magPlaatsen(["ANALYZE"]), false);
  assert.equal(M.magPlaatsen(["CREATE_CONTENT", "ANALYZE"]), true);
  assert.equal(M.magPlaatsen(["MANAGE"]), true);
  assert.equal(M.tokenAad("instagram", "1784"), "social-meta:instagram:1784");
  assert.notEqual(M.tokenAad("instagram", "1"), M.tokenAad("facebook", "1"));
  for (const f of Object.values(M.ACCOUNT_FOUT)) assert.ok(M.ACCOUNT_FOUT_LABEL[f], f);
});

test("OAuth-state: eigen geheim en cookie; een Drive- of agenda-state geldt niet voor Meta", () => {
  const sleutel = Buffer.alloc(32, 7);
  const meta = S.stateGeheim(sleutel);
  assert.notDeepEqual(meta, D.stateGeheim(sleutel));
  assert.notDeepEqual(meta, GA.stateGeheim(sleutel));
  assert.notEqual(S.STATE_COOKIE, D.STATE_COOKIE);
  const { state, cookie } = D.maakState(meta, "user-1", "https://x.nl/api/social/meta/callback");
  assert.equal(D.controleerState(meta, cookie, state, "user-1").ok, true);
  assert.equal(D.controleerState(D.stateGeheim(sleutel), cookie, state, "user-1").ok, false);
  assert.equal(D.controleerState(meta, cookie, state, "user-2").ok, false);
});

// ---------------------------------------------------------------------------------
// Bron
// ---------------------------------------------------------------------------------

test("bron: kern.ts zonder @/-imports en zonder env", () => {
  const k = lees("lib/social/meta/kern.ts");
  assert.ok(!/from ['"]@\//.test(k));
  assert.ok(!k.includes("process.env"));
});

test("bron: claimen met een conditionele update vóór het plaatsen (post én kanaal)", () => {
  const p = lees("lib/social/plaatsen.ts");
  const postClaim = p.indexOf(".update(claimVelden).eq('id', post.id).eq('status', post.status)");
  const kanaalClaim = p.indexOf(".eq('status', kanaal.status)");
  const plaatsen = p.indexOf("await plaatsKanaal(");
  assert.ok(postClaim > 0, "post-claim");
  assert.ok(kanaalClaim > postClaim, "kanaal-claim na de post-claim");
  assert.ok(plaatsen > kanaalClaim, "pas plaatsen na de claim");
  assert.match(p, /if \(!claim\.data\) return leeg/);
  assert.match(p, /if \(kc\.error \|\| !kc\.data\) continue;/);
  // De cron claimt alleen ingeplande posts.
  assert.match(p, /handmatig \? \['concept', 'ingepland', 'mislukt', 'deels'\] : \['ingepland'\]/);
  // Een reel-container wordt maar door één run gezet.
  assert.match(p, /\.update\(\{ container_id: id \}\)\.eq\('id', kanaal\.id\)\.is\('container_id', null\)/);
  // Onderbroken posts gaan nooit blind opnieuw.
  assert.match(p, /status: 'mislukt', fout: ONDERBROKEN_MELDING/);
});

test("bron: herkansing via volgendePoging en de post-status uit de kanalen", () => {
  const p = lees("lib/social/plaatsen.ts");
  assert.match(p, /volgendePoging\(pogingen, nu, fout\.blijvend\)/);
  assert.match(p, /postStatusUitKanalen\(/);
  assert.match(p, /export async function plaatsPost\(\s*service: SupabaseClient,\s*postId: string/);
  assert.match(p, /export async function verwerkSocialCron\(service: SupabaseClient, nu: Date\): Promise<Record<string, unknown>>/);
  assert.match(p, /if \(!ingericht\(\)\) return \{ status: 'niet_ingericht' \}/);
  assert.match(p, /return \{ status: 'migratie_ontbreekt' \}/);
});

test("bron: cron via cronRoute, in proxy.ts als cron-pad (exact, geen voorvoegsel)", () => {
  const r = lees("app/api/cron/social/route.ts");
  assert.match(r, /cronRoute\('social'/);
  assert.match(r, /maxDuration = 300/);
  const proxy = lees("proxy.ts");
  assert.ok(proxy.includes("pad === '/api/cron/social'"));
  assert.ok(!/startsWith\(['"]\/api\/cron/.test(proxy));
});

test("bron: alle social-routes achter de teamcheck", () => {
  for (const f of ["app/api/social/accounts/route.ts", "app/api/social/accounts/[id]/route.ts", "app/api/social/meta/start/route.ts", "app/api/social/sync/route.ts"]) {
    assert.match(lees(f), /teamlidRoute/, f);
  }
  const cb = lees("app/api/social/meta/callback/route.ts");
  assert.ok(cb.indexOf("controleerRoute(request)") < cb.indexOf("wisselCode("), "eerst teamcheck, dan de code inwisselen");
  assert.ok(cb.indexOf("controleerState(") < cb.indexOf("wisselCode("), "eerst de state, dan de code");
  const start = lees("app/api/social/meta/start/route.ts");
  assert.match(start, /httpOnly: true/);
  assert.match(start, /path: CALLBACK_PAD/);
});

test("bron: geen tokens in logs, URL's of naar de browser", () => {
  const bestanden = [
    "lib/social/plaatsen.ts",
    "lib/social/sync.ts",
    "lib/social/koppeling.ts",
    "lib/social/meta/client.ts",
    "lib/social/meta/oauth.ts",
    "app/api/social/meta/callback/route.ts",
    "app/api/social/accounts/route.ts"
  ];
  for (const f of bestanden) {
    const s = lees(f);
    assert.ok(!/console\.(log|info|debug)\(/.test(s), `${f}: geen console.log`);
    assert.ok(!/log(Fout|Waarschuwing)\([^)]*\b(token|userToken|access_token|kort|lang)\b/.test(s), `${f}: geen token in een log`);
    assert.ok(!/[?&]access_token=\$\{/.test(s), `${f}: geen token in een URL`);
  }
  assert.match(lees("lib/social/koppeling.ts"), /accountNaarDto/);
  // De callback stuurt alleen een aantal of een foutcode terug.
  assert.match(lees("app/api/social/meta/callback/route.ts"), /terug\(`gekoppeld=\$\{aantal\}`\)/);
});

test("bron: pg_cron-SQL met placeholder, Vault, elke 5 minuten en de juiste route", () => {
  assert.ok(bestaat("supabase/UITVOEREN_0041_cron.sql"));
  const s = lees("supabase/UITVOEREN_0041_cron.sql");
  assert.match(s, /create extension if not exists pg_cron/);
  assert.match(s, /create extension if not exists pg_net/);
  assert.match(s, /vault\.create_secret/);
  assert.match(s, /PLAATS_HIER_JE_CRON_SECRET/);
  assert.match(s, /raise exception 'Vul eerst je CRON_SECRET/);
  assert.match(s, /cron\.schedule\(\s*'sl-social-planner',\s*'\*\/5 \* \* \* \*'/);
  assert.match(s, /\/api\/cron\/social/);
  assert.match(s, /'Bearer ' \|\| \(select decrypted_secret from vault\.decrypted_secrets where name = 'sl_cron_secret'\)/);
});

test("bron: README en .env.local.example noemen de Meta-variabelen", () => {
  const r = lees("README.md");
  assert.match(r, /## Social media management/);
  assert.ok(!r.includes("## Social: koppelen met Meta"), "README: één social-sectie");
  for (const v of ["META_APP_ID", "META_APP_SECRET", "META_CONFIG_ID", "SOCIAL_ENCRYPTION_KEY"]) {
    assert.ok(r.includes(v), `README: ${v}`);
    assert.ok(lees(".env.local.example").includes(`${v}=`), `.env.local.example: ${v}`);
  }
  assert.ok(r.includes("/api/social/meta/callback"));
});

console.log(`test-social-meta: ${geslaagd} geslaagd${mislukt ? `, ${mislukt} mislukt` : ""}`);
if (mislukt) process.exit(1);
