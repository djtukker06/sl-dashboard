// Tests voor het ophalen van links in de social-tool, zonder database en zonder netwerk:
//   - lib/social/links-kern.ts: URL-controle (alleen http/https, geen inloggegevens, geen
//     afwijkende poort, geen interne namen of privé-/loopback-/link-local-adressen, ook IPv6);
//   - HTML uitlezen: titel, beschrijving, og:/twitter:-gegevens, hoofdtekst zonder scripts en
//     menu's, afbeeldingen (og:image, srcset, lazy-load, relatief → absoluut, iconen overslaan);
//   - afbeeldingen herkennen (PNG, JPEG, GIF, WebP) met afmetingen; SVG/HTML geeft null;
//   - statisch: de route gebruikt runtime nodejs, veilig-ophalen gebruikt de eigen DNS-lookup.
//
// Gebruik:  node scripts/test-social-links.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const laad = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href);
const lees = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// TS laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
let kern, netwerk;
try {
  kern = await laad("lib", "social", "links-kern.ts");
  netwerk = await laad("lib", "mail", "netwerk.ts");
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

const check = (url) => kern.controleerLinkUrl(url, netwerk.isPubliekAdres);
const geweigerd = (url) => assert.throws(() => check(url), kern.LinkFout, url);

// ---------- URL-controle ----------
test("gewone links mogen, zonder schema wordt het https", () => {
  assert.equal(check("https://studio-levant.nl/werk").href, "https://studio-levant.nl/werk");
  assert.equal(check("studio-levant.nl/werk").href, "https://studio-levant.nl/werk");
  assert.equal(check("http://voorbeeld.nl:80/").href, "http://voorbeeld.nl/");
  assert.equal(check("https://voorbeeld.nl:443/a").href, "https://voorbeeld.nl/a");
  assert.equal(check("https://8.8.8.8/").hostname, "8.8.8.8");
});
test("andere schema's, inloggegevens en poorten worden geweigerd", () => {
  for (const u of ["ftp://voorbeeld.nl/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hoi", "gopher://voorbeeld.nl"]) geweigerd(u);
  geweigerd("https://jan:geheim@voorbeeld.nl/");
  geweigerd("https://voorbeeld.nl:8080/");
  geweigerd("http://voorbeeld.nl:443/");
  geweigerd("");
  geweigerd("   ");
});
test("localhost, interne namen en privé-adressen worden geweigerd (v4)", () => {
  for (const u of [
    "http://localhost/",
    "http://LOCALHOST./",
    "http://app.localhost/",
    "http://printer.local/",
    "http://server.internal/",
    "http://intranet/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://10.0.0.5/",
    "http://172.16.3.4/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
  ])
    geweigerd(u);
});
test("privé-, loopback- en link-local-adressen worden geweigerd (v6)", () => {
  for (const u of ["http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[fd00::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:a9fe:a9fe]/", "http://[::7f00:1]/", "http://[2002:c0a8:101::1]/"]) geweigerd(u);
  assert.equal(kern.ingebedIpv4("::ffff:7f00:1"), "127.0.0.1");
  assert.equal(kern.ingebedIpv4("::ffff:10.1.2.3"), "10.1.2.3");
  assert.equal(kern.ingebedIpv4("2606:4700::1111"), null);
  assert.equal(kern.isPubliekIp("::ffff:a9fe:a9fe", netwerk.isPubliekAdres), false);
  assert.equal(check("http://[2606:4700:4700::1111]/").hostname, "[2606:4700:4700::1111]");
});

// ---------- HTML uitlezen ----------
const html = `<!doctype html><html><head>
<base href="https://www.voorbeeld.nl/projecten/">
<title>Fallback titel</title>
<meta property="og:title" content="Nieuw kantoor &amp; showroom">
<meta name="description" content="Gewone beschrijving">
<meta property="og:description" content='Een "licht" interieur van 400&nbsp;m&#178;'>
<meta property="og:site_name" content="Voorbeeld Architecten">
<meta property="og:image" content="/media/hero.jpg">
<meta name="twitter:image" content="https://cdn.voorbeeld.nl/tw.png">
<script>var x = "<img src='/script.jpg'>";</script>
<style>.a{background:url(/style.jpg)}</style>
</head><body>
<nav><a href="/">Home</a> Menu-item</nav>
<header><img src="/logo.png" width="120" height="40"></header>
<main>
  <h1>Het project</h1>
  <p>Een kantoor met veel daglicht.<br>Opgeleverd in 2026.</p>
  <img src="foto1.jpg" alt="Hal" width="1600" height="900">
  <img src="/img/icon-pijl.png">
  <img data-src="lazy.webp" src="data:image/gif;base64,R0lGOD">
  <img srcset="klein.jpg 400w, groot.jpg 1600w, middel.jpg 800w" src="klein.jpg">
  <picture><source srcset="https://cdn.voorbeeld.nl/a.webp 1x, https://cdn.voorbeeld.nl/a@2x.webp 2x"><img src="a.jpg"></picture>
  <img src="pixel.gif" width="1" height="1">
  <img src="tekening.svg">
  <!-- <img src="commentaar.jpg"> -->
</main>
<footer>© Voorbeeld &mdash; alle rechten</footer>
</body></html>`;

test("titel, beschrijving en site uit og:-gegevens, met entiteiten", () => {
  const p = kern.leesPagina(html, "https://www.voorbeeld.nl/projecten/kantoor");
  assert.equal(p.titel, "Nieuw kantoor & showroom");
  assert.equal(p.beschrijving, 'Een "licht" interieur van 400 m²');
  assert.equal(p.site, "Voorbeeld Architecten");
});
test("hoofdtekst uit <main>, zonder scripts, menu's en voet", () => {
  const p = kern.leesPagina(html, "https://www.voorbeeld.nl/projecten/kantoor");
  assert.match(p.tekst, /Het project/);
  assert.match(p.tekst, /Een kantoor met veel daglicht\.\nOpgeleverd in 2026\./);
  assert.doesNotMatch(p.tekst, /Menu-item|var x|background|alle rechten/);
});
test("afbeeldingen: og/twitter eerst, relatief → absoluut, srcset groot, lazy-load, iconen en svg eruit", () => {
  const p = kern.leesPagina(html, "https://www.voorbeeld.nl/projecten/kantoor");
  assert.deepEqual(p.afbeeldingen, [
    "https://www.voorbeeld.nl/media/hero.jpg",
    "https://cdn.voorbeeld.nl/tw.png",
    "https://www.voorbeeld.nl/projecten/foto1.jpg",
    "https://www.voorbeeld.nl/projecten/lazy.webp",
    "https://www.voorbeeld.nl/projecten/groot.jpg",
    "https://cdn.voorbeeld.nl/a@2x.webp",
    "https://www.voorbeeld.nl/projecten/a.jpg",
  ]);
});
test("zonder og:-gegevens: <title>, meta description, body-tekst", () => {
  const p = kern.leesPagina(
    "<html><head><title> Mijn  pagina </title><meta name=description content=Kort></head><body><p>Hallo</p><script>x()</script></body></html>",
    "https://a.nl/",
  );
  assert.equal(p.titel, "Mijn pagina");
  assert.equal(p.beschrijving, "Kort");
  assert.equal(p.tekst, "Hallo");
  assert.deepEqual(p.afbeeldingen, []);
});
test("lange tekst wordt ingekort", () => {
  const p = kern.leesPagina(`<body><p>${"woord ".repeat(5000)}</p></body>`, "https://a.nl/");
  assert.ok(p.tekst.length <= kern.MAX_TEKST + 2);
  assert.match(p.tekst, /…$/);
});
test("srcset met komma's in de URL en dichtheden", () => {
  assert.equal(kern.grootsteUitSrcset("a.jpg 1x, b.jpg 3x, c.jpg 2x"), "b.jpg");
  assert.equal(kern.grootsteUitSrcset("https://x.nl/i,w_400.jpg 400w, https://x.nl/i,w_1200.jpg 1200w"), "https://x.nl/i,w_1200.jpg");
});
test("tekenset uit header of meta", () => {
  assert.equal(kern.tekenset("text/html; charset=ISO-8859-1", Buffer.from("")), "iso-8859-1");
  assert.equal(kern.tekenset("text/html", Buffer.from('<meta charset="windows-1252">')), "windows-1252");
  assert.equal(kern.decodeerHtml(Buffer.from([0x63, 0x61, 0x66, 0xe9]), "text/html; charset=windows-1252"), "café");
});

// ---------- afbeeldingen herkennen ----------
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w, h) {
  // SOI, APP0 (lengte 16), SOF0 met hoogte/breedte
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}
function gif(w, h) {
  const b = Buffer.alloc(30);
  b.write("GIF89a", 0, "ascii");
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}
function webpVp8x(w, h) {
  const b = Buffer.alloc(32);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}
test("PNG, JPEG, GIF en WebP met afmetingen", () => {
  assert.deepEqual(kern.herkenBeeld(png(1200, 800)), { soort: "png", breedte: 1200, hoogte: 800 });
  assert.deepEqual(kern.herkenBeeld(jpeg(1600, 900)), { soort: "jpg", breedte: 1600, hoogte: 900 });
  assert.deepEqual(kern.herkenBeeld(gif(1, 1)), { soort: "gif", breedte: 1, hoogte: 1 });
  assert.deepEqual(kern.herkenBeeld(webpVp8x(2000, 1000)), { soort: "webp", breedte: 2000, hoogte: 1000 });
});
test("SVG, HTML en te korte bestanden zijn geen bruikbaar beeld", () => {
  assert.equal(kern.herkenBeeld(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10"></svg>')), null);
  assert.equal(kern.herkenBeeld(Buffer.from("<!doctype html><html><body>Niet gevonden</body></html>")), null);
  assert.equal(kern.herkenBeeld(Buffer.from([0xff, 0xd8])), null);
});
test("korteHost en normaliseerLink", () => {
  assert.equal(kern.korteHost("https://www.Studio-Levant.nl/a"), "studio-levant.nl");
  assert.equal(kern.normaliseerLink("  voorbeeld.nl  "), "https://voorbeeld.nl/");
  assert.equal(kern.normaliseerLink("http://"), null);
});

// ---------- statisch ----------
test("route: runtime nodejs, maxDuration, teamlidcontrole via route()", () => {
  const src = lees("app", "api", "social", "projects", "[id]", "links", "route.ts");
  assert.match(src, /export const runtime = "nodejs"/);
  assert.match(src, /export const maxDuration = \d+/);
  assert.match(src, /export const POST = route\(/);
  assert.match(src, /requireUser\(\)/);
});
test("veilig-ophalen: eigen DNS-lookup met isPubliekAdres, redirects opnieuw gecontroleerd", () => {
  const src = lees("lib", "social", "veilig-ophalen.ts");
  assert.match(src, /lookup: veiligeLookup/);
  assert.match(src, /isPubliekIp\(a\.address, isPubliekAdres\)/);
  assert.match(src, /url = controleerLinkUrl\(volgende, isPubliekAdres\)/);
  assert.match(src, /agent: false/);
});
test("PUT /projects/[id] laat linkInfo niet vanuit de browser zetten", () => {
  const src = lees("app", "api", "social", "projects", "[id]", "route.ts");
  assert.match(src, /delete \(brief as Record<string, unknown>\)\.linkInfo/);
});

console.log(`${goed} tests geslaagd${process.exitCode ? ", met fouten" : ""}`);
