// Rooktest voor de gedeelde shell en de toegangscontrole, zonder in te loggen en zonder
// iets te schrijven.
//
// 1. Statisch: de React-rail (components/shell/Rail.tsx + RailNav.tsx) en de HTML-rail
//    voor social (railHtml in lib/shell/rail.ts) gebruiken dezelfde items, classes, links
//    en logo.
// 2. Tegen een draaiende server (`npm run build && npx next start -p 3107`):
//    - elke pagina (automatisch gevonden in app/) stuurt zonder sessie door naar /login;
//    - elke API-route en elk social-bestand weigert (401, of voor de ongewijzigde
//      facturen-API: de redirect naar /login zoals voorheen) — voor elke geëxporteerde methode;
//    - /login en /wachtwoord-vergeten laden, met het echte logo;
//    - logo, shell.css en shell.js zijn openbaar; de social-frontend (app.js/app.css) niet;
//    - uitloggen weigert een ander domein (403) en werkt vanaf het eigen domein (303).
//
// Gebruik:  node scripts/rooktest-shell.mjs [http://localhost:3107]
//           node scripts/rooktest-shell.mjs --alleen-statisch
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const args = process.argv.slice(2);
const ALLEEN_STATISCH = args.includes("--alleen-statisch");
const BASIS = (args.find((a) => /^https?:\/\//.test(a)) || "http://localhost:3107").replace(/\/$/, "");

let fouten = 0;
let goed = 0;
function check(ok, label, detail = "") {
  if (ok) goed++;
  else {
    fouten++;
    console.log(`  FOUT  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

// ---------------------------------------------------------------------------------
// 1. Statische pariteit van de twee rails
// ---------------------------------------------------------------------------------
console.log("Rail: React en HTML gelijk");
{
  const html = lees("lib/shell/rail.ts");
  const react = lees("components/shell/Rail.tsx") + lees("components/shell/RailNav.tsx");
  const klassen = (src, re) => new Set([...src.matchAll(re)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
  const htmlKlassen = klassen(html, /class="([^"$]+)"/g);
  const reactKlassen = klassen(react, /className="([^"]+)"/g);
  const verschil = [...htmlKlassen].filter((k) => !reactKlassen.has(k)).concat([...reactKlassen].filter((k) => !htmlKlassen.has(k)));
  check(verschil.length === 0, "zelfde classes", verschil.join(", "));
  for (const href of ["/", "/nieuw-wachtwoord", "/auth/uitloggen"]) {
    check(html.includes(`"${href}"`) && react.includes(`"${href}"`), `link ${href} in beide rails`);
  }
  check(/railItems\(\)/.test(html) && /railItems\(\)/.test(react), "beide rails lezen railItems() uit lib/modules.ts");
  check(/LOGO_SRC/.test(react) && /export const LOGO_SRC = '\/brand\/beeldmerk-licht\.png'/.test(html), "zelfde logo");
  check(fs.existsSync(path.join(ROOT, "public/brand/beeldmerk-licht.png")), "public/brand/beeldmerk-licht.png bestaat");
  check(/railHtml\(/.test(lees("app/social/route.ts")), "social krijgt railHtml()");
  check(/<Rail\b/.test(lees("app/(app)/layout.tsx")), "app/(app)/layout.tsx rendert <Rail>");
}

if (ALLEEN_STATISCH) eindig();

// ---------------------------------------------------------------------------------
// 2. Routes zoeken in app/
// ---------------------------------------------------------------------------------
const DUMMY = {
  id: "00000000-0000-0000-0000-000000000000",
  clientId: "00000000-0000-0000-0000-000000000000",
  file: "rooktest.html",
  uid: "1",
  deel: "1",
};
function routesIn(map) {
  const uit = [];
  (function loop(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) loop(p);
      else if (e.name === "page.tsx" || e.name === "route.ts") uit.push(p);
    }
  })(path.join(ROOT, map));
  return uit.map((bestand) => {
    const rel = path.relative(path.join(ROOT, "app"), path.dirname(bestand));
    const url =
      "/" +
      rel
        .split(path.sep)
        .filter((s) => s && !/^\(.*\)$/.test(s))
        .map((s) => s.replace(/^\[(.+)\]$/, (_m, n) => DUMMY[n] ?? "x"))
        .join("/");
    const src = fs.readFileSync(bestand, "utf8");
    const methoden = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
    return { bestand: path.relative(ROOT, bestand), url: url === "/" ? "/" : url.replace(/\/$/, ""), pagina: bestand.endsWith("page.tsx"), methoden };
  });
}
const alles = routesIn("app");
const PUBLIEK = new Set(["/login", "/wachtwoord-vergeten", "/auth/callback", "/auth/uitloggen"]);

async function vraag(url, init = {}) {
  return fetch(BASIS + url, { redirect: "manual", ...init });
}
const naarLogin = (r) => r.status >= 300 && r.status < 400 && new URL(r.headers.get("location") || "/", BASIS).pathname === "/login";

try {
  await fetch(BASIS + "/login", { redirect: "manual" });
} catch {
  console.log(`\nGeen server op ${BASIS}. Start eerst: npm run build && npx next start -p 3107`);
  process.exit(2);
}

console.log(`\nPagina's zonder sessie -> /login  (${BASIS})`);
for (const r of alles.filter((r) => (r.pagina || r.url === "/social") && !PUBLIEK.has(r.url))) {
  const res = await vraag(r.url);
  check(naarLogin(res), `${r.url}`, `status ${res.status} ${res.headers.get("location") || ""}`);
}
{
  const res = await vraag("/social/index.html");
  check(res.status >= 300 && res.status < 400, "/social/index.html stuurt door", `status ${res.status}`);
}

console.log("API's en bestanden zonder sessie -> geweigerd");
let viaRedirect = [];
for (const r of alles.filter((r) => !r.pagina && !PUBLIEK.has(r.url) && r.url !== "/social")) {
  for (const m of r.methoden) {
    const init = { method: m, headers: { origin: BASIS } };
    if (m !== "GET" && m !== "DELETE") {
      init.headers["content-type"] = "application/json";
      init.body = "{}";
    }
    const res = await vraag(r.url, init);
    const ok = res.status === 401 || naarLogin(res);
    if (ok && res.status !== 401) viaRedirect.push(`${m} ${r.url}`);
    check(ok, `${m} ${r.url}`, `status ${res.status}`);
    // Ook als het bestand een afbeelding lijkt (buiten de proxy-matcher) moet de route zelf weigeren.
  }
}
for (const url of ["/social-files/brand/logo-licht.png", "/social-files/projects/x/assets/foto.png"]) {
  const res = await vraag(url);
  check(res.status === 401 || naarLogin(res), `GET ${url} (buiten proxy-matcher)`, `status ${res.status}`);
}
if (viaRedirect.length) console.log(`  (via redirect naar /login, zoals de facturen-API altijd deed: ${viaRedirect.length} aanroepen)`);

console.log("Openbare pagina's en bestanden");
for (const url of ["/login", "/wachtwoord-vergeten"]) {
  const res = await vraag(url);
  const tekst = res.status === 200 ? await res.text() : "";
  check(res.status === 200, `${url} laadt`, `status ${res.status}`);
  check(/\/brand\/banner-licht\.png/.test(tekst), `${url} toont het Studio Levant-logo`);
  check(!/sl-rail"/.test(tekst), `${url} heeft geen rail`);
}
for (const url of ["/brand/beeldmerk-licht.png", "/brand/banner-licht.png", "/shell/shell.css", "/shell/shell.js", "/icon.png"]) {
  const res = await vraag(url);
  check(res.status === 200, `${url} openbaar`, `status ${res.status}`);
}
// De social-frontend zelf blijft achter de login.
for (const url of ["/social/app.js", "/social/app.css"]) {
  const res = await vraag(url);
  check(naarLogin(res), `${url} achter login`, `status ${res.status}`);
}

console.log("Uitloggen");
{
  const vreemd = await vraag("/auth/uitloggen", { method: "POST", headers: { origin: "https://evil.example" } });
  check(vreemd.status === 403, "ander domein -> 403", `status ${vreemd.status}`);
  const eigen = await vraag("/auth/uitloggen", { method: "POST", headers: { origin: BASIS } });
  check(eigen.status === 303 && naarLogin(eigen), "eigen domein -> 303 /login", `status ${eigen.status}`);
}

eindig();

function eindig() {
  console.log(`\n${goed} geslaagd, ${fouten} mislukt`);
  process.exit(fouten ? 1 : 0);
}
