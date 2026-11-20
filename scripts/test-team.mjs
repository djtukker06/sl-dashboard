// Tests voor de losse stukken van de teamtoegang, zonder database en zonder netwerk:
//   - lib/auth/herkomst.ts: welke wijzigende verzoeken komen door de CSRF-controle;
//   - lib/auth/site.ts: de basis-URL voor mails komt nooit uit een willekeurige Host/Origin;
//   - lib/team/foto.ts: profielfoto's (0039): echt beeldformaat uit de bytes, grootte, pad
//     alleen in je eigen map, versie in de URL;
//   - scripts/teamlid-*.mjs: --help en het weigeren van ongeldige invoer (zonder sleutels).
//
// Gebruik:  node scripts/test-team.mjs
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// TS laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
let herkomst, site, foto;
try {
  foto = await import(pathToFileURL(path.join(ROOT, "lib", "team", "foto.ts")).href);
  herkomst = await import(pathToFileURL(path.join(ROOT, "lib", "auth", "herkomst.ts")).href);
  site = await import(pathToFileURL(path.join(ROOT, "lib", "auth", "site.ts")).href);
} catch (e) {
  if (process.execArgv.includes("--experimental-strip-types")) throw e;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

let goed = 0;
function test(naam, fn) {
  try {
    fn();
    goed++;
  } catch (e) {
    console.log(`  FOUT  ${naam}\n        ${e.message.split("\n")[0]}`);
    process.exitCode = 1;
  }
}

const req = (method, headers = {}, url = "https://backoffice.studio-levant.nl/api/taken") =>
  new Request(url, { method, headers });

console.log("Herkomst (CSRF)");
test("GET is niet wijzigend", () => assert.equal(herkomst.isWijzigend("GET"), false));
test("POST/PATCH/DELETE zijn wijzigend", () => {
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(herkomst.isWijzigend(m), true);
});
test("eigen origin mag", () => assert.equal(herkomst.eigenHerkomst(req("POST", { origin: "https://backoffice.studio-levant.nl" })), true));
test("ander domein mag niet", () => assert.equal(herkomst.eigenHerkomst(req("POST", { origin: "https://evil.example" })), false));
test("origin 'null' mag niet", () => assert.equal(herkomst.eigenHerkomst(req("POST", { origin: "null" })), false));
test("Sec-Fetch-Site cross-site mag niet", () =>
  assert.equal(herkomst.eigenHerkomst(req("POST", { "sec-fetch-site": "cross-site" })), false));
test("achter een proxy: origin = host-kop mag", () =>
  assert.equal(
    herkomst.eigenHerkomst(req("POST", { origin: "https://app.example.nl", host: "app.example.nl" }, "http://intern:3000/api/x")),
    true,
  ));
test("zonder Origin (geen browser) mag", () => assert.equal(herkomst.eigenHerkomst(req("POST")), true));

console.log("Profielfoto's");
{
  const bytes = (...b) => new Uint8Array(b);
  const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
  const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
  const WEBP = new Uint8Array([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBPVP8 "].map((c) => c.charCodeAt(0))));
  const U = "0b6f3c1e-1234-4abc-9def-0123456789ab";
  const ANDER = "11111111-2222-4333-8444-555555555555";
  test("herkent jpg, png en webp aan de bytes", () => {
    assert.equal(foto.fotoSoort(JPG), "image/jpeg");
    assert.equal(foto.fotoSoort(PNG), "image/png");
    assert.equal(foto.fotoSoort(WEBP), "image/webp");
  });
  test("weigert svg/html/gif en lege of te korte bestanden", () => {
    const tekst = (s) => new TextEncoder().encode(s);
    assert.equal(foto.fotoSoort(tekst("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
    assert.equal(foto.fotoSoort(tekst("<html><script>alert(1)</script>")), null);
    assert.equal(foto.fotoSoort(tekst("GIF89a")), null);
    assert.equal(foto.fotoSoort(bytes(0xff, 0xd8)), null);
    assert.equal(foto.valideerFoto(new Uint8Array(0)).ok, false);
    // RIFF maar geen WEBP (bv. een WAV)
    const wav = new Uint8Array([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WAVE"].map((c) => c.charCodeAt(0))));
    assert.equal(foto.fotoSoort(wav), null);
  });
  test("maximaal 2 MB", () => {
    const groot = new Uint8Array(foto.FOTO_MAX_BYTES + 1);
    groot.set(JPG);
    assert.equal(foto.valideerFoto(groot).ok, false);
    const precies = new Uint8Array(foto.FOTO_MAX_BYTES);
    precies.set(JPG);
    assert.deepEqual(foto.valideerFoto(precies), { ok: true, soort: "image/jpeg" });
  });
  test("nieuw pad: eigen map, tijdstempel, extensie bij het formaat", () => {
    assert.equal(foto.nieuwFotoPad(U, "image/webp", 1763600000000), `${U}/1763600000000.webp`);
    assert.equal(foto.nieuwFotoPad(U.toUpperCase(), "image/jpeg", 1763600000000), `${U}/1763600000000.jpg`);
    assert.equal(foto.nieuwFotoPad(U, "image/png", 1763600000000), `${U}/1763600000000.png`);
  });
  test("pad hoort alleen bij de eigen gebruiker en de eigen vorm", () => {
    const pad = foto.nieuwFotoPad(U, "image/webp", 1763600000000);
    assert.equal(foto.fotoPadVan(pad, U), true);
    assert.equal(foto.fotoPadVan(pad, ANDER), false);
    for (const slecht of [null, "", `${U}/../${ANDER}/1763600000000.webp`, `${U}/1763600000000.svg`, `${U}/x.webp`, `/${U}/1763600000000.webp`, `${U}/1763600000000.webp?x`]) {
      assert.equal(foto.fotoPadVan(slecht, U), false, String(slecht));
    }
  });
  test("URL met versie, of null zonder geldige foto", () => {
    const pad = foto.nieuwFotoPad(U, "image/jpeg", 1763600000000);
    assert.equal(foto.fotoVersie(pad), "1763600000000");
    assert.equal(foto.fotoUrl(U, pad), `/api/team/foto/${U}?v=1763600000000`);
    assert.equal(foto.fotoUrl(U, null), null);
    assert.equal(foto.fotoUrl(ANDER, pad), null);
  });
}

console.log("Basis-URL voor mails");
const bewaar = { ...process.env };
function metEnv(env, fn) {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  Object.assign(process.env, env);
  try {
    fn();
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = bewaar.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = bewaar.VERCEL_PROJECT_PRODUCTION_URL;
    if (bewaar.NEXT_PUBLIC_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    if (bewaar.VERCEL_PROJECT_PRODUCTION_URL === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  }
}
test("NEXT_PUBLIC_SITE_URL wint altijd", () =>
  metEnv({ NEXT_PUBLIC_SITE_URL: "https://backoffice.studio-levant.nl/" }, () =>
    assert.equal(site.siteUrl("https://evil.example"), "https://backoffice.studio-levant.nl"),
  ));
test("vreemde Origin zonder instelling: null", () => metEnv({}, () => assert.equal(site.siteUrl("https://evil.example"), null)));
test("localhost:3000 mag zonder instelling", () =>
  metEnv({}, () => assert.equal(site.siteUrl("http://localhost:3000"), "http://localhost:3000")));
test("Vercel-productie-URL mag", () =>
  metEnv({ VERCEL_PROJECT_PRODUCTION_URL: "studio-levant.vercel.app" }, () =>
    assert.equal(site.siteUrl("https://studio-levant.vercel.app"), "https://studio-levant.vercel.app"),
  ));
test("preview-URL van Vercel mag niet", () =>
  metEnv({ VERCEL_PROJECT_PRODUCTION_URL: "studio-levant.vercel.app" }, () =>
    assert.equal(site.siteUrl("https://studio-levant-git-x.vercel.app"), null),
  ));
test("http (niet-localhost) telt niet", () =>
  metEnv({ NEXT_PUBLIC_SITE_URL: "http://backoffice.studio-levant.nl" }, () => assert.equal(site.siteUrl(null), null)));

console.log("Scripts teambeheer (zonder sleutels, niets uitvoeren)");
const zonderSleutels = { ...process.env };
delete zonderSleutels.SUPABASE_SERVICE_ROLE_KEY;
delete zonderSleutels.NEXT_PUBLIC_SUPABASE_URL;
const draai = (script, args) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { env: zonderSleutels, encoding: "utf8" });
test("toevoegen --help", () => {
  const r = draai("teamlid-toevoegen.mjs", ["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--email/);
  assert.match(r.stdout, /--bestaand-account-vertrouwen/);
  assert.match(r.stdout, /geen toegang tot de standaard-mailbox/);
});
test("toevoegen kent --bestaand-account-vertrouwen (dry-run)", () => {
  const r = draai("teamlid-toevoegen.mjs", ["--email", "a@b.nl", "--naam", "X", "--bestaand-account-vertrouwen", "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
});
test("verwijderen --help", () => {
  const r = draai("teamlid-verwijderen.mjs", ["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--definitief/);
});
test("toevoegen weigert een ongeldig adres", () => assert.equal(draai("teamlid-toevoegen.mjs", ["--email", "geen-adres", "--naam", "X"]).status, 1));
test("toevoegen weigert een ongeldige kleur", () =>
  assert.equal(draai("teamlid-toevoegen.mjs", ["--email", "a@b.nl", "--naam", "X", "--kleur", "rood"]).status, 1));
test("toevoegen zonder sleutels (geen dry-run) stopt", () => {
  const r = draai("teamlid-toevoegen.mjs", ["--email", "a@b.nl", "--naam", "X"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ontbreken in de omgeving/);
});
test("toevoegen --dry-run zonder sleutels toont alleen het plan", () => {
  const r = draai("teamlid-toevoegen.mjs", ["--email", "a@b.nl", "--naam", "Mark de Vries", "--dry-run"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[dry-run\]/);
});
test("definitief verwijderen vraagt --ja", () =>
  assert.equal(draai("teamlid-verwijderen.mjs", ["--email", "a@b.nl", "--definitief"]).status, 1));

console.log(`\n${goed} geslaagd${process.exitCode ? ", met fouten" : ", 0 mislukt"}`);
