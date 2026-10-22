// Tests voor de losse stukken van de teamtoegang, zonder database en zonder netwerk:
//   - lib/auth/herkomst.ts: welke wijzigende verzoeken komen door de CSRF-controle;
//   - lib/auth/site.ts: de basis-URL voor mails komt nooit uit een willekeurige Host/Origin;
//   - scripts/teamlid-*.mjs: --help en het weigeren van ongeldige invoer (zonder sleutels).
//
// Gebruik:  node scripts/test-team.mjs
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// TS laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
let herkomst, site;
try {
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
