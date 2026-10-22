#!/usr/bin/env node
/**
 * Importeert de projecten van de oude, lokale Levant Social Studio (Social-media-tool)
 * in de Supabase-tabellen en Storage-bucket van het dashboard.
 *
 *   Bron (alleen gelezen)                    Doel
 *   projects/<id>/project.json           ->  social_projects
 *   projects/<id>/slides/*.html          ->  social_slides (álle bestanden, ook niet-actieve)
 *   projects/<id>/versies/<epoch>.json   ->  social_versions (created_at = epoch uit de bestandsnaam)
 *   projects/<id>/assets/*               ->  Storage "social-assets/<id>/<bestand>"
 *   projects/.prullenbak                 ->  overgeslagen
 *
 * Gebruik:
 *   node scripts/importeer-social-projecten.mjs [--bron <pad>]              # dry-run (standaard): alleen een overzicht
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/importeer-social-projecten.mjs [--bron <pad>] --uitvoeren # echt schrijven, na bevestiging
 *
 * - Standaard is de bron ../Social-media-tool (naast deze repo).
 * - Zonder --uitvoeren wordt er niets geschreven en is er geen verbinding met Supabase nodig.
 * - SUPABASE_URL (of NEXT_PUBLIC_SUPABASE_URL) en SUPABASE_SERVICE_ROLE_KEY komen uit de
 *   procesomgeving. Het script leest geen .env-bestanden en print de key nooit.
 * - Idempotent: projecten en slides via upsert, assets met upsert, versies worden
 *   overgeslagen als er al een versie met hetzelfde tijdstip voor dat project bestaat.
 * - Dode asset-verwijzingen (in project.json maar niet op schijf) worden gelogd en overgeslagen.
 * - Draai migraties 0014–0016 eerst, en probeer het eerst op een testproject.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const SAFE = /^[a-z0-9][a-z0-9._-]*$/i;
const BUCKET = "social-assets";
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const uitvoeren = args.includes("--uitvoeren");
const bronIdx = args.indexOf("--bron");
const bron = path.resolve(bronIdx >= 0 && args[bronIdx + 1] ? args[bronIdx + 1] : path.join(here, "..", "..", "Social-media-tool"));
const projectsDir = path.join(bron, "projects");

function fail(msg) {
  console.error(`Fout: ${msg}`);
  process.exit(1);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const listFiles = (dir, filter = () => true) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.startsWith(".") && filter(d.name))
        .map((d) => d.name)
        .sort()
    : [];

// ---------------------------------------------------------------- bron inlezen (alleen lezen)

function leesProject(id) {
  const dir = path.join(projectsDir, id);
  const p = readJson(path.join(dir, "project.json"));
  if (p.id !== id) console.warn(`  ! ${id}: id in project.json (${p.id}) wijkt af; de mapnaam wordt gebruikt.`);

  const slides = listFiles(path.join(dir, "slides"), (f) => f.endsWith(".html") && SAFE.test(f)).map((file) => ({
    file,
    html: fs.readFileSync(path.join(dir, "slides", file), "utf8"),
  }));

  const versies = listFiles(path.join(dir, "versies"), (f) => /^\d+\.json$/.test(f)).map((f) => {
    const snap = readJson(path.join(dir, "versies", f));
    return {
      created_at: new Date(Number(f.replace(/\.json$/, ""))).toISOString(),
      reason: snap.reason ?? null,
      caption: snap.caption ?? null,
      slides: Array.isArray(snap.slides) ? snap.slides.map((s) => ({ file: s.file, html: s.html })) : [],
    };
  });

  const opSchijf = new Set(listFiles(path.join(dir, "assets"), (f) => SAFE.test(f)));
  const assets = [];
  const dood = [];
  for (const a of Array.isArray(p.assets) ? p.assets : []) {
    if (a && typeof a.file === "string" && opSchijf.has(a.file)) assets.push(a);
    else dood.push(a?.file ?? String(a));
  }
  // Losse bestanden in assets/ die niet in project.json staan gaan wel mee naar Storage
  // (net als losse bestanden op schijf), maar niet in de assets-lijst.
  const bestanden = [...opSchijf];

  const row = {
    id,
    name: String(p.name || "Nieuwe post"),
    format: String(p.format || "ig-portrait"),
    brief: p.brief && typeof p.brief === "object" ? p.brief : {},
    links: Array.isArray(p.links) ? p.links : [],
    assets,
    caption: typeof p.caption === "string" ? p.caption : "",
    slides: Array.isArray(p.slides) ? p.slides : [],
    // In de oude tool betekent een ontbrekende brandChrome "uit"; dat blijft zo.
    brand_chrome: Boolean(p.brandChrome),
    feedback_log: Array.isArray(p.feedbackLog) ? p.feedbackLog : null,
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: p.updatedAt || p.createdAt || new Date().toISOString(),
    deleted_at: null,
  };

  const ontbrekendeSlides = row.slides.filter((f) => !slides.some((s) => s.file === f));
  return { dir, row, slides, versies, bestanden, dood, ontbrekendeSlides };
}

if (!fs.existsSync(projectsDir)) fail(`map met projecten niet gevonden: ${projectsDir}`);

const ids = fs
  .readdirSync(projectsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== ".prullenbak" && !d.name.startsWith("."))
  .map((d) => d.name)
  .filter((name) => {
    if (!SAFE.test(name)) {
      console.warn(`  ! map "${name}" overgeslagen: ongeldige projectnaam.`);
      return false;
    }
    if (!fs.existsSync(path.join(projectsDir, name, "project.json"))) {
      console.warn(`  ! map "${name}" overgeslagen: geen project.json.`);
      return false;
    }
    return true;
  })
  .sort();

const projecten = ids.map(leesProject);

console.log(`Bron: ${projectsDir}`);
console.log(`${projecten.length} project(en) gevonden (.prullenbak wordt overgeslagen):\n`);
for (const p of projecten) {
  console.log(`- ${p.row.id}  "${p.row.name}"`);
  console.log(
    `    ${p.row.slides.length} actieve slides, ${p.slides.length} slide-bestanden, ${p.versies.length} versies, ` +
      `${p.bestanden.length} assetbestanden (${p.row.assets.length} in de lijst)`
  );
  for (const f of p.dood) console.log(`    ! dode asset-verwijzing overgeslagen: ${f}`);
  for (const f of p.ontbrekendeSlides) console.log(`    ! actieve slide ontbreekt op schijf: ${f}`);
}

if (!uitvoeren) {
  console.log("\nDry-run: er is niets geschreven. Gebruik --uitvoeren om echt te importeren.");
  process.exit(0);
}

// ---------------------------------------------------------------- echt schrijven

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in de omgeving (de waarden worden niet getoond).");

let host;
try {
  host = new URL(url).host;
} catch {
  fail("SUPABASE_URL is geen geldige URL.");
}

console.log(`\nDoel: Supabase-project op ${host}`);
console.log(`Projecten: ${projecten.map((p) => `"${p.row.name}"`).join(", ") || "(geen)"}`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const antwoord = (await rl.question(`Typ de host (${host}) om te bevestigen dat je hiernaar wilt schrijven: `)).trim();
rl.close();
if (antwoord !== host) fail("niet bevestigd; er is niets geschreven.");

const { createClient } = await import("@supabase/supabase-js");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let fouten = 0;
for (const p of projecten) {
  const id = p.row.id;
  console.log(`\n${id}  "${p.row.name}"`);
  try {
    const { error: e1 } = await db.from("social_projects").upsert(p.row, { onConflict: "id" });
    if (e1) throw new Error(`project: ${e1.message}`);

    if (p.slides.length) {
      const rows = p.slides.map((s) => ({ project_id: id, file: s.file, html: s.html, updated_at: p.row.updated_at }));
      const { error: e2 } = await db.from("social_slides").upsert(rows, { onConflict: "project_id,file" });
      if (e2) throw new Error(`slides: ${e2.message}`);
    }
    console.log(`  slides: ${p.slides.length}`);

    const { data: bestaand, error: e3 } = await db.from("social_versions").select("created_at").eq("project_id", id);
    if (e3) throw new Error(`versies lezen: ${e3.message}`);
    const al = new Set((bestaand || []).map((v) => new Date(v.created_at).getTime()));
    const nieuw = p.versies.filter((v) => !al.has(new Date(v.created_at).getTime()));
    if (nieuw.length) {
      const { error: e4 } = await db.from("social_versions").insert(nieuw.map((v) => ({ ...v, project_id: id })));
      if (e4) throw new Error(`versies: ${e4.message}`);
    }
    console.log(`  versies: ${nieuw.length} nieuw, ${p.versies.length - nieuw.length} al aanwezig`);

    let geupload = 0;
    for (const file of p.bestanden) {
      const ext = file.split(".").pop().toLowerCase();
      const body = fs.readFileSync(path.join(p.dir, "assets", file));
      const { error } = await db.storage
        .from(BUCKET)
        .upload(`${id}/${file}`, body, { contentType: MIME[ext] || "application/octet-stream", upsert: true });
      if (error) {
        fouten++;
        console.warn(`  ! asset ${file}: ${error.message}`);
      } else geupload++;
    }
    console.log(`  assets: ${geupload}/${p.bestanden.length} geüpload`);
  } catch (err) {
    fouten++;
    console.error(`  ! mislukt: ${err.message}`);
  }
}

console.log(fouten ? `\nKlaar met ${fouten} fout(en). Het script is veilig om opnieuw te draaien.` : "\nKlaar.");
process.exit(fouten ? 1 : 0);
