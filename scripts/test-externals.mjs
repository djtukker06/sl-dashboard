// Controle op "Failed to load external module … ERR_REQUIRE_ESM" (Vercel, mail):
//
//   1. Elk pakket in serverExternalPackages (next.config.ts) moet te laden zijn ZONDER
//      require(esm) (node --no-experimental-require-module), op de manier waarop Turbopack
//      het laadt: import() als het pakket een "import"-ingang heeft of ESM is (imapflow,
//      mailparser, nodemailer, puppeteer-core, chromium), anders require().
//      sanitize-html 2.18 faalt hier (CJS die htmlparser2 12, alleen ESM, require't) en mag
//      dus niet external zijn: Turbopack bundelt hem.
//   2. sanitize-html zelf faalt zonder require(esm): bewijst dat de controle het probleem ziet.
//   1b. libheif-js (HEIC → JPEG voor bonnetjes): de subpath wasm-bundle.js laadt met require()
//      en decodeert (op macOS, via sips) echt een HEIC.
//   3. Na `npm run build`: de gebouwde mail- en uitgaven-routes laden zonder require(esm)
//      (zoals de server ze laadt), inclusief async modules met ESM-externals.
//
// Gebruik: node scripts/test-externals.mjs          (stap 3 alleen als .next/server bestaat)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let geslaagd = 0;
const fouten = [];
const ok = (naam) => (geslaagd++, console.log(`  ok    ${naam}`));
const mis = (naam, waarom) => (fouten.push(`${naam}: ${waarom}`), console.log(`  FOUT  ${naam}: ${waarom}`));

function zonderRequireEsm(code) {
  return spawnSync(process.execPath, ["--no-experimental-require-module", "-e", code], { cwd: ROOT, encoding: "utf8" });
}

// ---------- 1. serverExternalPackages
const config = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
const lijst = config.match(/serverExternalPackages:\s*\[([^\]]*)\]/);
const externals = lijst ? [...lijst[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]) : [];
if (!externals.length) mis("serverExternalPackages", "niet gevonden in next.config.ts");
if (externals.includes("sanitize-html")) mis("sanitize-html", "staat in serverExternalPackages; moet gebundeld worden");
else ok("sanitize-html staat niet in serverExternalPackages (wordt gebundeld)");

/**
 * Hoe Turbopack een external laadt: met import() als het pakket een "import"-ingang heeft
 * of zelf ESM is (zie e.y("…") in .next/server/chunks), anders met require() (e.x).
 */
function laadwijze(pkg) {
  const pj = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", pkg, "package.json"), "utf8"));
  const punt = pj.exports?.["."] ?? pj.exports;
  const heeftImport = typeof punt === "object" && punt !== null && Boolean(punt.import || punt.node?.import);
  return heeftImport || pj.type === "module" ? "import" : "require";
}
function laadt(pkg, wijze) {
  const r =
    wijze === "import"
      ? spawnSync(process.execPath, ["--no-experimental-require-module", "--input-type=module", "-e", `await import(${JSON.stringify(pkg)})`], { cwd: ROOT, encoding: "utf8" })
      : zonderRequireEsm(`require(${JSON.stringify(pkg)})`);
  return r.status === 0 ? null : (r.stderr.match(/Error \[[A-Z_]+\][^\n]*/) ?? [r.stderr.split("\n")[0]])[0].slice(0, 200);
}

for (const pkg of externals) {
  const wijze = laadwijze(pkg);
  const f = laadt(pkg, wijze);
  if (!f) ok(`${pkg}: laadt met ${wijze}() zonder require(esm)`);
  else mis(pkg, `${wijze}(): ${f}`);
}
// libheif-js: lib/uitgaven/beeld.ts laadt de subpath wasm-bundle.js (wasm als base64 in de .js).
// Laden zonder require(esm) en (op macOS, met sips) echt een HEIC decoderen.
{
  const os = await import("node:os");
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "heic-"));
  const heic = path.join(map, "t.heic");
  const bmp = path.join(map, "t.bmp");
  // 1×1 BMP (24-bit) als bron voor sips; zonder sips alleen het laden controleren.
  const bmpKop = Buffer.from("424d3a0000000000000036000000280000000100000001000000010018000000000004000000130b0000130b00000000000000000000", "hex");
  fs.writeFileSync(bmp, Buffer.concat([bmpKop, Buffer.from([0x20, 0x40, 0xc0, 0])]));
  const metHeic = spawnSync("sips", ["-s", "format", "heic", bmp, "--out", heic], { encoding: "utf8" }).status === 0 && fs.existsSync(heic);
  const r = zonderRequireEsm(`
    const lib = require('libheif-js/wasm-bundle.js');
    if (typeof lib.HeifDecoder !== 'function') { console.error('geen HeifDecoder'); process.exit(1); }
    const pad = ${JSON.stringify(metHeic ? heic : "")};
    if (pad) {
      const b = new lib.HeifDecoder().decode(require('fs').readFileSync(pad));
      if (!b.length) { console.error('HEIC niet gedecodeerd'); process.exit(1); }
      const w = b[0].get_width(), h = b[0].get_height();
      b[0].display({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }, (r) => process.exit(r ? 0 : 1));
    }`);
  fs.rmSync(map, { recursive: true, force: true });
  if (r.status === 0) ok(`libheif-js/wasm-bundle.js laadt met require() zonder require(esm)${metHeic ? " en decodeert een HEIC" : " (HEIC-decodering overgeslagen: geen sips)"}`);
  else mis("libheif-js/wasm-bundle.js", (r.stderr || "").trim().split("\n").slice(-1)[0] || `exit ${r.status}`);
}

// mailparser leest HTML-mail via html-to-text: één keer echt parsen.
{
  const r = zonderRequireEsm(
    "require('mailparser').simpleParser('From: a@b.nl\\r\\nContent-Type: text/html\\r\\n\\r\\n<p>Hoi <b>daar</b></p>').then(m=>{if(!/Hoi/.test(m.text))process.exit(2)})",
  );
  if (r.status === 0) ok("mailparser parst een HTML-mail zonder require(esm)");
  else mis("mailparser", r.stderr.split("\n").find((l) => /Error/.test(l)) ?? `exit ${r.status}`);
}

// ---------- 2. de controle ziet het oorspronkelijke probleem
{
  const wijze = laadwijze("sanitize-html");
  const f = laadt("sanitize-html", wijze);
  if (wijze === "require" && f && /ERR_REQUIRE_ESM/.test(f)) ok("sanitize-html als external zou falen met ERR_REQUIRE_ESM (zoals op Vercel)");
  else mis("negatieve controle", `sanitize-html laadt als external met ${wijze}() zonder fout; is de versie veranderd?`);
}

// ---------- 2b. lib/mail/saneren.ts werkt (bronbestand; hier mét require(esm), want ongebundeld
//      require't sanitize-html htmlparser2 — precies wat de bundel in stap 3 oplost)
{
  const url = pathToFileURL(path.join(ROOT, "lib", "mail", "saneren.ts")).href;
  const code = `
    const { saneerMailHtml } = await import(${JSON.stringify(url)});
    const r = saneerMailHtml('<p onclick="x()">Hoi<script>alert(1)</script><img src="https://evil.example/p.png"><a href="javascript:alert(1)">x</a><style>p{color:red}</style></p>');
    const fout = [];
    if (/script|onclick|javascript:/i.test(r.html)) fout.push('gevaarlijke inhoud niet verwijderd');
    if (!/data-extern-src/.test(r.html) || /\ssrc="https:/.test(r.html)) fout.push('externe afbeelding niet geblokkeerd');
    if (r.externeBeelden !== 1) fout.push('externeBeelden = ' + r.externeBeelden);
    if (!/Hoi/.test(r.html) || !/<style>/.test(r.html)) fout.push('inhoud/stijl kwijt');
    if (fout.length) { console.error(fout.join('; ')); process.exit(1); }`;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8" });
  if (r.status === 0) ok("lib/mail/saneren.ts: script/on*/javascript: weg, externe afbeelding geblokkeerd, style blijft");
  else mis("saneren", (r.stderr || r.stdout).trim().split("\n").slice(-1)[0]);
}

// ---------- 3. gebouwde routes
const SERVER = path.join(ROOT, ".next", "server", "app");
if (!fs.existsSync(SERVER)) {
  console.log("  (stap 3 overgeslagen: eerst npm run build)");
} else {
  const routes = ["api/mail/overzicht", "api/mail/berichten", "api/mail/berichten/[uid]", "api/mail/verzenden", "api/uitgaven/uit-mail", "api/uitgaven/[id]/uitlezen", "api/uitgaven/[id]/bestanden", "api/uitgaven/[id]", "api/drive/diagnose"];
  const laad = `
    const path = require('node:path');
    (async () => {
      for (const r of ${JSON.stringify(routes)}) {
        try {
          let m = require(path.join(${JSON.stringify(SERVER)}, r, 'route.js'));
          if (m && typeof m.then === 'function') m = await m;
          const u = m.routeModule && m.routeModule.userland;
          const methoden = u ? Object.keys(u).filter((k) => /^[A-Z]+$/.test(k)) : [];
          console.log(JSON.stringify({ r, ok: methoden.length > 0, methoden }));
        } catch (e) {
          console.log(JSON.stringify({ r, ok: false, fout: (e.code || '') + ' ' + String(e.message).split('\\n')[0] }));
        }
      }
    })();`;
  const r = zonderRequireEsm(laad);
  const regels = r.stdout.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  if (!regels.length) mis("gebouwde routes", r.stderr.split("\n")[0] || "geen uitvoer");
  for (const x of regels) {
    if (x.ok) ok(`gebouwd ${x.r} laadt zonder require(esm) (${x.methoden.join(",")})`);
    else mis(`gebouwd ${x.r}`, x.fout ?? "geen route-methoden");
  }
}

console.log(`${geslaagd} geslaagd, ${fouten.length} mislukt`);
process.exit(fouten.length ? 1 : 0);
