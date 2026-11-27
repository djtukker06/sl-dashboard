// Tests voor de social-schermen en de post-API (migratie 0041), zonder database en zonder netwerk:
//   - lib/social/weergave.ts: filters, lijstgroepen, maandkalender, standaardmoment en
//     snelkeuzes (Europe/Amsterdam), volgorde, beeldverhouding, PATCH samenvoegen, analytics
//     (totalen, beste posts, per groep, volgersreeks, lijn) en meldingen per veld;
//   - bron: elke pagina via vereisTeamlidPagina, elke route via socialRoute (teamcheck +
//     service-role met bewijs), geen tokens of server-code in de client, geen publieke bucket,
//     conditionele updates tegen de cron, en de koppeling met plaatsPost.
//   node --experimental-strip-types scripts/test-social-ui.mjs
import fs from "node:fs";
import path from "node:path";
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
const W = await import("../lib/social/weergave.ts");
const K = await import("../lib/social/kern.ts");

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
const wortel = new URL("../", import.meta.url).pathname;
const lees = (p) => fs.readFileSync(path.join(wortel, p), "utf8");
const bestaat = (p) => fs.existsSync(path.join(wortel, p));
/** Alle bestanden onder een map (zonder de " 2"-duplicaten). */
function bestanden(map, filter = () => true) {
  const uit = [];
  const loop = (d) => {
    for (const e of fs.readdirSync(path.join(wortel, d), { withFileTypes: true })) {
      if (e.name.includes(" 2")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) loop(p);
      else if (filter(p)) uit.push(p);
    }
  };
  if (bestaat(map)) loop(map);
  return uit;
}

function post(o = {}) {
  return {
    id: o.id ?? "11111111-1111-4111-8111-111111111111",
    status: "concept",
    soort: "foto",
    titel: "",
    caption: "",
    eerste_reactie: "",
    hashtags: "",
    hashtags_plek: "caption",
    locatie_id: null,
    locatie_naam: null,
    gebruikers_tags: [],
    collaborators: [],
    gepland_op: null,
    geplaatst_op: null,
    notities: "",
    bron: "dashboard",
    aangemaakt_door: null,
    aangemaakt_op: "2026-11-01T10:00:00.000Z",
    gewijzigd_op: "2026-11-01T10:00:00.000Z",
    kanalen: [],
    media: [],
    ...o
  };
}
const NU = new Date("2026-11-26T12:00:00.000Z"); // donderdag 13:00 in Amsterdam

// ---------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------

test("statusfilters: ingepland met bezig, geplaatst/mislukt met deels", () => {
  assert.deepEqual(W.statussenVoorFilter("ingepland"), ["ingepland", "bezig"]);
  assert.deepEqual(W.statussenVoorFilter("geplaatst"), ["geplaatst", "deels"]);
  assert.deepEqual(W.statussenVoorFilter("mislukt"), ["mislukt", "deels"]);
  assert.deepEqual(W.statussenVoorFilter("concept"), ["concept"]);
  assert.deepEqual(W.FILTER_STATUSSEN.map((s) => s.label), ["Concept", "Ingepland", "Geplaatst", "Mislukt"]);
});

test("lijstgroepen: komt eraan oplopend, concepten zonder datum, eerder aflopend", () => {
  const a = post({ id: "a", status: "ingepland", gepland_op: "2026-11-28T18:30:00.000Z" });
  const b = post({ id: "b", status: "ingepland", gepland_op: "2026-11-27T18:30:00.000Z" });
  const c = post({ id: "c", status: "concept" });
  const d = post({ id: "d", status: "geplaatst", geplaatst_op: "2026-11-20T18:30:00.000Z" });
  const e = post({ id: "e", status: "mislukt", gepland_op: "2026-11-25T18:30:00.000Z" });
  const f = post({ id: "f", status: "concept", gepland_op: "2026-12-01T18:30:00.000Z" });
  const g = W.groepeerVoorLijst([a, b, c, d, e, f], NU);
  assert.deepEqual(g.map((x) => x.sleutel), ["gepland", "zonder", "eerder"]);
  assert.deepEqual(g[0].posts.map((p) => p.id), ["b", "a", "f"]);
  assert.deepEqual(g[1].posts.map((p) => p.id), ["c"]);
  assert.deepEqual(g[2].posts.map((p) => p.id), ["e", "d"]);
  assert.deepEqual(W.groepeerVoorLijst([], NU), []);
});

test("korte caption op een woordgrens", () => {
  assert.equal(W.kortCaption("kort"), "kort");
  const lang = "Dit is een vrij lange caption over het nieuwe interieur van de studio in Amsterdam";
  const k = W.kortCaption(lang, 40);
  assert.ok(k.endsWith("…") && [...k].length <= 41, k);
  assert.ok(!k.includes("  "));
  assert.equal(W.kortCaption("a\n\nb"), "a b");
});

test("maandkalender: maandag eerst, aangevuld, 4–6 weken", () => {
  const nov = W.maandRaster("2026-11"); // 1 nov 2026 = zondag
  assert.equal(nov[0][0], "2026-10-26");
  assert.equal(nov[0][6], "2026-11-01");
  assert.equal(nov.at(-1).at(-1), "2026-12-06");
  assert.equal(nov.length, 6);
  const feb = W.maandRaster("2027-02"); // 1 feb 2027 = maandag, 28 dagen
  assert.equal(feb.length, 4);
  assert.equal(feb[0][0], "2027-02-01");
  for (const w of [...nov, ...feb]) assert.equal(w.length, 7);
  assert.deepEqual(W.maandBereik("2028-02"), { van: "2028-02-01", tot: "2028-02-29" });
  assert.equal(W.verschuifMaand("2026-12", 1), "2027-01");
  assert.equal(W.verschuifMaand("2026-01", -1), "2025-12");
  assert.equal(W.maandLabel("2026-11"), "november 2026");
  assert.equal(W.weekdagIndex("2026-11-26"), 3); // donderdag
  assert.ok(W.isDatum("2026-11-26") && !W.isDatum("2026-02-30") && !W.isDatum("26-11-2026"));
  assert.ok(W.isMaand("2026-11") && !W.isMaand("2026-13"));
});

test("posts per dag volgens Amsterdamse tijd (23:30 UTC = volgende dag)", () => {
  const p1 = post({ id: "1", status: "ingepland", gepland_op: "2026-11-26T23:30:00.000Z" });
  const p2 = post({ id: "2", status: "geplaatst", geplaatst_op: "2026-11-26T08:00:00.000Z", gepland_op: "2026-11-25T08:00:00.000Z" });
  const p3 = post({ id: "3" });
  const m = W.postsPerDag([p1, p2, p3]);
  assert.deepEqual(m.get("2026-11-27").map((p) => p.id), ["1"]);
  assert.deepEqual(m.get("2026-11-26").map((p) => p.id), ["2"]);
  assert.equal([...m.values()].flat().length, 2);
});

test("standaardmoment: morgen 19:30, of de gekozen dag; nooit in het verleden", () => {
  assert.deepEqual(W.standaardMoment(NU), { datum: "2026-11-27", tijd: "19:30" });
  assert.deepEqual(W.standaardMoment(NU, "2026-11-26"), { datum: "2026-11-26", tijd: "19:30" });
  assert.deepEqual(W.standaardMoment(NU, "2026-12-24"), { datum: "2026-12-24", tijd: "19:30" });
  assert.deepEqual(W.standaardMoment(NU, "2026-11-01"), { datum: "2026-11-27", tijd: "19:30" });
  const laat = new Date("2026-11-26T19:00:00.000Z"); // 20:00 in Amsterdam
  assert.deepEqual(W.standaardMoment(laat, "2026-11-26"), { datum: "2026-11-27", tijd: "19:30" });
  // Het voorbeeld van de gebruiker: donderdag 26 november 19:30 = 18:30 UTC (wintertijd).
  assert.equal(K.amsterdamNaarUtc("2026-11-26", "19:30").toISOString(), "2026-11-26T18:30:00.000Z");
});

test("snelkeuzes: vanavond alleen als het nog ruim kan, daarna vrijdag en zondag", () => {
  const s = W.snelkeuzes(NU);
  assert.equal(s[0].label, "Vanavond 19:30");
  assert.deepEqual(s.map((x) => x.datum), ["2026-11-26", "2026-11-27", "2026-11-27", "2026-12-04", "2026-11-29"]);
  assert.ok(s[3].label.startsWith("Vrijdag 4 dec"));
  const laat = W.snelkeuzes(new Date("2026-11-26T18:20:00.000Z")); // 19:20 NL
  assert.ok(!laat.some((x) => x.label.startsWith("Vanavond")));
  for (const x of s) assert.ok(K.amsterdamNaarUtc(x.datum, x.tijd).getTime() > NU.getTime());
});

test("verplaatsen (slepen/pijltjes)", () => {
  assert.deepEqual(W.verplaats(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(W.verplaats(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  const l = ["a", "b"];
  assert.equal(W.verplaats(l, 0, 5), l);
  assert.equal(W.verplaats(l, 1, 1), l);
});

test("beeldverhouding als tekst en voor het voorbeeld", () => {
  assert.equal(W.verhoudingLabel(1080, 1350), "4:5");
  assert.equal(W.verhoudingLabel(1080, 1920), "9:16");
  assert.equal(W.verhoudingLabel(1080, 1080), "1:1");
  assert.equal(W.verhoudingLabel(1910, 1000), "1,91:1");
  assert.equal(W.verhoudingLabel(null, 10), "");
  assert.equal(W.voorbeeldVerhouding("reel", { breedte: 1080, hoogte: 1080 }), 9 / 16);
  assert.equal(W.voorbeeldVerhouding("foto", { breedte: 1000, hoogte: 3000 }), 0.8);
  assert.equal(W.voorbeeldVerhouding("foto", { breedte: 4000, hoogte: 1000 }), 1.91);
  assert.equal(W.voorbeeldVerhouding("carrousel", null), 1);
});

test("PATCH samenvoegen: wijzigingen over de bestaande post, controle op het geheel", () => {
  const acc = "22222222-2222-4222-8222-222222222222";
  const bestaand = post({
    status: "ingepland",
    soort: "tekst",
    caption: "Hallo",
    gepland_op: "2026-11-27T18:30:00.000Z",
    kanalen: [{ id: "k", account_id: acc, platform: "facebook", account_naam: "Pagina", account_gebruikersnaam: null, status: "ingepland", caption_eigen: "Eigen", extern_post_id: null, permalink: null, fout: null, pogingen: 0, volgende_poging_op: null, geplaatst_op: null }]
  });
  const s = W.samenvoegen(bestaand, { caption: "Nieuw" });
  assert.equal(s.status, "ingepland");
  assert.equal(s.caption, "Nieuw");
  assert.equal(s.gepland_op, "2026-11-27T18:30:00.000Z");
  assert.deepEqual(s.kanalen, [{ account_id: acc, caption_eigen: "Eigen" }]);
  assert.equal(W.samenvoegen(bestaand, { gepland_op: null }).gepland_op, null);
  assert.equal(W.samenvoegen(post({ status: "mislukt" }), {}).status, "concept");
  const r = K.parsePost(s, { nu: NU, accounts: [{ id: acc, platform: "facebook", actief: true }], media: [] });
  assert.ok(r.ok, r.fout);
  const te = K.parsePost(W.samenvoegen(bestaand, { gepland_op: "2026-11-20T10:00:00.000Z" }), { nu: NU, accounts: [{ id: acc, platform: "facebook", actief: true }], media: [] });
  assert.ok(!te.ok && W.foutVeld(te.fout) === "tijd");
});

test("alleen notities (het enige wat bij een geplaatste post mag)", () => {
  assert.ok(W.alleenNotities({ notities: "x" }));
  assert.ok(W.alleenNotities({ notities: "", caption: undefined }));
  assert.ok(!W.alleenNotities({ notities: "x", caption: "y" }));
  assert.ok(!W.alleenNotities({}));
  assert.ok(!W.alleenNotities({ caption: "y" }));
});

test("meldingen van parsePost komen bij het juiste veld", () => {
  const ig = "33333333-3333-4333-8333-333333333333";
  const r = K.parsePost(
    { status: "ingepland", soort: "tekst", hashtags: "#a-b", kanalen: [{ account_id: ig }], collaborators: ["a", "b", "c", "d"], gebruikers_tags: [{ gebruikersnaam: "x", x: 2, y: 0 }] },
    { nu: NU, accounts: [{ id: ig, platform: "instagram", actief: true }], media: [] }
  );
  assert.ok(!r.ok);
  const v = W.foutenPerVeld(r.fouten);
  assert.ok(v.kanalen?.length, JSON.stringify(v));
  assert.ok(v.hashtags?.length, JSON.stringify(v));
  assert.ok(v.tijd?.length, JSON.stringify(v));
  assert.ok(v.collaborators?.length, JSON.stringify(v));
  assert.ok(v.tags?.length, JSON.stringify(v));
  assert.equal(W.foutVeld("Voeg een afbeelding toe."), "media");
  assert.equal(W.foutVeld("Bestand 2: de beeldverhouding past niet op Instagram (tussen 4:5 staand en 1,91:1 liggend). Snijd hem bij."), "media");
  assert.equal(W.foutVeld(`De caption is te lang (max. ${K.MAX_CAPTION} tekens).`), "caption");
  assert.equal(W.foutVeld("De caption met hashtags is te lang (max. 2200 tekens)."), "caption");
  assert.equal(W.foutVeld("Te veel hashtags in de eerste reactie (max. 30)."), "hashtags");
  assert.equal(W.foutVeld("De eerste reactie is te lang (max. 2200 tekens)."), "reactie");
  assert.equal(W.foutVeld("Kies minstens één kanaal."), "kanalen");
  assert.equal(W.foutVeld("Ongeldige locatie; kies hem opnieuw."), "locatie");
  assert.equal(W.foutVeld("Iets onbekends."), "algemeen");
});

test("namen splitsen en soort na het toevoegen van bestanden", () => {
  assert.deepEqual(W.splitsNamen("@a, b ,@A  @c"), ["a", "b", "c"]);
  const beeld = { type: "afbeelding" };
  const video = { type: "video" };
  assert.equal(W.soortNaToevoegen("foto", [], [video]), "reel");
  assert.equal(W.soortNaToevoegen("foto", [], [beeld, beeld]), "carrousel");
  assert.equal(W.soortNaToevoegen("foto", [beeld], [beeld]), "carrousel");
  assert.equal(W.soortNaToevoegen("foto", [], [beeld]), "foto");
  assert.equal(W.soortNaToevoegen("tekst", [], [beeld]), "foto");
  assert.equal(W.soortNaToevoegen("reel", [video], [beeld]), "carrousel");
  assert.equal(W.soortNaToevoegen("carrousel", [beeld], [video]), "carrousel");
});

test("analytics: periode, totalen, interacties en beste posts", () => {
  assert.deepEqual(W.periodeBereik(7, NU), { van: "2026-11-20", tot: "2026-11-26" });
  assert.deepEqual(W.periodeBereik(30, NU), { van: "2026-10-28", tot: "2026-11-26" });
  assert.equal(W.interacties({ likes: 3, reacties: 2, opslagen: 1, gedeeld: 1 }), 7);
  assert.equal(W.interacties({ interacties: 9, likes: 1 }), 9);
  assert.equal(W.interacties(null), 0);
  assert.deepEqual(W.optellen([{ bereik: 10, likes: 1 }, null, { bereik: 5, x: Number.NaN }]), { bereik: 15, likes: 1 });
  const lijst = [
    { id: "a", cijfers: { bereik: 100, likes: 1 } },
    { id: "b", cijfers: { bereik: 300 } },
    { id: "c", cijfers: { weergaven: 200 } },
    { id: "d", cijfers: { bereik: 100, likes: 50 } }
  ];
  assert.deepEqual(W.bestePosts(lijst, 3).map((x) => x.id), ["b", "c", "d"]);
});

test("analytics: per soort, weekdag en dagdeel (Amsterdamse tijd)", () => {
  const rijen = [
    { soort: "reel", t: "2026-11-26T18:30:00.000Z", cijfers: { bereik: 400, likes: 10 } }, // do 19:30
    { soort: "reel", t: "2026-11-27T07:00:00.000Z", cijfers: { bereik: 200, likes: 0 } }, // vr 08:00
    { soort: "foto", t: "2026-11-29T23:30:00.000Z", cijfers: { bereik: 100 } } // ma 00:30
  ];
  const s = W.perGroep(rijen, (r) => r.soort, ["foto", "carrousel", "reel"]);
  assert.deepEqual(s.map((g) => [g.groep, g.aantal, g.bereik, g.interacties]), [["foto", 1, 100, 0], ["carrousel", 0, 0, 0], ["reel", 2, 300, 5]]);
  assert.equal(W.weekdagVan(rijen[0].t), "donderdag");
  assert.equal(W.weekdagVan(rijen[2].t), "maandag");
  assert.equal(W.dagdeel(rijen[0].t), "Avond");
  assert.equal(W.dagdeel(rijen[1].t), "Ochtend");
  assert.equal(W.dagdeel(rijen[2].t), "Nacht");
  assert.equal(W.dagdeel("2026-07-01T11:00:00.000Z"), "Middag"); // 13:00 zomertijd
});

test("volgersreeks: opgeteld over accounts, ontbrekende dag met de laatste stand", () => {
  const r = W.volgersReeks([
    { reeks: [{ datum: "2026-11-01", volgers: 100 }, { datum: "2026-11-03", volgers: 110 }] },
    { reeks: [{ datum: "2026-11-02", volgers: 50 }, { datum: "2026-11-03", volgers: null }] }
  ]);
  assert.deepEqual(r, [
    { datum: "2026-11-01", volgers: 100 },
    { datum: "2026-11-02", volgers: 150 },
    { datum: "2026-11-03", volgers: 160 }
  ]);
  assert.deepEqual(W.volgersReeks([]), []);
});

test("getallen en de lijn", () => {
  assert.equal(W.formatGetal(1234), "1.234");
  assert.equal(W.formatGetal(12345), "12,3k");
  assert.equal(W.formatGetal(1234567), "1,2 mln");
  assert.equal(W.formatGetal(null), "–");
  const l = W.lijnPad([10, 20, 15], 100, 50, 5);
  assert.equal(l.min, 10);
  assert.equal(l.max, 20);
  assert.deepEqual(l.punten.map((p) => p[0]), [0, 50, 100]);
  assert.equal(l.punten[1][1], 5); // max bovenaan
  assert.equal(l.punten[0][1], 45); // min onderaan
  assert.ok(l.d.startsWith("M0 45 L50 5"));
  assert.ok(W.lijnPad([7], 100, 50).d.startsWith("M0 25 L100 25"));
  assert.equal(W.lijnPad([], 100, 50).d, "");
});

// ---------------------------------------------------------------------------------
// Bron-checks
// ---------------------------------------------------------------------------------

const paginas = bestanden("app/(app)/social", (p) => p.endsWith("page.tsx"));
const routes = [
  ...bestanden("app/api/social/posts", (p) => p.endsWith("route.ts")),
  ...bestanden("app/api/social/media", (p) => p.endsWith("route.ts")),
  ...bestanden("app/api/social/inzichten", (p) => p.endsWith("route.ts"))
];
const client = bestanden("components/social", (p) => /\.(tsx?|ts)$/.test(p));
const eigenLib = ["lib/social/posts.ts", "lib/social/media.ts", "lib/social/inzichten-lezen.ts", "lib/social/weergave.ts"];

test("alle schermen bestaan en controleren zelf het teamlidmaatschap", () => {
  for (const p of ["page.tsx", "nieuw/page.tsx", "[id]/page.tsx", "analytics/page.tsx", "koppelingen/page.tsx"]) {
    assert.ok(paginas.includes(path.join("app/(app)/social", p)), `ontbreekt: ${p}`);
  }
  for (const p of paginas) {
    const s = lees(p);
    assert.match(s, /await vereisTeamlidPagina\(/, p);
    // De controle komt vóór het ophalen van gegevens.
    const controle = s.indexOf("vereisTeamlidPagina(");
    for (const lezen of ["accountsVoorPagina(", "postVoorPagina("]) {
      const i = s.indexOf(lezen, s.indexOf("export default"));
      if (i >= 0) assert.ok(i > s.indexOf("vereisTeamlidPagina(", s.indexOf("export default")), `${p}: ${lezen} vóór de teamcheck`);
    }
    assert.ok(controle > 0);
    assert.match(s, /<SocialNav /, `${p}: subnavigatie`);
  }
  assert.ok(!lees("app/(app)/social/page.tsx").includes("wordt gebouwd"), "de tijdelijke pagina is vervangen");
});

test("elke route gaat via socialRoute (teamcheck, herkomst, service-role met bewijs)", () => {
  const verwacht = [
    "app/api/social/posts/route.ts",
    "app/api/social/posts/[id]/route.ts",
    "app/api/social/posts/[id]/nu/route.ts",
    "app/api/social/posts/[id]/media/route.ts",
    "app/api/social/media/upload-url/route.ts",
    "app/api/social/media/[id]/route.ts",
    "app/api/social/inzichten/route.ts"
  ];
  for (const r of verwacht) assert.ok(routes.includes(r), `ontbreekt: ${r}`);
  for (const r of routes) {
    const s = lees(r);
    const methodes = [...s.matchAll(/export (?:const|async function) (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
    const gewikkeld = [...s.matchAll(/export const (GET|POST|PATCH|PUT|DELETE) = socialRoute\(/g)].map((m) => m[1]);
    assert.ok(methodes.length > 0, r);
    assert.deepEqual(gewikkeld, methodes, `${r}: niet alle methodes via socialRoute`);
    assert.ok(!/createServiceRoleClient|createClient\(/.test(s), `${r}: eigen client buiten socialRoute`);
  }
  const p = lees("lib/social/posts.ts");
  assert.match(p, /export function socialRoute[\s\S]*?teamlidRoute<C>\([\s\S]*?createServiceRoleClient\(lid\.bewijs\)/);
  assert.match(p, /^import 'server-only';/);
});

test("de API houdt rekening met de cron (conditionele updates) en roept plaatsPost aan", () => {
  const p = lees("lib/social/posts.ts");
  assert.match(p, /\.update\(\{ \.\.\.postVelden\(r\.post\)[\s\S]*?\.in\('status', BEWERKBAAR\)/, "wijzigen alleen zolang bewerkbaar");
  assert.match(p, /\.update\(\{ status: 'concept'[\s\S]*?\.eq\('status', 'ingepland'\)/, "annuleren alleen als nog ingepland");
  assert.match(p, /\.delete\(\)\.eq\('id', id\)\.neq\('status', 'bezig'\)/, "niet verwijderen tijdens plaatsen");
  assert.match(p, /if \(!isBewerkbaar\(bestaand\.status\)\) \{\s*if \(!alleenNotities\(body\)\)|alleenNotities\(body\) \|\| !isBewerkbaar/, "geplaatst: alleen notities");
  assert.match(p, /parsePost\(samen, \{ nu: new Date\(\), accounts: await parseAccounts\(service\), media: media\.map\(naarMeta\) \}\)/, "PATCH controleert het geheel met de media");
  const nu = lees("app/api/social/posts/[id]/nu/route.ts");
  assert.match(nu, /import \{ plaatsPost \} from '@\/lib\/social\/plaatsen';/);
  assert.match(nu, /await plaatsPost\(service, id\)/);
  assert.ok(nu.indexOf("klaarVoorNu(") < nu.indexOf("plaatsPost(service"), "eerst controleren, dan plaatsen");
});

test("geen tokens, storage-paden of server-code in de client", () => {
  for (const c of client) {
    const s = lees(c);
    for (const verboden of ["token_enc", "SUPABASE_SERVICE_ROLE", "service-role", "container_id", "process.env"]) {
      assert.ok(!s.includes(verboden), `${c} bevat ${verboden}`);
    }
    for (const imp of ["@/lib/social/posts", "@/lib/social/media", "@/lib/social/inzichten-lezen", "@/lib/social/plaatsen", "@/lib/supabase/service-role", "@/lib/supabase/server"]) {
      assert.ok(!s.includes(`'${imp}'`), `${c} importeert ${imp}`);
    }
  }
  const p = lees("lib/social/posts.ts");
  const kolommen = (naam) => new RegExp(`${naam} =\\s*'([^']+)'`).exec(p)?.[1] ?? "";
  for (const k of ["POST_KOLOMMEN", "KANAAL_KOLOMMEN", "ACCOUNT_KOLOMMEN", "MEDIA_KOLOMMEN"]) assert.ok(kolommen(k), k);
  assert.ok(!/token_enc|scopes|gekoppeld_door/.test(kolommen("ACCOUNT_KOLOMMEN")), "accounts zonder token");
  assert.ok(!kolommen("KANAAL_KOLOMMEN").includes("container_id"), "kanalen zonder container-id");
  assert.ok(!/select\(['"]\*/.test(p), "geen select(*)");
  // MediaDto naar de browser: wel een signed url, geen pad.
  assert.match(p, /url: urls\.get\(m\.pad\) \?\? null/);
  assert.ok(!/^\s+pad: m\.pad/m.test(p), "pad gaat niet naar de browser");
});

test("de bucket blijft privé: alleen signed URL's", () => {
  for (const f of [...eigenLib, ...client, ...routes]) {
    const s = lees(f);
    assert.ok(!/getPublicUrl|updateBucket|createBucket|public:\s*true/.test(s), `${f}: publieke bucket of URL`);
  }
  const m = lees("lib/social/media.ts");
  assert.match(m, /createSignedUploadUrl\(pad\)/);
  assert.match(m, /createSignedUrls\(uniek, seconden\)/);
  assert.match(m, /export async function publiekeMediaUrl\(service: SupabaseClient, pad: string, seconden: number\): Promise<string>/);
  assert.match(m, /createSignedUrl\(pad, /);
  assert.match(m, /^import 'server-only';/);
  // Upload rechtstreeks naar Storage (PUT naar de signed URL), niet via onze server.
  assert.match(lees("components/social/upload.ts"), /xhr\.open\('PUT', url\)/);
  assert.match(lees("lib/social/posts.ts"), /isMediaPadVanPost\(pad, postId\)/);
});

test("pure hulpjes zonder @/-imports; css, dashboardkaart en migratiemelding", () => {
  assert.ok(!/from '@\//.test(lees("lib/social/weergave.ts")));
  assert.match(lees("app/(app)/layout.tsx"), /import '\.\/social\.css';/);
  assert.ok(bestaat("app/(app)/social.css"));
  const dash = lees("app/(app)/page.tsx");
  assert.match(dash, /<SocialKaart lid=\{lid\} \/>/);
  assert.match(lees("components/dashboard/SocialKaart.tsx"), /createServiceRoleClient\(lid\.bewijs\)/);
  assert.match(lees("lib/social/posts.ts"), /kolomOntbreekt\(error\) \|\| bucketOntbreekt\(error\)\) return new SocialFout\(503, MIGRATIE_MELDING/);
  assert.match(lees("app/api/social/posts/route.ts"), /melding: MIGRATIE_MELDING/);
  // Geen secrets of tokens in logs: alleen logFout (maskeert).
  for (const f of eigenLib) assert.ok(!/console\.(log|error|warn)\(/.test(lees(f)), `${f}: gebruik logFout`);
});

// ---------- postNaam ----------
test("postNaam: eigen titel, anders caption, anders soort", () => {
  assert.equal(W.postNaam(post({ titel: "  Lancering   site ", caption: "Lang verhaal" })), "Lancering site");
  assert.equal(W.postNaam(post({ caption: "Nieuw project\nlive" })), "Nieuw project live");
  assert.equal(W.postNaam(post({ media: [{ id: "m" }] })), "Foto");
  assert.equal(W.postNaam(post({})), "Lege post");
  assert.equal(W.foutVeld("De titel is te lang (max. 120 tekens)."), "titel");
});

console.log(`test-social-ui: ${geslaagd} geslaagd, ${mislukt} mislukt`);
if (mislukt) process.exit(1);
