// Tests voor de Google Drive-koppeling (module Bestanden), zonder netwerk en zonder database.
// Google wordt nagebootst met een eigen fetch; er gaat niets naar buiten.
//   - lib/drive/kern.ts: map- en bestandsnamen, mappenpaden (Boekhouding/Facturen/<jaar>,
//     Klanten/<klant>/<project>), jaar in Europe/Amsterdam, q-query's veilig ge-escaped,
//     de autorisatie-URL (offline, consent, volledige drive-scope), token inwisselen en
//     vernieuwen (invalid_grant → 'opnieuw koppelen'), DriveClient (401 → één keer een vers
//     token, resumable upload met Origin, multipart-upload, pagineren, foutcodes) en de
//     parents-keten (alleen binnen de rootmap);
//   - lib/drive/state.ts: ondertekende state (andere gebruiker, verlopen, geknoei, andere
//     nonce of ander geheim → geweigerd);
//   - versleuteling van het refresh token: AES-256-GCM heen en terug met de Drive-AAD;
//     met de AAD van een mailbox (user-id) of een andere sleutel → onleesbaar;
//   - lib/drive/weergave.ts: grootte, wat inline mag (geen SVG/HTML) en voorbeelden.
//   - statisch: routes via de teamcheck, tokens-tabel alleen server-side, kopieën na het
//     antwoord (after) zonder lib/invoice te wijzigen.
//
// Gebruik:  node scripts/test-drive.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const laad = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href);
const lees = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// TS laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
let kern, state, kluis, weergave;
try {
  kern = await laad("lib", "drive", "kern.ts");
  state = await laad("lib", "drive", "state.ts");
  kluis = await laad("lib", "mail", "kluis-kern.ts");
  weergave = await laad("lib", "drive", "weergave.ts");
} catch (e) {
  if (process.execArgv.includes("--experimental-strip-types")) throw e;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

let goed = 0;
const wacht = [];
function test(naam, fn) {
  wacht.push(
    (async () => {
      try {
        await fn();
        goed++;
      } catch (e) {
        console.log(`  FOUT  ${naam}\n        ${String(e.message).split("\n")[0]}`);
        process.exitCode = 1;
      }
    })(),
  );
}

// ---------------------------------------------------------------------------------
// Nagebootste Google
// ---------------------------------------------------------------------------------
function antwoord(status, body, headers = {}) {
  return new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
/** fetch die per verzoek een handler aanroept en alle verzoeken bijhoudt. */
function nepFetch(handler) {
  const verzoeken = [];
  const f = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    const v = { url: String(url), methode: init.method || "GET", headers, body: init.body };
    verzoeken.push(v);
    return handler(v, verzoeken.length);
  };
  f.verzoeken = verzoeken;
  return f;
}
const tokenFn = () => {
  const calls = [];
  const fn = async (vers) => {
    calls.push(Boolean(vers));
    return vers ? "vers-token" : "oud-token";
  };
  fn.calls = calls;
  return fn;
};

// ---------------------------------------------------------------------------------
// Namen en paden
// ---------------------------------------------------------------------------------
test("schoneNaam: verboden tekens, stuurtekens, punten, lengte", () => {
  assert.equal(kern.schoneNaam("Bakkerij De/Vries: B.V.?"), "Bakkerij De-Vries- B.V.-");
  assert.equal(kern.schoneNaam("  a\u0000b\n c  "), "ab c");
  assert.equal(kern.schoneNaam("..verborgen."), "verborgen");
  assert.equal(kern.schoneNaam("", "Terugval"), "Terugval");
  assert.equal(kern.schoneNaam(null, "X"), "X");
  assert.equal(kern.schoneNaam("x".repeat(300)).length, 120);
  assert.equal(kern.schoneNaam("Café Ünïcode ✓"), "Café Ünïcode ✓");
});

test("jaarVan / dagVan in Europe/Amsterdam", () => {
  assert.equal(kern.jaarVan("2025-12-31T23:30:00Z"), "2026"); // al 1 januari in NL
  assert.equal(kern.jaarVan("2026-03-14"), "2026");
  assert.equal(kern.jaarVan("onzin", new Date("2024-06-01T12:00:00Z")), "2024");
  assert.equal(kern.jaarVan(null, new Date("2023-06-01T12:00:00Z")), "2023");
  assert.equal(kern.dagVan("2025-12-31T23:30:00Z"), "2026-01-01");
  assert.equal(kern.dagVan("2026-03-14"), "2026-03-14");
});

test("mappenpaden", () => {
  assert.deepEqual(kern.boekhoudPad("factuur", "2026"), ["Boekhouding", "Facturen", "2026"]);
  assert.deepEqual(kern.boekhoudPad("prijsopgave", "2025"), ["Boekhouding", "Prijsopgaven", "2025"]);
  assert.deepEqual(kern.boekhoudPad("bonnetje", "2024"), ["Boekhouding", "Bonnetjes", "2024"]);
  assert.deepEqual(kern.boekhoudPad("factuur", "../x"), ["Boekhouding", "Facturen", "Onbekend jaar"]);
  assert.deepEqual(kern.klantPad("Bakkerij / De Vries"), ["Klanten", "Bakkerij - De Vries"]);
  assert.deepEqual(kern.projectPad("Bakkerij", "Huisstijl 2026"), ["Klanten", "Bakkerij", "Huisstijl 2026"]);
  assert.deepEqual(kern.projectPad(null, "Eigen site"), ["Klanten", "Zonder klant", "Eigen site"]);
  assert.deepEqual(kern.projectPad("  ", ""), ["Klanten", "Zonder klant", "Naamloos project"]);
  assert.equal(kern.padSleutel(["Boekhouding", "Facturen", "2026"]), "Boekhouding/Facturen/2026");
  assert.deepEqual([...kern.VASTE_MAPPEN], ["Boekhouding", "Klanten", "Algemeen"]);
  assert.equal(kern.ROOT_NAAM, "Studio Levant");
});

test("bestandsnaam bonnetje", () => {
  assert.equal(kern.bonnetjeNaam("2026-03-14", "IMG_0042.jpg"), "2026-03-14 IMG_0042.jpg");
  assert.equal(kern.bonnetjeNaam("2026-03-14", "2026-03-14 al.pdf"), "2026-03-14 al.pdf");
  assert.equal(kern.bonnetjeNaam("onzin", "a/b.pdf"), "a-b.pdf");
  assert.equal(kern.bonnetjeNaam("2026-03-14", ""), "2026-03-14 bonnetje");
});

test("facturen: zelfde bestandsnaam als de download (lib/invoice/bestandsnaam)", async () => {
  const b = await laad("lib", "invoice", "bestandsnaam.ts");
  assert.equal(b.veiligeBestandsnaam("", "Factuur 2026-007"), "Factuur 2026-007.pdf");
  assert.equal(b.veiligeBestandsnaam("Website: fase 1", "x"), "Website- fase 1.pdf");
  const k = lees("lib/drive/kopieen.ts");
  // Drive-naam = de downloadnaam (veiligeBestandsnaam), met het nummer ervoor als het er niet in staat.
  assert.match(k, /metNummer\(veiligeBestandsnaam\(naam \|\| '', n \? `\$\{terugval\} \$\{n\}` : terugval\), n\)/);
  assert.match(k, /documentNaam\(data\.name, data\.invoice_number, 'Factuur'\)/);
  assert.match(k, /documentNaam\(data\.name, data\.quote_number, 'Prijsopgave'\)/);
  assert.equal(kern.metNummer("Website.pdf", "2026-014"), "2026-014 Website.pdf");
  assert.equal(kern.metNummer("Factuur 2026-014.pdf", "2026-014"), "Factuur 2026-014.pdf"); // staat er al in
  assert.equal(kern.metNummer("2026-014 website.pdf", "2026-014"), "2026-014 website.pdf");
  assert.equal(kern.metNummer("Website.pdf", null), "Website.pdf");
  assert.equal(kern.metNummer("Website.pdf", "a/b"), "a-b Website.pdf"); // veilig voor Drive
});

// ---------------------------------------------------------------------------------
// q-query's
// ---------------------------------------------------------------------------------
test("qTekst escapet ' en \\", () => {
  assert.equal(kern.qTekst("Jan's map"), "'Jan\\'s map'");
  assert.equal(kern.qTekst("a\\b"), "'a\\\\b'");
  assert.equal(kern.qTekst("x' or name contains '"), "'x\\' or name contains \\''");
});
test("qKinderen / qMapMetNaam / qZoeken", () => {
  assert.equal(kern.qKinderen("abcDEF_123-x"), "'abcDEF_123-x' in parents and trashed = false");
  assert.equal(kern.qKinderen("root"), "'root' in parents and trashed = false");
  assert.throws(() => kern.qKinderen("x' or 1=1 or '"));
  assert.match(kern.qMapMetNaam("abcdef", "O'Brien"), /mimeType = 'application\/vnd\.google-apps\.folder' and name = 'O\\'Brien'$/);
  const z = kern.qZoeken("  offerte   '24 ");
  assert.equal(z, "(name contains 'offerte \\'24' or fullText contains 'offerte \\'24') and trashed = false");
  assert.ok(kern.qZoeken("x".repeat(500)).length < 300);
});
test("isDriveId", () => {
  assert.ok(kern.isDriveId("1AbC_d-EfGhIjKlMnOp"));
  for (const v of ["", "abc", "../etc", "a b c d e", "x'y'z12", null, 5, "a".repeat(201)]) assert.ok(!kern.isDriveId(v), String(v));
});

// ---------------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------------
test("autorisatie-URL: offline, consent, volledige drive-scope, state", () => {
  const u = new URL(kern.autorisatieUrl({ clientId: "cid", redirectUri: "http://localhost:3000/api/drive/callback", state: "nonce123" }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/drive");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("state"), "nonce123");
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:3000/api/drive/callback");
  assert.ok(kern.heeftDriveScope("openid https://www.googleapis.com/auth/drive"));
  assert.ok(!kern.heeftDriveScope("https://www.googleapis.com/auth/drive.file"));
});

test("code inwisselen: form-post met secret en redirect-URI", async () => {
  const f = nepFetch(() => antwoord(200, { access_token: "at", refresh_token: "rt", expires_in: 3599, scope: kern.SCOPE }));
  const t = await kern.wisselCode(f, { clientId: "cid", clientSecret: "geheim", code: "c0de", redirectUri: "http://localhost:3000/api/drive/callback" });
  assert.deepEqual(t, { accessToken: "at", refreshToken: "rt", verlooptOver: 3599, scope: kern.SCOPE });
  const v = f.verzoeken[0];
  assert.equal(v.url, "https://oauth2.googleapis.com/token");
  assert.equal(v.methode, "POST");
  const p = new URLSearchParams(v.body);
  assert.equal(p.get("grant_type"), "authorization_code");
  assert.equal(p.get("client_secret"), "geheim");
  assert.equal(p.get("redirect_uri"), "http://localhost:3000/api/drive/callback");
});

test("vernieuwen: invalid_grant → opnieuw koppelen; invalid_client → niet ingericht; netwerk → google", async () => {
  let f = nepFetch(() => antwoord(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }));
  await assert.rejects(kern.vernieuwToken(f, { clientId: "c", clientSecret: "s", refreshToken: "r" }), (e) => e.code === "opnieuw_koppelen" && /opnieuw koppelen/i.test(e.message));
  f = nepFetch(() => antwoord(401, { error: "invalid_client" }));
  await assert.rejects(kern.vernieuwToken(f, { clientId: "c", clientSecret: "s", refreshToken: "r" }), (e) => e.code === "niet_ingericht");
  f = async () => {
    throw new Error("ECONNRESET");
  };
  await assert.rejects(kern.vernieuwToken(f, { clientId: "c", clientSecret: "s", refreshToken: "r" }), (e) => e.code === "google");
  f = nepFetch(() => antwoord(200, { access_token: "nieuw", expires_in: 3600 }));
  assert.deepEqual(await kern.vernieuwToken(f, { clientId: "c", clientSecret: "s", refreshToken: "r" }), { accessToken: "nieuw", verlooptOver: 3600 });
  assert.equal(new URLSearchParams(f.verzoeken[0].body).get("grant_type"), "refresh_token");
});

// ---------------------------------------------------------------------------------
// DriveClient
// ---------------------------------------------------------------------------------
test("401 → één keer opnieuw met een vers token", async () => {
  const tok = tokenFn();
  const f = nepFetch((v, n) => (n === 1 ? antwoord(401, { error: { message: "Invalid Credentials" } }) : antwoord(200, { id: "abcdef", name: "x", mimeType: "text/plain" })));
  const c = new kern.DriveClient(f, tok);
  const b = await c.bestand("abcdef");
  assert.equal(b.id, "abcdef");
  assert.deepEqual(tok.calls, [false, true]);
  assert.equal(f.verzoeken[0].headers.get("authorization"), "Bearer oud-token");
  assert.equal(f.verzoeken[1].headers.get("authorization"), "Bearer vers-token");
});
test("twee keer 401 → opnieuw koppelen (geen eindeloze lus)", async () => {
  const f = nepFetch(() => antwoord(401, {}));
  const c = new kern.DriveClient(f, tokenFn());
  await assert.rejects(c.bestand("abcdef"), (e) => e.code === "opnieuw_koppelen");
  assert.equal(f.verzoeken.length, 2);
});
test("foutcodes: 404, opslag vol, scope, 500", async () => {
  const geval = async (status, body) => {
    const c = new kern.DriveClient(nepFetch(() => antwoord(status, body)), tokenFn());
    try {
      await c.bestand("abcdef");
    } catch (e) {
      return e.code;
    }
  };
  assert.equal(await geval(404, { error: { errors: [{ reason: "notFound" }] } }), "niet_gevonden");
  assert.equal(await geval(403, { error: { errors: [{ reason: "storageQuotaExceeded" }] } }), "vol");
  assert.equal(await geval(403, { error: { errors: [{ reason: "insufficientPermissions" }], message: "Insufficient Permission" } }), "opnieuw_koppelen");
  assert.equal(await geval(500, {}), "google");
  await assert.rejects(async () => new kern.DriveClient(nepFetch(() => antwoord(200, {})), tokenFn()).bestand("../x"), (e) => e.code === "niet_gevonden");
});
test("lijst: pagineert en vraagt alleen niet-weggegooide kinderen", async () => {
  const f = nepFetch((v) => {
    const u = new URL(v.url);
    if (!u.searchParams.get("pageToken")) return antwoord(200, { files: [{ id: "a1aaaa", name: "a" }], nextPageToken: "p2" });
    return antwoord(200, { files: [{ id: "b2bbbb", name: "b" }] });
  });
  const c = new kern.DriveClient(f, tokenFn());
  const r = await c.kinderen("rootid1");
  assert.deepEqual(r.map((x) => x.id), ["a1aaaa", "b2bbbb"]);
  const u = new URL(f.verzoeken[0].url);
  assert.equal(u.searchParams.get("q"), "'rootid1' in parents and trashed = false");
  assert.equal(u.searchParams.get("orderBy"), "folder,name_natural");
  assert.equal(new URL(f.verzoeken[1].url).searchParams.get("pageToken"), "p2");
});
test("zorgVoorMap: bestaande map hergebruiken, anders aanmaken", async () => {
  let f = nepFetch(() => antwoord(200, { files: [{ id: "bestaand1", name: "Facturen", mimeType: kern.MAP_MIME }] }));
  let c = new kern.DriveClient(f, tokenFn());
  assert.equal((await c.zorgVoorMap("ouder01", "Facturen")).id, "bestaand1");
  assert.equal(f.verzoeken.length, 1);
  f = nepFetch((v) => (v.methode === "GET" ? antwoord(200, { files: [] }) : antwoord(200, { id: "nieuw01", name: "2026", mimeType: kern.MAP_MIME })));
  c = new kern.DriveClient(f, tokenFn());
  assert.equal((await c.zorgVoorMap("ouder01", "2026")).id, "nieuw01");
  const post = f.verzoeken[1];
  assert.equal(post.methode, "POST");
  assert.deepEqual(JSON.parse(post.body), { name: "2026", mimeType: kern.MAP_MIME, parents: ["ouder01"] });
});
test("resumable upload-sessie: Origin, type, grootte; alleen een Google-upload-URL", async () => {
  const sessie = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=XYZ";
  let f = nepFetch(() => antwoord(200, "", { location: sessie }));
  let c = new kern.DriveClient(f, tokenFn());
  const url = await c.uploadSessie({ naam: "groot.mov", mime: "video/quicktime", grootte: 734003200, ouderId: "map00001", origin: "http://localhost:3000" });
  assert.equal(url, sessie);
  const v = f.verzoeken[0];
  assert.match(v.url, /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=resumable/);
  assert.equal(v.headers.get("origin"), "http://localhost:3000");
  assert.equal(v.headers.get("x-upload-content-type"), "video/quicktime");
  assert.equal(v.headers.get("x-upload-content-length"), "734003200");
  assert.deepEqual(JSON.parse(v.body), { name: "groot.mov", parents: ["map00001"] });
  f = nepFetch(() => antwoord(200, "", { location: "https://evil.example/upload" }));
  c = new kern.DriveClient(f, tokenFn());
  await assert.rejects(c.uploadSessie({ naam: "x", mime: "a/b", ouderId: "map00001", origin: "http://localhost:3000" }), (e) => e.code === "google");
  f = nepFetch(() => antwoord(403, { error: { errors: [{ reason: "storageQuotaExceeded" }] } }));
  c = new kern.DriveClient(f, tokenFn());
  await assert.rejects(c.uploadSessie({ naam: "x", mime: "a/b", ouderId: "map00001", origin: "http://localhost:3000" }), (e) => e.code === "vol");
});
test("multipart-upload (PDF van een factuur) en inhoud vervangen", async () => {
  const f = nepFetch(() => antwoord(200, { id: "pdf00001", name: "Factuur 1.pdf", mimeType: "application/pdf" }));
  const c = new kern.DriveClient(f, tokenFn());
  const inhoud = new Uint8Array([37, 80, 68, 70, 0, 255]);
  await c.upload({ ouderId: "jaar2026", naam: "Factuur 1.pdf", mime: "application/pdf", inhoud });
  let v = f.verzoeken[0];
  assert.equal(v.methode, "POST");
  assert.match(v.url, /uploadType=multipart/);
  const grens = /boundary=(\S+)/.exec(v.headers.get("content-type"))[1];
  const tekst = Buffer.from(v.body).toString("latin1");
  assert.ok(tekst.includes(JSON.stringify({ name: "Factuur 1.pdf", parents: ["jaar2026"] })));
  assert.ok(tekst.includes(Buffer.from(inhoud).toString("latin1")));
  assert.ok(tekst.trimEnd().endsWith(`--${grens}--`));
  await c.upload({ id: "pdf00001", naam: "Factuur 1.pdf", mime: "application/pdf", inhoud });
  v = f.verzoeken[1];
  assert.equal(v.methode, "PATCH");
  assert.match(v.url, /\/files\/pdf00001\?uploadType=multipart/);
  assert.ok(!Buffer.from(v.body).toString("latin1").includes("parents"));
});
test("wijzig: hernoemen, prullenbak en verplaatsen", async () => {
  const f = nepFetch(() => antwoord(200, { id: "map00001", name: "Nieuw", mimeType: kern.MAP_MIME }));
  const c = new kern.DriveClient(f, tokenFn());
  await c.wijzig("map00001", { trashed: true });
  assert.deepEqual(JSON.parse(f.verzoeken[0].body), { trashed: true });
  await c.wijzig("map00001", { name: "Nieuw" }, { naar: "ouder002", van: ["ouder001"] });
  const u = new URL(f.verzoeken[1].url);
  assert.equal(u.searchParams.get("addParents"), "ouder002");
  assert.equal(u.searchParams.get("removeParents"), "ouder001");
});

// ---------------------------------------------------------------------------------
// Alleen binnen de rootmap
// ---------------------------------------------------------------------------------
function nepDrive(bestanden) {
  return {
    async bestand(id) {
      const b = bestanden[id];
      if (!b) throw new kern.DriveFout("niet_gevonden", "weg");
      return { id, name: id, mimeType: "x", ...b };
    },
  };
}
test("binnenRoot: keten omhoog tot de root, anders null", async () => {
  const d = nepDrive({
    root0001: { parents: ["mijndrive"] },
    klanten1: { parents: ["root0001"] },
    bakker01: { parents: ["klanten1"] },
    offerte1: { parents: ["bakker01"] },
    privee01: { parents: ["mijndrive"] },
    geheim01: { parents: ["privee01"] },
    weg00001: { parents: ["klanten1"], trashed: true },
    inweg001: { parents: ["weg00001"] },
    wees0001: {},
  });
  assert.equal((await kern.binnenRoot(d, "root0001", "offerte1"))?.id, "offerte1");
  assert.equal(await kern.binnenRoot(d, "root0001", "geheim01"), null);
  assert.equal(await kern.binnenRoot(d, "root0001", "privee01"), null);
  assert.equal(await kern.binnenRoot(d, "root0001", "weg00001"), null);
  assert.equal(await kern.binnenRoot(d, "root0001", "inweg001"), null);
  assert.equal(await kern.binnenRoot(d, "root0001", "wees0001"), null);
  assert.equal(await kern.binnenRoot(d, "root0001", "bestaatniet"), null);
  assert.equal(await kern.binnenRoot(d, "root0001", "../../x"), null);
  assert.equal((await kern.binnenRoot(d, "root0001", "root0001"))?.id, "root0001");
  // Bekende map: korter pad, en wat onderweg binnen bleek, wordt onthouden.
  const bekend = new Set();
  await kern.binnenRoot(d, "root0001", "offerte1", bekend);
  assert.ok(bekend.has("bakker01") && bekend.has("klanten1"));
  let n = 0;
  const geteld = { bestand: async (id) => (n++, d.bestand(id)) };
  await kern.binnenRoot(geteld, "root0001", "offerte1", bekend);
  assert.equal(n, 1, "alleen het bestand zelf, de ouder is al bekend");
});
test("binnenRoot: oneindige lus wordt afgekapt", async () => {
  const d = nepDrive({ lusAAAA1: { parents: ["lusBBBB2"] }, lusBBBB2: { parents: ["lusAAAA1"] } });
  assert.equal(await kern.binnenRoot(d, "root0001", "lusAAAA1"), null);
});

// ---------------------------------------------------------------------------------
// State (CSRF)
// ---------------------------------------------------------------------------------
const sleutel = randomBytes(32);
const geheim = state.stateGeheim(sleutel);
const daniel = "11111111-1111-4111-8111-111111111111";
const bram = "22222222-2222-4222-8222-222222222222";
const RU = "http://localhost:3000/api/drive/callback";

test("state: geldig voor dezelfde gebruiker, met de redirect-URI", () => {
  const { state: s, cookie } = state.maakState(geheim, daniel, RU);
  assert.match(s, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!cookie.includes(daniel), "user-id niet leesbaar als platte tekst");
  assert.deepEqual(state.controleerState(geheim, cookie, s, daniel), { ok: true, redirectUri: RU });
});
test("state: andere gebruiker, andere nonce, verlopen, geknoei, ander geheim, ontbrekend", () => {
  const nu = Date.now();
  const { state: s, cookie } = state.maakState(geheim, daniel, RU, nu);
  assert.equal(state.controleerState(geheim, cookie, s, bram).reden, "gebruiker");
  assert.equal(state.controleerState(geheim, cookie, state.maakState(geheim, daniel, RU).state, daniel).reden, "anders");
  assert.equal(state.controleerState(geheim, cookie, s, daniel, nu + 11 * 60 * 1000).reden, "verlopen");
  assert.equal(state.controleerState(state.stateGeheim(randomBytes(32)), cookie, s, daniel).reden, "handtekening");
  const [data, mac] = cookie.split(".");
  const vals = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, "base64url")), u: bram, r: "https://evil.example/cb" })).toString("base64url");
  assert.equal(state.controleerState(geheim, `${vals}.${mac}`, s, bram).reden, "handtekening");
  assert.equal(state.controleerState(geheim, `${data}.${mac.slice(0, -2)}xx`, s, daniel).reden, "handtekening");
  assert.equal(state.controleerState(geheim, "", s, daniel).reden, "ontbreekt");
  assert.equal(state.controleerState(geheim, cookie, "", daniel).reden, "ontbreekt");
  assert.equal(state.controleerState(geheim, "zonderpunt", s, daniel).reden, "handtekening");
  assert.notDeepEqual(geheim, sleutel);
});

// ---------------------------------------------------------------------------------
// Versleuteling van het refresh token
// ---------------------------------------------------------------------------------
test("refresh token: AES-256-GCM heen en terug met de Drive-AAD", () => {
  const config = lees("lib/drive/config.ts");
  const aad = /export const DRIVE_AAD = '([^']+)'/.exec(config)?.[1];
  assert.equal(aad, "drive-koppeling");
  const token = "1//0gAbCdEf-ghijk_lmnop";
  const enc = kluis.versleutelMet(sleutel, token, aad);
  assert.match(enc, /^v1:/);
  assert.ok(!enc.includes(token));
  assert.equal(kluis.ontsleutelMet(sleutel, enc, aad), token);
  assert.throws(() => kluis.ontsleutelMet(sleutel, enc, daniel), "niet als mailbox-wachtwoord bruikbaar");
  assert.throws(() => kluis.ontsleutelMet(randomBytes(32), enc, aad), "andere sleutel");
  assert.notEqual(kluis.versleutelMet(sleutel, token, aad), enc, "elke keer een nieuwe IV");
  // Sleutelkeuze: DRIVE_ENCRYPTION_KEY als die er staat, anders MAIL_ENCRYPTION_KEY.
  assert.match(config, /const eigen = process\.env\.DRIVE_ENCRYPTION_KEY;\s*if \(eigen && eigen\.trim\(\)\) return leesSleutel\(eigen\);\s*return leesSleutel\(process\.env\.MAIL_ENCRYPTION_KEY\);/);
  assert.match(config, /^import 'server-only';/m);
});

// ---------------------------------------------------------------------------------
// Weergave
// ---------------------------------------------------------------------------------
test("weergave: grootte, soort, inline alleen veilig", () => {
  assert.equal(weergave.grootteTekst(null), "—");
  assert.equal(weergave.grootteTekst(512), "512 B");
  assert.equal(weergave.grootteTekst(1536), "1,5 KB");
  assert.equal(weergave.grootteTekst(15 * 1024 ** 3), "15 GB");
  assert.equal(weergave.soortVan(kern.MAP_MIME), "map");
  assert.equal(weergave.soortVan("application/octet-stream", "offerte.PDF"), "pdf");
  assert.equal(weergave.soortVan("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "spreadsheet");
  assert.ok(weergave.veiligInline("image/png") && weergave.veiligInline("application/pdf"));
  for (const m of ["image/svg+xml", "text/html", "application/xhtml+xml", "application/javascript", "text/plain"]) assert.ok(!weergave.veiligInline(m), m);
  assert.ok(weergave.isVoorbeeldbaar("application/vnd.google-apps.document"));
  assert.ok(!weergave.isVoorbeeldbaar("image/svg+xml"));
  assert.equal(weergave.gewijzigdTekst("2026-10-23T10:05:00Z", new Date("2026-10-23T15:00:00Z")), "vandaag 12:05");
  assert.equal(weergave.gewijzigdTekst("2026-10-22T10:05:00Z", new Date("2026-10-23T15:00:00Z")), "gisteren");
});

// ---------------------------------------------------------------------------------
// Statisch: toegang en de factuurflow
// ---------------------------------------------------------------------------------
function routesIn(map) {
  const uit = [];
  (function loop(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) loop(p);
      else if (e.name === "route.ts") uit.push(path.relative(ROOT, p));
    }
  })(path.join(ROOT, map));
  return uit;
}
test("elke /api/drive-route via de centrale teamcheck; eigenaar voor koppelen/ontkoppelen/kopiëren", () => {
  const routes = routesIn("app/api/drive");
  assert.ok(routes.length >= 11, routes.join(","));
  for (const f of routes) assert.match(lees(f), /\b(driveRoute|controleerRoute)\(/, f);
  for (const f of ["app/api/drive/koppelen/route.ts", "app/api/drive/ontkoppelen/route.ts", "app/api/drive/kopieer-bestaande/route.ts"]) {
    assert.match(lees(f), /alleenEigenaar: true/, f);
  }
  const cb = lees("app/api/drive/callback/route.ts");
  assert.match(cb, /lid\.rol !== 'eigenaar'/);
  assert.match(cb, /controleerState\(/);
  assert.match(cb, /versleutelToken\(t\.refreshToken\)/);
  assert.match(lees("lib/drive/api.ts"), /const c = await controleerRoute\(request\);\s*if \('antwoord' in c\) return c\.antwoord;/);
  // Elke route die een bestand/map-id van buiten krijgt, controleert de parents-keten.
  for (const f of ["app/api/drive/bestanden/[id]/route.ts", "app/api/drive/bestanden/[id]/inhoud/route.ts", "app/api/drive/mappen/route.ts", "app/api/drive/upload/klaar/route.ts"]) {
    assert.match(lees(f), /await binnen\(v, /, f);
  }
  assert.match(lees("lib/drive/bestanden.ts"), /await binnen\(v, doel\.map\)/);
  assert.match(lees("lib/drive/bestanden.ts"), /binnenRoot\.push\(await binnen\(v, b\.id\)\)/);
});
test("drive_koppeling alleen via de service-role; nooit tokens naar de browser", () => {
  const m = lees("supabase/migrations/0024_drive.sql");
  assert.match(m, /revoke all on public\.drive_koppeling from anon, authenticated;/);
  assert.ok(!/create policy[^;]*on public\.drive_koppeling/i.test(m));
  const code = [];
  (function loop(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) loop(p);
      else if (/\.tsx?$/.test(e.name)) code.push(p);
    }
  })("components");
  for (const f of code) assert.ok(!/refresh_token|process\.env|drive\/config|drive\/koppeling|drive\/state/.test(lees(f)), f);
  const status = lees("lib/drive/koppeling.ts");
  assert.ok(!/refresh/.test(status.slice(status.indexOf("export async function driveStatus"))), "status zonder token");
});
test("DriveFout: technische oorzaak voor de logs, korte melding voor de gebruiker", async () => {
  const res = new Response(JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }], message: "Rate Limit Exceeded" } }), { status: 403 });
  const f = await kern.DriveClient.fout(res);
  assert.equal(f.code, "google");
  assert.equal(f.message, kern.MELDING.google);
  assert.equal(f.detail, "HTTP 403 rateLimitExceeded: Rate Limit Exceeded");
  assert.equal(kern.foutTekst(f), `google: ${kern.MELDING.google} (HTTP 403 rateLimitExceeded: Rate Limit Exceeded)`);
  const vol = await kern.DriveClient.fout(new Response(JSON.stringify({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }), { status: 403 }));
  assert.equal(vol.code, "vol");
  assert.equal(kern.foutTekst(new Error("x")), "x");
  // Token verversen mislukt (app in "Testing": na 7 dagen invalid_grant) → opnieuw koppelen, met oorzaak.
  const nep = async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 });
  await assert.rejects(
    () => kern.vernieuwToken(nep, { clientId: "c", clientSecret: "s", refreshToken: "r" }),
    (e) => e.code === "opnieuw_koppelen" && /invalid_grant/.test(e.detail) && !/\br\b|"s"/.test(e.detail),
  );
});

test("Test Drive-koppeling en logs met [drive]", () => {
  const d = lees("lib/drive/diagnose.ts");
  for (const pad of ["boekhoudPad('factuur', jaar)", "boekhoudPad('prijsopgave', jaar)", "boekhoudPad('bonnetje', jaar)", "[KLANTEN]", "[ALGEMEEN]"]) assert.ok(d.includes(pad), pad);
  assert.ok(!/upload\(/.test(d), "de diagnose uploadt niets");
  assert.match(lees("app/api/drive/diagnose/route.ts"), /export const POST = driveRoute\([\s\S]*alleenEigenaar: true/);
  const k = lees("lib/drive/kopieen.ts");
  assert.match(k, /console\.error\(`\[drive\] \$\{label\}: MISLUKT/);
  assert.match(k, /console\.info\(`\[drive\] \$\{label\}: gestart`\)/);
});

test("kopieën na het antwoord (after), best effort; lib/invoice ongewijzigd", () => {
  const k = lees("lib/drive/kopieen.ts");
  assert.match(k, /import \{ after \} from 'next\/server';/);
  assert.match(k, /export function naDrive\([^)]*\): void \{\s*try \{/);
  for (const [f, soort] of [
    ["app/api/invoices/route.ts", "factuur"],
    ["app/api/invoices/[id]/route.ts", "factuur"],
    ["app/api/invoices/[id]/restfactuur/route.ts", "factuur"],
    ["app/api/quotes/route.ts", "prijsopgave"],
    ["app/api/quotes/[id]/route.ts", "prijsopgave"],
    ["app/api/uitgaven/[id]/bestanden/route.ts", "bonnetje"],
    ["app/api/uitgaven/uit-mail/route.ts", "bonnetje"],
  ]) {
    const src = lees(f);
    assert.match(src, new RegExp(`naDrive\\(lid, '${soort}', `), f);
    assert.ok(!/await naDrive/.test(src), `${f}: niet wachten op Drive`);
  }
  const diff = spawnSync("git", ["diff", "--name-only", "HEAD", "--", "lib/invoice", "components/InvoiceForm.tsx", "components/InvoicesTable.tsx", "components/QuotesTable.tsx", "app/(app)/facturen"], { cwd: ROOT, encoding: "utf8" });
  if (diff.status === 0) assert.equal(diff.stdout.trim(), "", "facturen-logica gewijzigd");
});

await Promise.all(wacht);
console.log(`\n${goed} geslaagd${process.exitCode ? ", maar er zijn fouten" : ", 0 mislukt"}`);
