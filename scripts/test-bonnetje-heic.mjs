// Tests voor HEIC-bonnetjes en het klaarmaken van foto's voor Claude, met een realistische
// testbon die dit script zelf maakt (er wordt geen afbeelding gecommit):
//
//   0. Testbon: een lange, smalle kassabon met een groot "Action"-woordmerk bovenaan (wit op
//      zwart, zoals een thermische bon het logo drukt; de naam staat nergens anders), artikelen,
//      subtotaal, btw 21%-specificatie, TOTAAL, PIN en datum 24-10-26 14:32. Gerenderd met
//      puppeteer, iets scheef op een "tafel" gelegd (3024×4032, zoals een iPhone-foto) en met
//      macOS `sips` omgezet naar HEIC. Ook: een strak bijgesneden lange bon en een JPEG met
//      EXIF-oriëntatie 6 (liggend opgeslagen).
//   a. Server (lib/uitgaven/beeld.ts): HEIC → JPEG (libheif-js, pure wasm), rechtop, juiste
//      maat, inhoud gelijk aan het origineel; EXIF-oriëntatie; een lange bon gaat als geheel +
//      twee vergrote helften naar Claude; kapotte HEIC geeft een melding in gewone taal; de
//      combinatie van eerste en tweede poging (lib/uitgaven/claude.ts).
//   c. Browser: de echte bereidVoor() uit lib/uitgaven/client.ts in headless Chrome (puppeteer)
//      met een .HEIC zonder MIME-type: er moet een rechtopstaande JPEG van max. 2400 px uitkomen
//      en de fase "omzetten" moet gemeld zijn.
//   b. Met --claude: échte uitleesacties (Haiku; en één keer Sonnet, het model van de tweede
//      poging) op de JPEG, op de vanaf HEIC omgezette versie en op de lange bon. Verwacht:
//      leverancier "Action", datum 2026-10-24, totaal 16,33. De API-key wordt nooit getoond.
//
// Gebruik:  node scripts/test-bonnetje-heic.mjs [--claude]
//           BON_MAP=/pad/naar/map node scripts/test-bonnetje-heic.mjs   (testbestanden bewaren)
// Zonder macOS/sips worden de HEIC-tests overgeslagen (de rest draait gewoon).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { register } from "node:module";
import * as nodeModule from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ECHT = process.argv.includes("--claude");

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith('./') || spec.startsWith('../')) && !/\\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.endsWith('.ts')) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
  import.meta.url,
);

let beeld, model, claude;
try {
  model = await import(pathToFileURL(path.join(ROOT, "lib", "uitgaven", "model.ts")).href);
  beeld = await import(pathToFileURL(path.join(ROOT, "lib", "uitgaven", "beeld.ts")).href);
  claude = await import(pathToFileURL(path.join(ROOT, "lib", "uitgaven", "claude.ts")).href);
} catch (err) {
  if (process.env.UG_CHILD) throw err;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, UG_CHILD: "1" },
  });
  process.exit(r.status ?? 1);
}
const { default: sharp } = await import("sharp");

let geslaagd = 0;
const fouten = [];
async function test(naam, fn) {
  const t0 = Date.now();
  try {
    await fn();
    geslaagd++;
    console.log(`  ok    ${naam} (${Date.now() - t0} ms)`);
  } catch (e) {
    fouten.push(`${naam}: ${e.message}`);
    console.log(`  FOUT  ${naam}: ${e.message}`);
  }
}

const MAP = process.env.BON_MAP || fs.mkdtempSync(path.join(os.tmpdir(), "bonnetje-"));
fs.mkdirSync(MAP, { recursive: true });
const pad = (n) => path.join(MAP, n);

// ---------------------------------------------------------------- 0. testbon maken
const ARTIKELEN = [
  ["Opbergbox 30 L", "4,49"],
  ["Schroevendraaierset 6-dlg", "3,99"],
  ["Verlengsnoer 3 m", "2,79"],
  ["Batterijen AA 12 st", "2,29"],
  ["2 x Notitieboek A5 à 0,89", "1,78"],
  ["Kabelbinders 100 st", "0,99"],
];
// 4,49 + 3,99 + 2,79 + 2,29 + 1,78 + 0,99 = 16,33; excl. 13,50 + btw 2,83 (21%).
const bonHtml = (extra = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: transparent; }
  .bon { width: 380px; padding: 26px 22px 40px; background: #fbfaf6; color: #1b1b1b;
         font: 15px/1.45 "Courier New", Courier, monospace; }
  .logo { display: flex; justify-content: center; margin: 4px 0 14px; }
  .logo span { background: #111; color: #fbfaf6; font: italic 900 64px/1 "Arial Black", "Helvetica Neue", Arial, sans-serif;
               letter-spacing: -2px; padding: 8px 22px 12px; border-radius: 14px; transform: skewX(-6deg); }
  .c { text-align: center; } .r { display: flex; justify-content: space-between; } .b { font-weight: 700; }
  .groot { font-size: 21px; font-weight: 700; } hr { border: 0; border-top: 1.5px dashed #444; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font: inherit; } td { padding: 0; } td + td { text-align: right; }
</style></head><body><div class="bon">
  <div class="logo"><span>Action</span></div>
  <div class="c">Stationsstraat 12<br>3811 MH Amersfoort<br>Tel. 033-1234567</div>
  <hr>
  ${ARTIKELEN.map(([n, p]) => `<div class="r"><span>${n}</span><span>${p}</span></div>`).join("")}
  <hr>
  <div class="r"><span>Aantal artikelen</span><span>7</span></div>
  <div class="r"><span>Subtotaal</span><span>16,33</span></div>
  <div class="r groot"><span>TOTAAL</span><span>16,33</span></div>
  <div class="r"><span>PIN</span><span>16,33</span></div>
  <hr>
  <table><tr><td>BTW</td><td>Excl.</td><td>BTW</td><td>Incl.</td></tr>
         <tr><td>21%</td><td>13,50</td><td>2,83</td><td>16,33</td></tr></table>
  <hr>
  <div class="c">Maestro **** **** 4417<br>Terminal 7Q2X81 · Transactie 004812<br>AUTORISATIECODE 6F21A0</div>
  <hr>
  <div class="r"><span>Datum 24-10-26</span><span>Tijd 14:32</span></div>
  <div class="r"><span>Kassa 2 · Bon 0457</span><span>Filiaal 1186</span></div>
  <div class="c" style="margin-top:12px">Bedankt voor je bezoek!<br>Ruilen binnen 30 dagen met kassabon.</div>
  ${extra}
</div></body></html>`;
// Voor de lange bon: veel extra tekst onderaan (zoals openingstijden en voorwaarden), zonder bedragen.
const VOET = `<hr><div class="c">${["Openingstijden", "ma t/m za 08:30 - 20:00", "zondag 12:00 - 18:00", "", "Ruilen of retourneren?",
  "Bewaar deze kassabon goed.", "Artikelen ongebruikt en in de", "originele verpakking.", "Geen geld terug op", "cadeaukaarten en batterijen.", "",
  "Vind ons ook online", "Volg ons voor nieuwe artikelen", "elke week nieuwe producten", "", "Klantenservice", "werkdagen 09:00 - 17:00", "",
  "Vragen over je aankoop?", "Neem je kassabon mee naar", "de winkel.", "", "Tot ziens!", "* * * * * * * * * * * *"].map((r) => r || "&nbsp;").join("<br>")}</div>`;

async function maakTestbon(extra = "") {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 440, height: 800, deviceScaleFactor: 3 });
    await page.setContent(bonHtml(extra), { waitUntil: "load" });
    const el = await page.$(".bon");
    return await el.screenshot({ type: "png", omitBackground: true });
  } finally {
    await browser.close();
  }
}

const bonPng = await maakTestbon();
const langPng = await maakTestbon(VOET);
const bonMeta = await sharp(bonPng).metadata();
// Iets scheef, op een "tafel" van 3024×4032 met een zachte gradient (zoals een telefoonfoto).
const scheef = await sharp(bonPng).rotate(-3.5, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const sm = await sharp(scheef).metadata();
const schaal = Math.min(3600 / sm.height, 2600 / sm.width);
const geplaatst = await sharp(scheef).resize(Math.round(sm.width * schaal), Math.round(sm.height * schaal)).png().toBuffer();
const gm = await sharp(geplaatst).metadata();
const tafelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="3024" height="4032"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#7a6a58"/><stop offset="1" stop-color="#4f4337"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
const fotoJpg = await sharp(Buffer.from(tafelSvg))
  .composite([{ input: geplaatst, left: Math.round((3024 - gm.width) / 2), top: Math.round((4032 - gm.height) / 2) }])
  .jpeg({ quality: 92 })
  .toBuffer();
fs.writeFileSync(pad("bon.jpg"), fotoJpg);
// Strak bijgesneden lange bon (zoals een gescande of bijgeknipte foto): verhouding > 2,2.
const langJpg = await sharp(langPng).flatten({ background: "#fbfaf6" }).jpeg({ quality: 92 }).toBuffer();
fs.writeFileSync(pad("bon-lang.jpg"), langJpg);
// Liggend opgeslagen met EXIF-oriëntatie 6 (camera 90° gedraaid): pixels 90° tegen de klok in.
const klein = await sharp(fotoJpg).resize(756, 1008).jpeg({ quality: 95 }).toBuffer();
const liggend = await sharp(await sharp(klein).rotate(-90).toBuffer()).withMetadata({ orientation: 6 }).jpeg({ quality: 90 }).toBuffer();
fs.writeFileSync(pad("bon-exif6.jpg"), liggend);

const heeftSips = spawnSync("sips", ["--version"], { encoding: "utf8" }).status === 0;
let fotoHeic = null;
if (heeftSips) {
  const r = spawnSync("sips", ["-s", "format", "heic", pad("bon.jpg"), "--out", pad("bon.heic")], { encoding: "utf8" });
  if (r.status === 0 && fs.existsSync(pad("bon.heic"))) fotoHeic = fs.readFileSync(pad("bon.heic"));
}
console.log(
  `Testbon: ${bonMeta.width}×${bonMeta.height} px gerenderd; foto 3024×4032 (${Math.round(fotoJpg.length / 1024)} kB JPEG` +
    (fotoHeic ? `, ${Math.round(fotoHeic.length / 1024)} kB HEIC` : ", HEIC overgeslagen: geen sips") +
    `) in ${MAP}`,
);

/** 32×32 grijswaarden, om twee beelden te vergelijken (gemiddeld verschil per pixel, 0–255). */
async function vingerafdruk(buf) {
  return sharp(buf).rotate().resize(32, 32, { fit: "fill" }).grayscale().raw().toBuffer();
}
async function verschil(a, b) {
  const [x, y] = await Promise.all([vingerafdruk(a), vingerafdruk(b)]);
  let som = 0;
  for (let i = 0; i < x.length; i++) som += Math.abs(x[i] - y[i]);
  return som / x.length;
}

// ---------------------------------------------------------------- a. server
console.log("a. Server: HEIC → JPEG en beelden voor Claude");
if (fotoHeic) {
  await test("snuffelType herkent de HEIC", () => {
    assert.equal(model.snuffelType(fotoHeic.subarray(0, 16)), "image/heic");
  });
  await test("heicNaarJpeg: rechtop, max. 2400 px, zelfde inhoud", async () => {
    const t0 = Date.now();
    const { jpeg, width, height } = await beeld.heicNaarJpeg(fotoHeic);
    console.log(`        ${width}×${height}, ${Math.round(jpeg.length / 1024)} kB in ${Date.now() - t0} ms`);
    assert.deepEqual([jpeg[0], jpeg[1], jpeg[2]], [0xff, 0xd8, 0xff]);
    assert.deepEqual([width, height], [1800, 2400]);
    const m = await sharp(jpeg).metadata();
    assert.deepEqual([m.width, m.height], [1800, 2400]);
    const d = await verschil(jpeg, fotoJpg);
    assert.ok(d < 6, `beeld wijkt af van het origineel (gemiddeld ${d.toFixed(1)})`);
    fs.writeFileSync(pad("bon-uit-heic.jpg"), jpeg);
  });
  await test("beeldenVoorClaude(HEIC): één JPEG van 2400 px binnen 5 MB", async () => {
    const b = await beeld.beeldenVoorClaude(fotoHeic);
    assert.equal(b.length, 1);
    assert.equal(b[0].type, "image/jpeg");
    const m = await sharp(b[0].data).metadata();
    assert.equal(Math.max(m.width, m.height), 2400);
    assert.ok(Math.ceil(b[0].data.length / 3) * 4 <= 5 * 1024 * 1024);
  });
  await test("kapotte HEIC: BeeldFout met een melding in gewone taal", async () => {
    const kapot = Buffer.concat([fotoHeic.subarray(0, 600), Buffer.alloc(2000, 7)]);
    await assert.rejects(
      () => beeld.heicNaarJpeg(kapot),
      (e) => e instanceof beeld.BeeldFout && /kon niet worden gelezen/.test(e.message) && !/heif_|error/i.test(e.message),
    );
    // Daarna werkt de decoder gewoon weer.
    const { width } = await beeld.heicNaarJpeg(fotoHeic);
    assert.equal(width, 1800);
  });
} else {
  console.log("  (HEIC-tests overgeslagen: geen sips)");
}
await test("EXIF-oriëntatie 6 wordt rechtop gezet", async () => {
  assert.equal(beeld.exifOrientatie(liggend), 6);
  assert.equal(beeld.exifOrientatie(fotoJpg), 1);
  const r = beeld.decodeerJpeg(liggend);
  assert.deepEqual([r.width, r.height], [756, 1008]);
  const jpeg = beeld.naarJpeg(r);
  const d = await verschil(jpeg, fotoJpg);
  assert.ok(d < 8, `niet rechtop (verschil ${d.toFixed(1)})`);
});
await test("lange bon: geheel + bovenste en onderste helft, elk ≤ 2400 px", async () => {
  // De lange bon (~1270 px breed, verhouding > 2,2) op 4400 px hoog, zoals een scherpe foto.
  const lang = await sharp(langJpg).resize({ height: 4400 }).jpeg({ quality: 90 }).toBuffer();
  const lm = await sharp(lang).metadata();
  assert.ok(lm.height / lm.width >= 2.2, `testbon niet lang genoeg (${lm.width}×${lm.height})`);
  const b = await beeld.beeldenVoorClaude(lang);
  assert.equal(b.length, 3);
  assert.deepEqual(b.map((x) => x.label), ["De hele bon:", "Bovenste deel, vergroot:", "Onderste deel, vergroot:"]);
  for (const x of b) {
    const m = await sharp(x.data).metadata();
    assert.ok(Math.max(m.width, m.height) <= 2400 && Math.ceil(x.data.length / 3) * 4 <= 5 * 1024 * 1024);
  }
  const [g, boven] = await Promise.all(b.slice(0, 2).map((x) => sharp(x.data).metadata()));
  assert.ok(boven.width > g.width * 1.5, "helften zijn vergroot t.o.v. het geheel");
  fs.writeFileSync(pad("bon-lang-4400.jpg"), lang);
});
await test("normale foto: één afbeelding; PNG gaat ongewijzigd", async () => {
  const b = await beeld.beeldenVoorClaude(fotoJpg);
  assert.equal(b.length, 1);
  const png = await sharp(bonPng).resize({ width: 600 }).png().toBuffer();
  const p = await beeld.beeldenVoorClaude(png);
  assert.equal(p[0].type, "image/png");
  assert.equal(p[0].data.length, png.length);
});
await test("verklein: gemiddelde over het gebied, maat klopt", () => {
  const r = { width: 4, height: 2, data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]) };
  const k = beeld.verklein(r, 2);
  assert.deepEqual([k.width, k.height], [2, 1]);
  assert.ok(Math.abs(k.data[0] - 128) <= 1 && Math.abs(k.data[4] - 128) <= 1);
});
await test("tweede poging: wanneer, en hoe de resultaten gecombineerd worden", () => {
  const leeg = { btwBedrag: null, btwTarief: null, valuta: null, factuurnummer: null, omschrijving: null, categorie: null, betaaldVia: null };
  const a = { ...leeg, leverancier: "Action", datum: null, totaal: 16.33, btwBedrag: 2.83, onzeker: ["totaal"] };
  const b = { ...leeg, leverancier: "Action", datum: "2026-10-24", totaal: 16.33, btwBedrag: 2.83, btwTarief: "21", onzeker: [] };
  assert.deepEqual(claude.tweedePogingNodig(a), ["datum", "totaal"]);
  assert.deepEqual(claude.tweedePogingNodig(b), []);
  const { r, bron } = claude.combineer(a, b);
  assert.deepEqual([r.leverancier, r.datum, r.totaal, r.btwTarief], ["Action", "2026-10-24", 16.33, "21"]);
  assert.deepEqual(r.onzeker, []);
  assert.deepEqual(bron, { leverancier: "eerste", datum: "tweede", totaal: "tweede" });
  // Beide zeker maar verschillend: Sonnet (tweede poging), gemarkeerd als onzeker. Beide onzeker: blijft onzeker.
  const c = claude.combineer({ ...b, totaal: 16.38 }, b);
  assert.deepEqual([c.r.totaal, c.r.onzeker], [16.33, ["totaal"]]);
  const d = claude.combineer({ ...a, onzeker: ["leverancier", "totaal"] }, { ...a, datum: null, onzeker: ["totaal"] });
  assert.deepEqual([d.r.leverancier, d.r.datum, d.r.onzeker], ["Action", null, ["totaal"]]);
  assert.equal(claude.zekerheidTekst(a), "leverancier zeker, datum leeg, totaal onzeker");
});
await test("normaliseren: btw uit de specificatie als het btw-totaal ontbreekt", () => {
  const r = model.normaliseerUitgelezen(
    { leverancier: "Action", datum: "2026-10-24", totaal: 16.33, btwBedrag: null, btwTarief: "21%", btwSpecificatie: [{ tarief: "21%", btw: 2.83 }], zekerheid: { leverancier: "zeker", datum: "zeker", totaal: "zeker" } },
    "2026-10-24",
  );
  assert.equal(r.btwBedrag, 2.83);
  assert.ok(claude.SCHEMA.required.includes("btwSpecificatie"));
  assert.ok(/logo/.test(claude.systeemPrompt("2026-10-24", [])) && /Action/.test(claude.systeemPrompt("2026-10-24", [])));
});

// ---------------------------------------------------------------- c. browser
console.log("c. Browser: bereidVoor() met een .HEIC in headless Chrome");
if (!fotoHeic) {
  console.log("  (overgeslagen: geen HEIC)");
} else if (typeof nodeModule.stripTypeScriptTypes !== "function") {
  console.log("  (overgeslagen: deze Node heeft geen module.stripTypeScriptTypes)");
} else {
  await test("HEIC zonder MIME-type → JPEG 1800×2400, rechtop, fase 'omzetten'", async () => {
    const pagina = `<!doctype html><meta charset="utf-8"><script type="importmap">
      {"imports": {"libheif-js/libheif-wasm/libheif-bundle.mjs": "/nm/libheif-js/libheif-wasm/libheif-bundle.mjs"}}</script>
      <script type="module">
        import { bereidVoor, typeVan } from "/lib/uitgaven/client";
        try {
          const blob = await (await fetch("/bon.heic")).blob();
          const f = new File([blob], "IMG_4821.HEIC", { type: "" });
          let omzetten = false;
          const t0 = performance.now();
          const r = await bereidVoor(f, { onOmzetten: () => (omzetten = true) });
          const ms = Math.round(performance.now() - t0);
          const bmp = await createImageBitmap(r.blob);
          const bytes = new Uint8Array(await r.blob.arrayBuffer());
          let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          window.resultaat = { typeVan: typeVan(f), type: r.type, naam: r.naam, omgezet: r.omgezet, omzetten, ms, w: bmp.width, h: bmp.height, grootte: r.blob.size, b64: btoa(bin) };
        } catch (e) { window.resultaat = { fout: String(e && e.stack || e) }; }
      </script>`;
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
      try {
        if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(pagina);
        if (url === "/bon.heic") return res.writeHead(200, { "content-type": "application/octet-stream" }).end(fotoHeic);
        if (url.startsWith("/nm/")) {
          const f = path.join(ROOT, "node_modules", url.slice(4));
          if (!f.startsWith(path.join(ROOT, "node_modules"))) throw new Error("buiten node_modules");
          return res.writeHead(200, { "content-type": "text/javascript" }).end(fs.readFileSync(f));
        }
        if (url.startsWith("/lib/uitgaven/")) {
          const f = path.join(ROOT, url.endsWith(".ts") ? url : `${url}.ts`);
          if (!f.startsWith(path.join(ROOT, "lib", "uitgaven"))) throw new Error("buiten lib/uitgaven");
          const js = nodeModule.stripTypeScriptTypes(fs.readFileSync(f, "utf8"));
          return res.writeHead(200, { "content-type": "text/javascript" }).end(js);
        }
        res.writeHead(404).end();
      } catch (e) {
        res.writeHead(500).end(String(e));
      }
    });
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      const log = [];
      page.on("console", (m) => log.push(`${m.type()}: ${m.text()}`));
      page.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.resultaat, { timeout: 60_000 });
      const r = await page.evaluate(() => window.resultaat);
      if (r.fout) throw new Error(`${r.fout}\n${log.join("\n")}`);
      console.log(`        ${r.w}×${r.h}, ${Math.round(r.grootte / 1024)} kB, ${r.ms} ms, naam ${r.naam}, Chrome ${await browser.version()}`);
      assert.equal(r.typeVan, "image/heic");
      assert.equal(r.omzetten, true, "fase 'omzetten' gemeld (Chrome kan HEIC niet zelf lezen)");
      assert.equal(r.omgezet, true);
      assert.equal(r.type, "image/jpeg");
      assert.equal(r.naam, "IMG_4821.jpg");
      const jpeg = Buffer.from(r.b64, "base64");
      assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
      assert.deepEqual([r.w, r.h], [1800, 2400]);
      const d = await verschil(jpeg, fotoJpg);
      assert.ok(d < 6, `beeld wijkt af van het origineel (${d.toFixed(1)})`);
      fs.writeFileSync(pad("bon-browser.jpg"), jpeg);
    } finally {
      await browser.close();
      server.close();
    }
  });
}

// ---------------------------------------------------------------- b. échte Claude
if (!ECHT) {
  console.log("b. Échte uitleesacties overgeslagen (gebruik --claude).");
} else if (!claude.heeftApiKey()) {
  console.log("b. --claude overgeslagen: ANTHROPIC_API_KEY staat niet in de omgeving.");
} else {
  console.log("b. Échte uitleesacties");
  const VANDAAG = "2026-10-24";
  const systeem = claude.systeemPrompt(VANDAAG, []);
  async function lees(naam, inhoud, opties = {}) {
    const beelden = await beeld.beeldenVoorClaude(inhoud);
    const t0 = Date.now();
    const ruw = await claude.vraagClaude(claude.beeldBlokken(beelden), systeem, opties);
    const r = model.normaliseerUitgelezen(ruw, VANDAAG);
    console.log(
      `        ${naam} → ${opties.model ?? claude.MODEL}, ${beelden.length} afbeelding(en), ${((Date.now() - t0) / 1000).toFixed(1)} s:`,
      JSON.stringify({ leverancier: r.leverancier, datum: r.datum, totaal: r.totaal, btwBedrag: r.btwBedrag, btwTarief: r.btwTarief, onzeker: r.onzeker, categorie: r.categorie, omschrijving: r.omschrijving }),
    );
    return r;
  }
  const verwacht = (r) => {
    assert.equal(r.leverancier, "Action");
    assert.equal(r.datum, "2026-10-24");
    assert.equal(r.totaal, 16.33);
    assert.deepEqual(r.onzeker, []);
  };
  await test("Haiku op de JPEG-foto", async () => {
    const r = await lees("bon.jpg", fotoJpg);
    verwacht(r);
    assert.equal(r.btwBedrag, 2.83);
    assert.equal(r.btwTarief, "21");
  });
  if (fotoHeic) await test("Haiku op de vanaf HEIC omgezette foto", async () => verwacht(await lees("bon.heic", fotoHeic)));
  await test("Haiku op de lange bon (geheel + 2 helften)", async () => verwacht(await lees("bon-lang (4400 px)", fs.readFileSync(pad("bon-lang-4400.jpg")))));
  await test("Sonnet (tweede poging) op de HEIC/JPEG-foto", async () =>
    verwacht(await lees(fotoHeic ? "bon.heic" : "bon.jpg", fotoHeic ?? fotoJpg, { model: claude.MODEL_TWEEDE, effort: "high", timeoutMs: 90_000, maxRetries: 0 })),
  );
}

if (!process.env.BON_MAP) fs.rmSync(MAP, { recursive: true, force: true });
console.log(`${geslaagd} geslaagd, ${fouten.length} mislukt`);
for (const f of fouten) console.log(`  FOUT  ${f}`);
process.exit(fouten.length ? 1 : 0);
