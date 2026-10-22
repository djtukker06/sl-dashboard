// Lokale render-rooktest voor lib/social/render.ts, zonder database of netwerk-schrijfacties.
//
// Gebruik (Node >= 22.6, voor --experimental-strip-types):
//   node --experimental-strip-types scripts/rooktest-render.mjs [bronmap-social-tool] [uitvoermap]
//
// - De bron (alleen gelezen): één bestaande slide, brand/brand.css, de logo-PNG's en het
//   beeldmateriaal uit Social-media-tool/projects/<id>/.
// - Draait openRenderer() met een in-memory RenderSource (zelfde interceptor als productie).
// - Controleert: PNG op exact canvasformaat, en een gebroken assetpad laat de render niet crashen.
// - Schrijft de PNG's en een PDF naar de uitvoermap (standaard: ./rooktest-uitvoer, in .gitignore).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const bron = path.resolve(process.argv[2] || path.join(root, "..", "Social-media-tool"));
const uit = path.resolve(process.argv[3] || path.join(root, "rooktest-uitvoer"));

const { openRenderer, BRAND_PNGS } = await import(path.join(root, "lib/social/render.ts"));
const { getFormat } = await import(path.join(root, "lib/social/formats.ts"));

function pngSize(buf) {
  // IHDR: breedte op byte 16, hoogte op byte 20 (big-endian).
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("Geen PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// Zoek een project met een slide die naar ../assets/ verwijst.
const projectsDir = path.join(bron, "projects");
let gekozen = null;
for (const id of (await fs.readdir(projectsDir)).sort()) {
  if (id.startsWith(".")) continue;
  const slidesDir = path.join(projectsDir, id, "slides");
  const files = await fs.readdir(slidesDir).catch(() => []);
  for (const f of files.sort()) {
    if (!f.endsWith(".html")) continue;
    const html = await fs.readFile(path.join(slidesDir, f), "utf8");
    if (/\.\.\/assets\//.test(html)) {
      gekozen = { id, file: f, html };
      break;
    }
  }
  if (gekozen) break;
}
if (!gekozen) throw new Error(`Geen slide met beeldmateriaal gevonden in ${projectsDir}`);

const project = JSON.parse(await fs.readFile(path.join(projectsDir, gekozen.id, "project.json"), "utf8"));
const { w, h } = getFormat(project.format);
const brandCss = await fs.readFile(path.join(bron, "brand", "brand.css"), "utf8");

const GEBROKEN = "slide-gebroken.html";
const gebrokenHtml = gekozen.html.replace(/\.\.\/assets\/[A-Za-z0-9._-]+/g, "../assets/bestaat-niet-12345678.jpg");
const slides = new Map([
  [gekozen.file, gekozen.html],
  [GEBROKEN, gebrokenHtml],
]);

const gevraagd = [];
const source = {
  slide: async (file) => (gevraagd.push(`slide ${file}`), slides.get(file) ?? null),
  brandCss: async () => (gevraagd.push("brand.css"), brandCss),
  brandPng: async (name) => {
    gevraagd.push(`brand ${name}`);
    if (!BRAND_PNGS.includes(name)) return null;
    return fs.readFile(path.join(root, "assets", "social-brand", name)).catch(() => null);
  },
  asset: async (file) => {
    gevraagd.push(`asset ${file}`);
    return fs.readFile(path.join(projectsDir, gekozen.id, "assets", file)).catch(() => null);
  },
};

await fs.mkdir(uit, { recursive: true });
console.log(`Project ${gekozen.id}, slide ${gekozen.file}, formaat ${project.format} (${w}x${h})`);

const renderer = await openRenderer(gekozen.id, source);
const fouten = [];
try {
  const png = await renderer.renderPng(gekozen.file, w, h);
  const size = pngSize(png);
  await fs.writeFile(path.join(uit, "slide.png"), png);
  console.log(`slide.png: ${size.w}x${size.h}, ${png.length} bytes`);
  if (size.w !== w || size.h !== h) fouten.push(`slide.png heeft ${size.w}x${size.h}, verwacht ${w}x${h}`);

  const png2 = await renderer.renderPng(GEBROKEN, w, h);
  const size2 = pngSize(png2);
  await fs.writeFile(path.join(uit, "slide-gebroken-asset.png"), png2);
  console.log(`slide-gebroken-asset.png: ${size2.w}x${size2.h}, ${png2.length} bytes`);
  if (size2.w !== w || size2.h !== h) fouten.push(`gebroken slide heeft ${size2.w}x${size2.h}`);

  const pdf = await renderer.pngsToPdf([png, png2], w, h);
  await fs.writeFile(path.join(uit, "export.pdf"), pdf);
  console.log(`export.pdf: ${pdf.length} bytes`);
  if (pdf.subarray(0, 5).toString() !== "%PDF-") fouten.push("export.pdf is geen PDF");
} catch (e) {
  fouten.push(`Render faalde: ${e?.stack || e}`);
} finally {
  await renderer.close();
}

console.log("Opgevraagd via de interceptor:", [...new Set(gevraagd)].join(", "));
if (!gevraagd.some((g) => g.startsWith("asset "))) fouten.push("Asset werd niet via de interceptor opgevraagd");
if (!gevraagd.includes("brand.css")) fouten.push("brand.css werd niet via de interceptor opgevraagd");

if (fouten.length) {
  console.error("MISLUKT:\n- " + fouten.join("\n- "));
  process.exit(1);
}
console.log(`OK: uitvoer in ${uit}`);
