// Parity-test: de TypeScript-port lib/social/brand-guard.ts moet byte-identieke uitvoer
// geven t.o.v. het origineel Social-media-tool/lib/brand-guard.js, op alle bestaande
// slides (en de slides in bewaarde versies). Leest de bron alleen; geen netwerk.
//
// Gebruik:  node scripts/test-brand-guard-parity.mjs [pad/naar/Social-media-tool]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.resolve(process.argv[2] || path.join(ROOT, "..", "Social-media-tool"));

// De TS-port laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
let port;
try {
  port = await import(pathToFileURL(path.join(ROOT, "lib", "social", "brand-guard.ts")).href);
} catch (err) {
  if (process.env.PARITY_CHILD) throw err;
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, PARITY_CHILD: "1" } },
  );
  process.exit(r.status ?? 1);
}
const portFormats = await import(pathToFileURL(path.join(ROOT, "lib", "social", "formats.ts")).href);
const origMod = await import(pathToFileURL(path.join(SRC, "lib", "brand-guard.js")).href);
// Bewuste afwijking: de vaste kop is in het dashboard beeldmerk + naam i.p.v. de banner.
const OUDE_KOP = '<span class="lv-logo-banner" role="img" aria-label="Studio Levant"></span>';
const NIEUWE_KOP = '<span class="lv-logo" role="img" aria-label="Studio Levant"></span><span class="lv-logo-tekst">Studio Levant</span>';
const metNieuweKop = (fn) => (...a) => fn(...a).split(OUDE_KOP).join(NIEUWE_KOP);
const orig = { ...origMod, applyChrome: metNieuweKop(origMod.applyChrome) };
const origFormats = await import(pathToFileURL(path.join(SRC, "lib", "formats.js")).href);

// Verzamel testinvoer: alle slide-bestanden + slides uit versies/*.json.
const cases = [];
const projectsDir = path.join(SRC, "projects");
for (const d of fs.readdirSync(projectsDir)) {
  const slidesDir = path.join(projectsDir, d, "slides");
  if (fs.existsSync(slidesDir)) {
    for (const f of fs.readdirSync(slidesDir).filter((f) => f.endsWith(".html"))) {
      cases.push({ name: `${d}/slides/${f}`, html: fs.readFileSync(path.join(slidesDir, f), "utf8") });
    }
  }
  const versies = path.join(projectsDir, d, "versies");
  if (fs.existsSync(versies)) {
    for (const f of fs.readdirSync(versies).filter((f) => f.endsWith(".json"))) {
      const snap = JSON.parse(fs.readFileSync(path.join(versies, f), "utf8"));
      for (const s of snap.slides || []) cases.push({ name: `${d}/versies/${f}#${s.file}`, html: s.html });
    }
  }
}
// Een paar synthetische randgevallen bovenop de echte slides.
cases.push(
  { name: "synthetisch/leeg", html: "" },
  { name: "synthetisch/zonder-slide", html: "<!doctype html><html><head></head><body><p>x</p></body></html>" },
  {
    name: "synthetisch/script-font-import",
    html: `<!doctype html><html><head><link rel="stylesheet" href="https://x/y.css"><style>@import url(a.css); h1{font-family: "Comic Sans", serif} p{font-family:var(--lv-mono)}</style><script>alert(1)</script></head><body style="--w: 1080px; --h: 1350px" data-format="story"><div class="slide lv-light">\n<p>hoi</p></div></body></html>`,
  },
);

let checks = 0;
const failures = [];
const same = (label, a, b) => {
  checks++;
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) failures.push(label);
};

same("FORMATS", portFormats.FORMATS, origFormats.FORMATS);
const combos = [[0, 1], [0, 2], [1, 2], [0, 4], [2, 4], [3, 4], [7, 8]];
for (const c of cases) {
  same(`${c.name} enforceBrand`, port.enforceBrand(c.html), orig.enforceBrand(c.html));
  same(`${c.name} stripChrome`, port.stripChrome(c.html), orig.stripChrome(c.html));
  for (const [i, n] of combos) {
    same(`${c.name} applyChrome(${i},${n})`, port.applyChrome(c.html, i, n), orig.applyChrome(c.html, i, n));
  }
  for (const key of Object.keys(origFormats.FORMATS)) {
    same(
      `${c.name} setCanvas(${key})`,
      port.setCanvas(c.html, portFormats.getFormat(key), key),
      orig.setCanvas(c.html, origFormats.getFormat(key), key),
    );
  }
  // Ketens zoals in de app: enforceBrand -> setCanvas -> applyChrome -> stripChrome.
  const chainPort = port.stripChrome(port.applyChrome(port.setCanvas(port.enforceBrand(c.html).html, portFormats.getFormat("story"), "story"), 1, 3));
  const chainOrig = orig.stripChrome(orig.applyChrome(orig.setCanvas(orig.enforceBrand(c.html).html, origFormats.getFormat("story"), "story"), 1, 3));
  same(`${c.name} keten`, chainPort, chainOrig);
}

console.log(`${cases.length} slides, ${checks} vergelijkingen.`);
if (failures.length) {
  console.error(`MISLUKT: ${failures.length} verschillen:\n- ${failures.slice(0, 20).join("\n- ")}`);
  process.exit(1);
}
console.log("OK: de TS-port is 100% identiek aan het origineel.");
