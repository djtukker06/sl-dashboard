// Tests voor social media management (migratie 0041), zonder database en zonder netwerk:
//   - lib/social/kern.ts: statussen, parsePost (caption, hashtags, tags, kanalen, inplannen),
//     de mediaeisen per soort en platform, wanneer een post aan de beurt is, het
//     herkansingsschema, het samenstellen van de caption, Europe/Amsterdam ↔ UTC en de
//     media-paden;
//   - bron: de migratie zet RLS aan op alle tabellen, maakt geen policies, trekt de rechten
//     van anon/authenticated in, de bucket is privé, UITVOEREN_0041.sql is identiek, en de
//     back-up kent de nieuwe tabellen; geen tokens in de DTO's.
//   node --experimental-strip-types scripts/test-social.mjs
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
const K = await import("../lib/social/kern.ts");
const F = await import("../lib/backup/formaat-kern.ts");

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

const NU = new Date("2026-11-20T12:00:00Z");
const IG = { id: "11111111-1111-4111-8111-111111111111", platform: "instagram", actief: true };
const FB = { id: "22222222-2222-4222-8222-222222222222", platform: "facebook", actief: true };
const UIT = { id: "33333333-3333-4333-8333-333333333333", platform: "instagram", actief: false };
const ACCOUNTS = [IG, FB, UIT];
const JPG = { type: "afbeelding", mime: "image/jpeg", breedte: 1080, hoogte: 1350, duur_sec: null, grootte: 2_000_000 };
const PNG = { ...JPG, mime: "image/png" };
const REEL = { type: "video", mime: "video/mp4", breedte: 1080, hoogte: 1920, duur_sec: 30, grootte: 20_000_000 };
const opt = (extra = {}) => ({ nu: NU, accounts: ACCOUNTS, ...extra });
const plan = (extra = {}) => ({ status: "ingepland", soort: "foto", caption: "Hoi", gepland_op: "2026-11-26T18:30:00Z", kanalen: [{ account_id: IG.id }], ...extra });

// ---------- statussen ----------
test("statussen en labels compleet", () => {
  assert.deepEqual(K.STATUSSEN, ["concept", "ingepland", "bezig", "geplaatst", "deels", "mislukt"]);
  for (const s of K.STATUSSEN) assert.ok(K.STATUS_LABEL[s]);
  for (const s of K.SOORTEN) assert.ok(K.SOORT_LABEL[s]);
  assert.ok(K.isEindStatus("deels") && !K.isEindStatus("ingepland"));
  assert.ok(K.isBewerkbaar("concept") && !K.isBewerkbaar("bezig") && !K.isBewerkbaar("geplaatst"));
});
test("poststatus uit de kanalen", () => {
  assert.equal(K.postStatusUitKanalen([]), "concept");
  assert.equal(K.postStatusUitKanalen(["geplaatst", "geplaatst"]), "geplaatst");
  assert.equal(K.postStatusUitKanalen(["geplaatst", "mislukt"]), "deels");
  assert.equal(K.postStatusUitKanalen(["mislukt", "mislukt"]), "mislukt");
  assert.equal(K.postStatusUitKanalen(["geplaatst", "bezig"]), "bezig");
  assert.equal(K.postStatusUitKanalen(["geplaatst", "ingepland"]), "ingepland");
});
test("accountNaarDto laat het token weg", () => {
  const dto = K.accountNaarDto({ id: "a", platform: "instagram", extern_id: "1", naam: "SL", gebruikersnaam: "sl", afbeelding_url: null, page_id: "p", token_enc: "v1:geheim", token_verloopt_op: null, scopes: "x", gekoppeld_door: "u", gekoppeld_op: "2026-01-01", laatst_gesynct_op: null, fout: null, actief: true });
  assert.ok(!("token_enc" in dto) && !("scopes" in dto) && !("gekoppeld_door" in dto));
  assert.ok(!JSON.stringify(dto).includes("geheim"));
});

// ---------- hashtags en caption ----------
test("hashtags tellen en normaliseren", () => {
  assert.equal(K.telHashtags("Mooi #zomer #strand_2026 en #café"), 3);
  assert.equal(K.telVermeldingen("Met @studio.levant en info@studio-levant.nl"), 1);
  const n = K.normaliseerHashtags("zomer, #Strand  bbq #zomer ##dubbel");
  assert.equal(n.tekst, "#zomer #Strand #bbq #dubbel");
  assert.deepEqual(n.ongeldig, []);
  assert.deepEqual(K.normaliseerHashtags("goed fout-woord").ongeldig, ["fout-woord"]);
  assert.equal(K.aantalTekens("👍👍"), 2);
});
test("caption samenstellen: hashtags in caption of reactie, caption per kanaal", () => {
  const p = { caption: "Nieuw project ", hashtags: "#a #b", hashtags_plek: "caption", eerste_reactie: "" };
  assert.deepEqual(K.captionSamenstellen(p), { caption: "Nieuw project\n\n#a #b", eersteReactie: "" });
  assert.deepEqual(K.captionSamenstellen({ ...p, hashtags_plek: "reactie" }), { caption: "Nieuw project", eersteReactie: "#a #b" });
  assert.deepEqual(K.captionSamenstellen({ ...p, hashtags_plek: "reactie", eerste_reactie: "Link in bio" }), { caption: "Nieuw project", eersteReactie: "Link in bio\n\n#a #b" });
  assert.equal(K.captionSamenstellen(p, "Voor FB").caption, "Voor FB\n\n#a #b");
  assert.equal(K.captionSamenstellen(p, "  ").caption, "Nieuw project\n\n#a #b");
  assert.equal(K.captionSamenstellen({ ...p, caption: "", hashtags: "" }).caption, "");
});

// ---------- parsePost ----------
test("concept mag zonder datum, kanalen en media", () => {
  const r = K.parsePost({ soort: "foto", caption: "Idee" }, opt());
  assert.ok(r.ok, r.fout);
  assert.equal(r.post.status, "concept");
  assert.equal(r.post.gepland_op, null);
  assert.deepEqual(r.post.kanalen, []);
});
test("inplannen: geldig met media, datum in de toekomst", () => {
  const r = K.parsePost(plan({ hashtags: "zomer bbq", collaborators: ["@partner"], gebruikers_tags: [{ gebruikersnaam: "@klant", x: 0.5, y: 0.25, media_index: 0 }] }), opt({ media: [JPG] }));
  assert.ok(r.ok, r.ok ? "" : r.fouten.join("; "));
  assert.equal(r.post.hashtags, "#zomer #bbq");
  assert.deepEqual(r.post.collaborators, ["partner"]);
  assert.deepEqual(r.post.gebruikers_tags, [{ gebruikersnaam: "klant", x: 0.5, y: 0.25, media_index: 0 }]);
  assert.equal(r.post.gepland_op, "2026-11-26T18:30:00.000Z");
});
test("inplannen: verleden, zonder datum, zonder kanaal, zonder media geweigerd", () => {
  const verleden = K.parsePost(plan({ gepland_op: "2026-11-20T11:59:00Z" }), opt({ media: [JPG] }));
  assert.ok(!verleden.ok && /verleden/.test(verleden.fout));
  const zonder = K.parsePost(plan({ gepland_op: null }), opt({ media: [JPG] }));
  assert.ok(!zonder.ok && /datum en tijd/.test(zonder.fout));
  const geenKanaal = K.parsePost(plan({ kanalen: [] }), opt({ media: [JPG] }));
  assert.ok(!geenKanaal.ok && geenKanaal.fouten.some((f) => /minstens één kanaal/.test(f)));
  const geenMedia = K.parsePost(plan(), opt());
  assert.ok(!geenMedia.ok && geenMedia.fouten.some((f) => /Voeg een afbeelding toe/.test(f)));
  const teVer = K.parsePost(plan({ gepland_op: "2028-01-01T10:00:00Z" }), opt({ media: [JPG] }));
  assert.ok(!teVer.ok);
  const status = K.parsePost(plan({ status: "geplaatst" }), opt({ media: [JPG] }));
  assert.ok(!status.ok);
});
test("caption: 2200 tekens, ook met hashtags; max 30 hashtags en 20 vermeldingen", () => {
  assert.ok(K.parsePost({ soort: "foto", caption: "a".repeat(2200) }, opt()).ok);
  assert.ok(!K.parsePost({ soort: "foto", caption: "a".repeat(2201) }, opt()).ok);
  const metTags = K.parsePost({ soort: "foto", caption: "a".repeat(2195), hashtags: "zomer" }, opt());
  assert.ok(!metTags.ok && /met hashtags is te lang/.test(metTags.fout));
  assert.ok(K.parsePost({ soort: "foto", caption: "a".repeat(2195), hashtags: "zomer", hashtags_plek: "reactie" }, opt()).ok);
  const tags = Array.from({ length: 31 }, (_, i) => `t${i}`).join(" ");
  assert.ok(!K.parsePost({ soort: "foto", hashtags: tags }, opt()).ok);
  assert.ok(K.parsePost({ soort: "foto", hashtags: Array.from({ length: 30 }, (_, i) => `t${i}`).join(" ") }, opt()).ok);
  const tagsInCaption = `${Array.from({ length: 20 }, (_, i) => `#c${i}`).join(" ")}`;
  assert.ok(!K.parsePost({ soort: "foto", caption: tagsInCaption, hashtags: Array.from({ length: 11 }, (_, i) => `t${i}`).join(" ") }, opt()).ok);
  const vermeld = Array.from({ length: 21 }, (_, i) => `@p${i}`).join(" ");
  assert.ok(!K.parsePost({ soort: "foto", caption: vermeld }, opt()).ok);
  const eigen = K.parsePost({ soort: "foto", kanalen: [{ account_id: FB.id, caption_eigen: "b".repeat(2201) }] }, opt());
  assert.ok(!eigen.ok);
});
test("gebruikerstags en collaborators", () => {
  const veel = Array.from({ length: 21 }, (_, i) => ({ gebruikersnaam: `p${i}`, x: 0.1, y: 0.1, media_index: 0 }));
  assert.ok(!K.parsePost({ soort: "foto", gebruikers_tags: veel }, opt()).ok);
  assert.ok(!K.parsePost({ soort: "foto", gebruikers_tags: [{ gebruikersnaam: "a b", x: 0, y: 0 }] }, opt()).ok);
  assert.ok(!K.parsePost({ soort: "foto", gebruikers_tags: [{ gebruikersnaam: "ok", x: 1.2, y: 0 }] }, opt()).ok);
  const opVideo = K.parsePost({ soort: "reel", gebruikers_tags: [{ gebruikersnaam: "ok", x: 0.5, y: 0.5, media_index: 0 }] }, opt({ media: [REEL] }));
  assert.ok(!opVideo.ok && /alleen op een afbeelding/.test(opVideo.fout));
  const weg = K.parsePost({ soort: "carrousel", gebruikers_tags: [{ gebruikersnaam: "ok", x: 0.5, y: 0.5, media_index: 3 }] }, opt({ media: [JPG, JPG] }));
  assert.ok(!weg.ok);
  assert.ok(!K.parsePost({ soort: "foto", collaborators: ["a", "b", "c", "d"] }, opt()).ok);
  const dubbel = K.parsePost({ soort: "foto", collaborators: ["a", "@A", ""] }, opt());
  assert.ok(dubbel.ok);
  assert.deepEqual(dubbel.post.collaborators, ["a"]);
  const alleenFb = K.parsePost({ soort: "foto", collaborators: ["a"], kanalen: [{ account_id: FB.id }] }, opt());
  assert.ok(alleenFb.ok && alleenFb.waarschuwingen.some((w) => /alleen op Instagram/.test(w)));
});
test("kanalen: onbekend, uitgeschakeld, dubbel; tekst alleen Facebook", () => {
  assert.ok(!K.parsePost({ soort: "foto", kanalen: [{ account_id: "44444444-4444-4444-8444-444444444444" }] }, opt()).ok);
  assert.ok(!K.parsePost({ soort: "foto", kanalen: [{ account_id: UIT.id }] }, opt()).ok);
  const dubbel = K.parsePost({ soort: "foto", kanalen: [{ account_id: IG.id }, { account_id: IG.id }] }, opt());
  assert.ok(dubbel.ok && dubbel.post.kanalen.length === 1);
  const tekstIg = K.parsePost({ soort: "tekst", caption: "Hoi", kanalen: [{ account_id: IG.id }] }, opt());
  assert.ok(!tekstIg.ok && /Instagram kan geen post zonder foto/.test(tekstIg.fout));
  const tekstFb = K.parsePost(plan({ soort: "tekst", caption: "Hoi", kanalen: [{ account_id: FB.id }] }), opt({ media: [] }));
  assert.ok(tekstFb.ok, tekstFb.ok ? "" : tekstFb.fouten.join("; "));
  const leeg = K.parsePost(plan({ soort: "tekst", caption: " ", kanalen: [{ account_id: FB.id }] }), opt({ media: [] }));
  assert.ok(!leeg.ok);
  assert.ok(!K.parsePost(plan({ soort: "tekst", kanalen: [{ account_id: FB.id }] }), opt({ media: [JPG] })).ok);
  assert.ok(!K.parsePost({ soort: "iets" }, opt()).ok);
});
test("locatie", () => {
  assert.ok(K.parsePost({ soort: "foto", locatie_id: "1234567", locatie_naam: "Amsterdam" }, opt()).ok);
  assert.ok(!K.parsePost({ soort: "foto", locatie_id: "abc" }, opt()).ok);
  assert.equal(K.parsePost({ soort: "foto", locatie_naam: "Los" }, opt()).post.locatie_naam, null);
});

// ---------- media ----------
test("aantal media per soort", () => {
  assert.equal(K.controleerMedia("foto", [JPG], ["instagram"]).fouten.length, 0);
  assert.ok(K.controleerMedia("foto", [JPG, JPG], ["instagram"]).fouten.length);
  assert.ok(K.controleerMedia("carrousel", [JPG], ["instagram"]).fouten.some((f) => /2 t\/m 10/.test(f)));
  assert.equal(K.controleerMedia("carrousel", Array(10).fill(JPG), ["instagram"]).fouten.length, 0);
  assert.ok(K.controleerMedia("carrousel", Array(11).fill(JPG), ["instagram"]).fouten.length);
  assert.equal(K.controleerMedia("reel", [REEL], ["instagram", "facebook"]).fouten.length, 0);
  assert.ok(K.controleerMedia("reel", [JPG], ["instagram"]).fouten.length);
  assert.ok(K.controleerMedia("foto", [REEL], ["instagram"]).fouten.some((f) => /Reel/.test(f)));
  assert.ok(K.controleerMedia("tekst", [JPG], ["facebook"]).fouten.length);
});
test("beeldverhouding en formaat Instagram-feed", () => {
  assert.equal(K.controleerBestand({ ...JPG, breedte: 1080, hoogte: 1080 }, "foto", ["instagram"]).fouten.length, 0);
  assert.equal(K.controleerBestand({ ...JPG, breedte: 1080, hoogte: 566 }, "foto", ["instagram"]).fouten.length, 0); // 1.91:1
  assert.ok(K.controleerBestand({ ...JPG, breedte: 1080, hoogte: 1920 }, "foto", ["instagram"]).fouten.some((f) => /beeldverhouding/.test(f))); // 9:16
  assert.ok(K.controleerBestand({ ...JPG, breedte: 2000, hoogte: 800 }, "foto", ["instagram"]).fouten.length); // 2.5:1
  assert.ok(K.controleerBestand(PNG, "foto", ["instagram"]).fouten.some((f) => /JPEG/.test(f)));
  assert.equal(K.controleerBestand(PNG, "foto", ["facebook"]).fouten.length, 0);
  assert.ok(K.controleerBestand({ ...JPG, mime: "image/webp" }, "foto", ["facebook"]).fouten.length);
  assert.ok(K.controleerBestand({ ...JPG, grootte: 9 * 1024 * 1024 }, "foto", ["instagram"]).fouten.some((f) => /8 MB/.test(f)));
  assert.ok(K.controleerBestand({ ...JPG, mime: "image/gif" }, "foto", ["facebook"]).fouten.length);
  assert.ok(K.controleerBestand({ ...JPG, breedte: 300, hoogte: 300 }, "foto", ["instagram"]).waarschuwingen.length);
  assert.ok(K.controleerBestand({ ...JPG, mime: "video/mp4" }, "foto", ["instagram"]).fouten.length);
});
test("reels: duur, afmetingen, 9:16, Facebook-grenzen", () => {
  assert.ok(K.controleerBestand({ ...REEL, duur_sec: 2 }, "reel", ["instagram"]).fouten.some((f) => /te kort/.test(f)));
  assert.equal(K.controleerBestand({ ...REEL, duur_sec: 600 }, "reel", ["instagram"]).fouten.length, 0);
  assert.ok(K.controleerBestand({ ...REEL, duur_sec: 901 }, "reel", ["instagram"]).fouten.length);
  assert.ok(K.controleerBestand({ ...REEL, duur_sec: 120 }, "reel", ["facebook"]).fouten.some((f) => /Facebook/.test(f)));
  assert.ok(K.controleerBestand({ ...REEL, breedte: 2160, hoogte: 3840 }, "reel", ["instagram"]).fouten.some((f) => /te breed/.test(f)));
  assert.ok(K.controleerBestand({ ...REEL, breedte: 480, hoogte: 854 }, "reel", ["facebook"]).fouten.some((f) => /te klein/.test(f)));
  assert.ok(K.controleerBestand({ ...REEL, breedte: 1080, hoogte: 1080 }, "reel", ["instagram"]).waarschuwingen.some((w) => /9:16/.test(w)));
  assert.ok(K.controleerBestand({ ...REEL, grootte: 60 * 1024 * 1024 }, "reel", ["instagram"]).fouten.length);
  assert.ok(K.controleerBestand({ ...REEL, duur_sec: null }, "reel", ["instagram"]).waarschuwingen.length);
});
test("carrousel: video op Instagram tot 60 s, niet op Facebook", () => {
  const vid = { ...REEL, breedte: 1080, hoogte: 1080, duur_sec: 30 };
  assert.equal(K.controleerMedia("carrousel", [JPG, vid], ["instagram"]).fouten.length, 0);
  assert.ok(K.controleerMedia("carrousel", [JPG, { ...vid, duur_sec: 61 }], ["instagram"]).fouten.length);
  assert.ok(K.controleerMedia("carrousel", [JPG, vid], ["facebook"]).fouten.some((f) => /Facebook kan geen video in een carrousel/.test(f)));
  assert.ok(K.controleerMedia("carrousel", [JPG, PNG], ["instagram", "facebook"]).fouten.some((f) => /Bestand 2/.test(f)));
});

// ---------- aan de beurt en herkansingen ----------
test("isAanDeBeurt met marge, reel-voorbereiding, te laat", () => {
  const t = "2026-11-26T18:30:00Z";
  assert.ok(!K.isAanDeBeurt(t, new Date("2026-11-26T18:25:00Z")));
  assert.ok(K.isAanDeBeurt(t, new Date("2026-11-26T18:29:30Z")));
  assert.ok(K.isAanDeBeurt(t, new Date("2026-11-26T18:30:00Z")));
  assert.ok(K.isAanDeBeurt(t, new Date("2026-11-26T18:40:00Z")));
  assert.ok(!K.isAanDeBeurt(null, NU));
  assert.ok(!K.isAanDeBeurt("onzin", NU));
  assert.ok(K.isReelVoorbereidingAanDeBeurt(t, new Date("2026-11-26T18:16:00Z")));
  assert.ok(!K.isReelVoorbereidingAanDeBeurt(t, new Date("2026-11-26T18:10:00Z")));
  assert.ok(!K.isTeLaat(t, new Date("2026-11-27T06:00:00Z")));
  assert.ok(K.isTeLaat(t, new Date("2026-11-27T07:00:00Z")));
  // De cron draait elke 5 min: hooguit 5 min (plus de duur van een run) te laat.
  assert.ok(K.CRON_INTERVAL_MIN * 60_000 <= 15 * 60_000);
});
test("herkansingen na 5, 15, 60 minuten, daarna opgeven", () => {
  assert.equal(K.volgendePoging(1, NU).toISOString(), "2026-11-20T12:05:00.000Z");
  assert.equal(K.volgendePoging(2, NU).toISOString(), "2026-11-20T12:15:00.000Z");
  assert.equal(K.volgendePoging(3, NU).toISOString(), "2026-11-20T13:00:00.000Z");
  assert.equal(K.volgendePoging(4, NU), null);
  assert.equal(K.volgendePoging(0, NU), null);
  assert.equal(K.volgendePoging(1, NU, true), null);
  assert.equal(K.MAX_HERKANSINGEN, 3);
});

// ---------- tijdzone ----------
test("Amsterdam ↔ UTC, ook rond de zomertijd", () => {
  assert.equal(K.amsterdamNaarUtc("2026-11-26", "19:30").toISOString(), "2026-11-26T18:30:00.000Z");
  assert.equal(K.amsterdamNaarUtc("2026-07-01", "09:00").toISOString(), "2026-07-01T07:00:00.000Z");
  // 29 maart 2026: 02:00 → 03:00. 02:30 bestaat niet → 03:30 zomertijd.
  assert.equal(K.amsterdamNaarUtc("2026-03-29", "02:30").toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(K.amsterdamNaarUtc("2026-03-29", "03:30").toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(K.amsterdamNaarUtc("2026-03-29", "01:30").toISOString(), "2026-03-29T00:30:00.000Z");
  // 25 oktober 2026: 03:00 → 02:00. 02:30 komt twee keer voor → de eerste (zomertijd).
  assert.equal(K.amsterdamNaarUtc("2026-10-25", "02:30").toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal(K.amsterdamNaarUtc("2026-10-25", "04:00").toISOString(), "2026-10-25T03:00:00.000Z");
  assert.equal(K.amsterdamNaarUtc("2026-02-30", "10:00"), null);
  assert.equal(K.amsterdamNaarUtc("2026-11-26", "24:00"), null);
  assert.equal(K.amsterdamNaarUtc("26-11-2026", "19:30"), null);
  assert.deepEqual(K.utcNaarAmsterdam("2026-11-26T18:30:00Z"), { datum: "2026-11-26", tijd: "19:30" });
  assert.deepEqual(K.utcNaarAmsterdam(new Date("2026-06-30T22:30:00Z")), { datum: "2026-07-01", tijd: "00:30" });
  assert.equal(K.amsterdamDatum("2026-12-31T23:30:00Z"), "2027-01-01");
  for (const [d, t] of [["2026-01-15", "00:00"], ["2026-05-05", "23:59"], ["2026-10-25", "01:15"], ["2026-12-31", "12:00"]]) {
    assert.deepEqual(K.utcNaarAmsterdam(K.amsterdamNaarUtc(d, t)), { datum: d, tijd: t });
  }
});
test("weergave: donderdag 26 november 19:30", () => {
  assert.equal(K.formatGepland("2026-11-26T18:30:00Z", NU), "donderdag 26 november 19:30");
  assert.equal(K.formatGepland("2027-01-01T08:00:00Z", NU), "vrijdag 1 januari 2027 09:00");
});

// ---------- media-paden ----------
test("media-paden: veilig en per post", () => {
  const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const p = K.maakMediaPad(id, "Zomer Café (1).JPG", "a1b2c3d4");
  assert.equal(p, `${id}/a1b2c3d4-zomer-cafe-1.jpg`);
  assert.equal(K.maakMediaPad(id, "a..b.jpg", "a1b2c3d4"), `${id}/a1b2c3d4-a.b.jpg`);
  assert.ok(K.isMediaPadVanPost(p, id));
  assert.equal(K.maakMediaPad(id, "../../etc/passwd", "a1b2c3d4"), `${id}/a1b2c3d4-etc-passwd`);
  assert.equal(K.maakMediaPad("geen-uuid", "x.jpg", "a1b2c3d4"), null);
  assert.equal(K.maakMediaPad(id, "x.jpg", "../"), null);
  assert.ok(!K.isMediaPadVanPost(`${id}/../ander/x.jpg`, id));
  assert.ok(!K.isMediaPadVanPost(`bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee/x.jpg`, id));
  assert.ok(!K.isMediaPadVanPost(`${id}/sub/x.jpg`, id));
});

// ---------- bron: migratie, back-up, types ----------
test("migratie 0041: RLS aan, geen policies, revoke, privé-bucket, identieke kopie", () => {
  const m = lees("supabase/migrations/0041_social_planning.sql");
  assert.equal(lees("supabase/UITVOEREN_0041.sql"), m);
  const tabellen = [...m.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((x) => x[1]);
  assert.deepEqual(tabellen, ["social_accounts", "social_posts", "social_post_kanalen", "social_media", "social_inzichten", "social_account_inzichten"]);
  for (const t of tabellen) {
    assert.ok(m.includes(`alter table public.${t} enable row level security;`), `${t}: RLS`);
    assert.ok(m.includes(`revoke all on public.${t} from anon, authenticated;`), `${t}: revoke`);
  }
  assert.ok(!/create policy/i.test(m), "geen policies");
  assert.ok(!/\bgrant\b/i.test(m), "geen grants");
  assert.ok(!/drop table|social_projects|social_slides|social_versions|social_brand|social-assets'/i.test(m.replace(/^--.*$/gm, "")), "oude social-tabellen niet aangeraakt");
  assert.ok(/insert into storage\.buckets[\s\S]*'social-media', 'social-media', false, 52428800/.test(m), "bucket privé, 50 MB");
  for (const mime of ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"]) assert.ok(m.includes(`'${mime}'`), mime);
  assert.ok(/on conflict \(id\) do update/.test(m) && /create index if not exists/.test(m), "idempotent");
  assert.ok(/check \(char_length\(caption\) <= 2200\)/.test(m));
  assert.ok(/unique \(account_id, extern_post_id, datum\)/.test(m) && /primary key \(account_id, datum\)/.test(m));
});
test("back-up: nieuwe tabellen in FK-volgorde en de bucket", () => {
  const lijst = F.TABELLEN.map((t) => t.naam);
  const plek = (n) => lijst.indexOf(n);
  for (const t of ["social_accounts", "social_posts", "social_post_kanalen", "social_media", "social_inzichten", "social_account_inzichten"]) assert.ok(plek(t) >= 0, t);
  assert.ok(plek("social_accounts") < plek("social_post_kanalen") && plek("social_posts") < plek("social_post_kanalen"));
  assert.ok(plek("social_post_kanalen") < plek("social_inzichten") && plek("social_posts") < plek("social_media"));
  assert.ok(F.BUCKETS.includes("social-media"));
});
test("types: geen tokens in de DTO's, contract bovenaan", () => {
  const t = lees("lib/social/types.ts");
  const dtoDeel = t.slice(t.indexOf("// Naar de browser"));
  assert.ok(!/token_enc|container_id|\bpad:\s*string;\s*\n\s*type: MediaType/.test(dtoDeel.slice(0, dtoDeel.indexOf("export interface PostInvoer"))), "DTO's zonder token_enc/container_id/pad");
  for (const pad of ["/api/social/accounts", "/api/social/meta/callback", "/api/cron/social", "/api/social/posts/[id]/nu", "/api/social/media/upload-url", "/api/social/inzichten"]) assert.ok(t.includes(pad), pad);
  const k = lees("lib/social/kern.ts");
  assert.ok(!/from ['"]@\//.test(k), "kern.ts zonder @/-imports");
});

console.log(`test-social: ${geslaagd} geslaagd${mislukt ? `, ${mislukt} mislukt` : ""}`);
if (mislukt) process.exit(1);
