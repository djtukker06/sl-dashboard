// Rooktest voor de gedeelde shell en de toegangscontrole, zonder in te loggen en zonder
// iets te schrijven.
//
// 1. Statisch: de React-rail (components/shell/Rail.tsx + RailNav.tsx) en de HTML-rail
//    voor social (railHtml in lib/shell/rail.ts) gebruiken dezelfde items, classes, links
//    en logo.
// 2. Statisch: de teamtoegang (lib/auth/team.ts) zit overal vóór:
//    - elke API-route gebruikt de helper of een wrapper die hem aanroept;
//    - elke pagina in app/(app) begint met vereisTeamlidPagina();
//    - createServiceRoleClient() krijgt altijd een bewijs; nergens signUp( of getClaims;
//    - migratie 0021 maakt geen open policy ("auth.uid() is not null") en elk SQL-Editor-
//      bestand eindigt met 0021; de proxy-matcher heeft geen algemene .png/.jpg-uitzondering.
// 3. Tegen een draaiende server (`npm run build && npx next start -p 3107`):
//    - elke pagina (automatisch gevonden in app/) stuurt zonder sessie door naar /login;
//    - elke API-route en elk social-bestand weigert met een JSON-401 — voor elke
//      geëxporteerde methode, ook paden die op .png eindigen;
//    - /login, /wachtwoord-vergeten en /geen-toegang laden, met het echte logo en zonder rail;
//    - logo, shell.css en shell.js zijn openbaar; de social-frontend (app.js/app.css) niet;
//    - beveiligingskoppen (X-Frame-Options, Referrer-Policy, nosniff) staan op elk antwoord;
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

// ---------------------------------------------------------------------------------
// 2. Teamtoegang (statisch)
// ---------------------------------------------------------------------------------
console.log("Teamtoegang: overal de centrale controle");
function bestandenIn(map, filter) {
  const uit = [];
  (function loop(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) loop(p);
      else if (filter(e.name)) uit.push(path.relative(ROOT, p));
    }
  })(path.join(ROOT, map));
  return uit;
}
{
  const WRAPPERS = /\b(teamlidRoute|controleerRoute|metSessie|mailRoute|uitgavenRoute|route)\(/;
  for (const f of bestandenIn("app/api", (n) => n === "route.ts")) {
    check(WRAPPERS.test(lees(f)), `${f} gebruikt de teamlidcontrole`);
  }
  for (const f of bestandenIn("app/social-files", (n) => n === "route.ts")) {
    check(/\broute\(/.test(lees(f)), `${f} gebruikt route() (teamlidcontrole)`);
  }
  for (const f of bestandenIn("app/(app)", (n) => n === "page.tsx")) {
    check(/vereisTeamlidPagina\(/.test(lees(f)), `${f} begint met vereisTeamlidPagina()`);
  }
  check(/vereisTeamlidPagina\(/.test(lees("app/(app)/layout.tsx")), "app/(app)/layout.tsx controleert het lidmaatschap");
  check(/huidigTeamlid\(/.test(lees("app/social/route.ts")), "/social controleert het lidmaatschap");
  for (const f of ["app/actions/invoices.ts", "app/actions/quotes.ts", "app/actions/clients.ts"]) {
    check(/vereisTeamlid\(/.test(lees(f)), `${f} controleert het lidmaatschap`);
  }
  check(/controleerLid\(/.test(lees("app/actions/login.ts")), "inloggen controleert het lidmaatschap");
  check(/controleerLid\(/.test(lees("app/auth/callback/route.ts")), "/auth/callback controleert het lidmaatschap");
  check(/veiligVervolg\(/.test(lees("app/auth/callback/route.ts")), "/auth/callback gebruikt veiligVervolg");
  check(!/x-forwarded-host|h\.get\('host'\)/.test(lees("app/actions/wachtwoord.ts")), "herstellink niet uit de Host-kop");

  const code = [...bestandenIn("app", (n) => /\.tsx?$/.test(n)), ...bestandenIn("lib", (n) => /\.tsx?$/.test(n)), ...bestandenIn("components", (n) => /\.tsx?$/.test(n)), "proxy.ts"];
  const zonderBewijs = [];
  const signUp = [];
  const claims = [];
  for (const f of code) {
    const src = lees(f);
    if (/createServiceRoleClient\(\s*\)/.test(src)) zonderBewijs.push(f);
    if (/\bsignUp\(/.test(src)) signUp.push(f);
    if (/\bgetClaims\(/.test(src)) claims.push(f);
  }
  check(zonderBewijs.length === 0, "createServiceRoleClient() altijd met bewijs", zonderBewijs.join(", "));
  check(signUp.length === 0, "nergens signUp( (geen registratie in de app)", signUp.join(", "));
  check(claims.length === 0, "nergens alleen getClaims() als toegangscontrole", claims.join(", "));
  check(/^import 'server-only';/m.test(lees("lib/supabase/service-role.ts")), "service-role.ts is server-only");
  check(/^import 'server-only';/m.test(lees("lib/auth/team.ts")), "lib/auth/team.ts is server-only");
  check(/createServiceRoleClient\(bewijs: TeamlidBewijs\)/.test(lees("lib/supabase/service-role.ts")), "service-role vraagt een TeamlidBewijs");
  check(fs.existsSync(path.join(ROOT, "app/geen-toegang/page.tsx")), "app/geen-toegang/page.tsx bestaat (buiten de shell)");

  const proxy = lees("proxy.ts");
  check(/'\/geen-toegang'/.test(proxy), "proxy kent /geen-toegang");
  check(/controleerLid\(/.test(proxy) && /signOut\(/.test(proxy), "proxy logt niet-teamleden uit");
  check(!/svg\|png\|jpg/.test(proxy), "proxy-matcher zonder algemene beeld-uitzondering");

  const m21 = lees("supabase/migrations/0021_team_en_taken.sql").replace(/--[^\n]*/g, ""); // zonder commentaar
  check(!/auth\.uid\(\)\)?\s+is not null/i.test(m21), "0021 maakt geen policy 'auth.uid() is not null'");
  check(/create or replace function public\.is_teamlid\(\)/.test(m21), "0021 definieert is_teamlid()");
  check(/revoke all on function %s from public, anon, authenticated/.test(m21), "0021 sluit create_invoice/update_invoice af");
  check(/revoke all on all tables in schema public from anon/.test(m21), "0021 ontneemt anon alle rechten");
  for (const f of ["UITVOEREN_IN_SQL_EDITOR.sql", "UITVOEREN_0020_UITGAVEN.sql", "UITVOEREN_0021_TEAM.sql"]) {
    const sql = lees(`supabase/${f}`);
    const laatste = [...sql.matchAll(/^-- (\d{4}_[\w]+\.sql)$/gm)].pop()?.[1];
    check(laatste === "0021_team_en_taken.sql", `${f} eindigt met 0021`, laatste || "geen");
  }

  const headers = lees("next.config.ts");
  for (const k of ["X-Frame-Options", "Referrer-Policy", "X-Content-Type-Options", "Permissions-Policy"]) {
    check(headers.includes(`'${k}'`), `next.config.ts zet ${k}`);
  }
}

if (ALLEEN_STATISCH) eindig();

// ---------------------------------------------------------------------------------
// 3. Routes zoeken in app/
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
const PUBLIEK = new Set(["/login", "/wachtwoord-vergeten", "/auth/callback", "/auth/uitloggen", "/geen-toegang"]);

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

console.log("API's en bestanden zonder sessie -> JSON-401");
for (const r of alles.filter((r) => !r.pagina && !PUBLIEK.has(r.url) && r.url !== "/social")) {
  for (const m of r.methoden) {
    const init = { method: m, headers: { origin: BASIS } };
    if (m !== "GET" && m !== "DELETE") {
      init.headers["content-type"] = "application/json";
      init.body = "{}";
    }
    const res = await vraag(r.url, init);
    const type = res.headers.get("content-type") || "";
    check(res.status === 401 && type.includes("application/json"), `${m} ${r.url}`, `status ${res.status} ${type}`);
  }
}
// Paden die op een afbeelding eindigen gaan ook door de proxy (en de route weigert zelf).
for (const url of ["/social-files/brand/logo-licht.png", "/social-files/projects/x/assets/foto.png", "/api/taken/x.png", "/api/invoices/x.jpg/pdf"]) {
  const res = await vraag(url);
  check(res.status === 401, `GET ${url} (eindigt op een beeldextensie)`, `status ${res.status}`);
}
{
  // Een POST van een ander domein zonder sessie: ook 401 (eerst de sessie, dan de herkomst).
  const res = await vraag("/api/taken", { method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" }, body: "{}" });
  check(res.status === 401, "cross-site POST zonder sessie -> 401", `status ${res.status}`);
}

console.log("Openbare pagina's en bestanden");
for (const url of ["/login", "/wachtwoord-vergeten", "/geen-toegang"]) {
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

console.log("Beveiligingskoppen");
for (const url of ["/login", "/geen-toegang", "/api/taken"]) {
  const res = await vraag(url);
  check(res.headers.get("x-frame-options") === "SAMEORIGIN", `${url}: X-Frame-Options`, res.headers.get("x-frame-options") || "ontbreekt");
  check(res.headers.get("referrer-policy") === "same-origin", `${url}: Referrer-Policy`, res.headers.get("referrer-policy") || "ontbreekt");
  check(res.headers.get("x-content-type-options") === "nosniff", `${url}: nosniff`);
}
{
  const res = await vraag("/geen-toegang");
  const tekst = res.status === 200 ? await res.text() : "";
  check(/Geen toegang/.test(tekst) && /href="\/login"/.test(tekst), "/geen-toegang toont uitleg en link naar /login");
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
