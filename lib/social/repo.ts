// Data-access voor de social media-module. Vervangt de bestandsfuncties uit
// Social-media-tool/server.js (readProject, writeProject, readSlides, snapshot,
// writeSlide, refreshChrome) door Supabase-tabellen uit migratie 0014.
// Alle functies gebruiken de service-role client: ALLEEN aanroepen binnen route() of
// metTeamlid() (lib/auth/team.ts), dus ná de teamlidcontrole.

import { bucketOntbreekt, tabelOntbreekt } from "@/lib/db/ontbreekt";
import { applyChrome, stripChrome } from "./brand-guard";
import { BUCKET, HttpError, db, NIET_INGERICHT, BUCKET_NIET_INGERICHT } from "./http";
import { safe } from "./ids";

export type Asset = { file: string; kind: "beeld" | "inspiratie"; note: string };
export type FeedbackEntry = { at: string; mode: string; feedback: string };

/** Exact de vorm van het oude project.json (camelCase). */
export type Project = {
  id: string;
  name: string;
  format: string;
  brief: Record<string, unknown>;
  links: string[];
  assets: Asset[];
  caption: string;
  slides: string[];
  brandChrome: boolean;
  createdAt: string;
  updatedAt: string;
  feedbackLog?: FeedbackEntry[];
  versionCount?: number;
};

export type ProjectRow = {
  id: string;
  name: string;
  format: string;
  brief: Record<string, unknown> | null;
  links: string[] | null;
  assets: Asset[] | null;
  caption: string | null;
  slides: string[] | null;
  brand_chrome: boolean | null;
  feedback_log: FeedbackEntry[] | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type Slide = { file: string; html: string };

const iso = (ts: string | null | undefined) => (ts ? new Date(ts).toISOString() : new Date().toISOString());

function dbFail(err: unknown, message = "Er ging iets mis met de database."): never {
  console.error(err);
  // Tabellen/RPC nog niet aangemaakt (migraties 0014–0017 niet uitgevoerd): geen
  // algemene 500, maar een duidelijke 503. De frontend toont dan een setupmelding in
  // plaats van een lege lijst die leest als "al je posts zijn weg".
  if (tabelOntbreekt(err)) throw new HttpError(503, NIET_INGERICHT);
  if (bucketOntbreekt(err)) throw new HttpError(503, BUCKET_NIET_INGERICHT);
  throw new HttpError(500, message);
}

export function rowToProject(row: ProjectRow): Project {
  const p: Project = {
    id: row.id,
    name: row.name,
    format: row.format,
    brief: row.brief ?? {},
    links: row.links ?? [],
    assets: row.assets ?? [],
    caption: row.caption ?? "",
    slides: row.slides ?? [],
    brandChrome: row.brand_chrome ?? true,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.feedback_log) p.feedbackLog = row.feedback_log;
  return p;
}

function projectToRow(p: Project) {
  return {
    id: p.id,
    name: p.name,
    format: p.format,
    brief: p.brief,
    links: p.links,
    assets: p.assets,
    caption: p.caption,
    slides: p.slides,
    brand_chrome: p.brandChrome,
    feedback_log: p.feedbackLog ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

// ---------------------------------------------------------------- projecten

/** server.js `readProject()`/`projectDir()`: 400 bij ongeldig id, 404 als het niet bestaat. */
export async function getProject(pid: string): Promise<Project> {
  if (!safe(pid)) throw new HttpError(400, "Ongeldig project");
  const { data, error } = await db()
    .from("social_projects")
    .select("*")
    .eq("id", pid)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) dbFail(error);
  if (!data) throw new HttpError(404, "Project niet gevonden");
  return rowToProject(data as ProjectRow);
}

/** server.js `writeProject()`: zet updatedAt en slaat op (insert of update). */
export async function saveProject(p: Project): Promise<Project> {
  p.updatedAt = new Date().toISOString();
  const { versionCount: _skip, ...rest } = p;
  void _skip;
  const { error } = await db().from("social_projects").upsert(projectToRow(rest as Project), { onConflict: "id" });
  if (error) dbFail(error, "Kon het project niet opslaan.");
  return p;
}

/**
 * "Aangemaakt door" op een nieuw project (de service-role zet geen auth.uid()). Best effort:
 * vóór migratie 0021 bestaat de kolom nog niet, en dan gebeurt er niets.
 */
export async function markeerMaker(pid: string, userId: string): Promise<void> {
  const { error } = await db().from("social_projects").update({ created_by: userId }).eq("id", pid).is("created_by", null);
  if (error && error.code !== "42703" && error.code !== "PGRST204") console.error("[social] maker vastleggen", error.message);
}

/** server.js:131-139: lijst zonder verwijderde projecten, nieuwste eerst. */
export async function listProjects() {
  const { data, error } = await db()
    .from("social_projects")
    .select("id, name, format, slides, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) dbFail(error);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    format: r.format as string,
    slides: (r.slides ?? []) as string[],
    updatedAt: iso(r.updated_at as string),
  }));
}

/** Prullenbak: zacht verwijderen (vervangt het verplaatsen naar projects/.prullenbak). */
export async function softDeleteProject(pid: string) {
  const { error } = await db()
    .from("social_projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", pid)
    .is("deleted_at", null);
  if (error) dbFail(error, "Kon het project niet verwijderen.");
}

export async function versionCount(pid: string): Promise<number> {
  const { count, error } = await db()
    .from("social_versions")
    .select("id", { count: "exact", head: true })
    .eq("project_id", pid);
  if (error) dbFail(error);
  return count ?? 0;
}

// ---------------------------------------------------------------- slides

/** server.js `slidePath()`: 404 als de slide niet (meer) bij het project hoort. */
export function checkSlide(p: Project, file: string) {
  if (!safe(file) || !p.slides.includes(file)) throw new HttpError(404, "Slide niet gevonden");
}

/** Leest één slide-rij (ook niet-actieve, zoals de oude statische slides-map). */
export async function readSlideRow(pid: string, file: string): Promise<string | null> {
  const { data, error } = await db()
    .from("social_slides")
    .select("html")
    .eq("project_id", pid)
    .eq("file", file)
    .maybeSingle();
  if (error) dbFail(error);
  return data ? (data.html as string) : null;
}

export async function readSlide(p: Project, file: string): Promise<string> {
  checkSlide(p, file);
  const html = await readSlideRow(p.id, file);
  if (html === null) throw new HttpError(404, "Slide niet gevonden");
  return html;
}

/** Leest de HTML van bepaalde slide-bestanden als Map (bestand -> html). */
async function readSlideMap(pid: string, files: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!files.length) return map;
  const { data, error } = await db()
    .from("social_slides")
    .select("file, html")
    .eq("project_id", pid)
    .in("file", files);
  if (error) dbFail(error);
  for (const r of data ?? []) map.set(r.file as string, r.html as string);
  return map;
}

/** server.js `readSlides()`: alle actieve slides in volgorde. */
export async function readSlides(p: Project): Promise<Slide[]> {
  const map = await readSlideMap(p.id, p.slides);
  return p.slides.map((file) => {
    const html = map.get(file);
    if (html === undefined) throw new HttpError(500, `Slide ${file} ontbreekt in de database.`);
    return { file, html };
  });
}

/** Alle slide-rijen van een project (ook niet-actieve), bijv. voor dupliceren of de ZIP. */
export async function readAllSlideRows(pid: string): Promise<Slide[]> {
  const { data, error } = await db()
    .from("social_slides")
    .select("file, html")
    .eq("project_id", pid)
    .order("file");
  if (error) dbFail(error);
  return (data ?? []).map((r) => ({ file: r.file as string, html: r.html as string }));
}

/** Batch-upsert van slides. */
export async function writeSlides(pid: string, slides: Slide[]) {
  if (!slides.length) return;
  const now = new Date().toISOString();
  const { error } = await db()
    .from("social_slides")
    .upsert(
      slides.map((s) => ({ project_id: pid, file: s.file, html: s.html, updated_at: now })),
      { onConflict: "project_id,file" },
    );
  if (error) dbFail(error, "Kon de slides niet opslaan.");
}

/**
 * server.js `snapshot()`: bewaart de huidige slides + caption zodat je een stap terug kunt.
 * Alleen als er slides zijn.
 */
export async function snapshot(p: Project, reason: string, current?: Slide[]) {
  if (!p.slides.length) return;
  const slides = current ?? (await readSlides(p));
  const { error } = await db()
    .from("social_versions")
    .insert({ project_id: p.id, reason, caption: p.caption, slides });
  if (error) dbFail(error, "Kon geen versie bewaren.");
}

/**
 * server.js `writeSlide()` + `refreshChrome()` in één batch: zet of verwijdert de
 * vaste huisstijlelementen op alle actieve slides, met juiste nummering.
 * `pending` bevat slides die net nieuw/gewijzigd zijn (bestand -> html); die worden
 * altijd geschreven. Bestaande slides worden alleen geschreven als ze veranderen.
 */
export async function refreshChrome(p: Project, pending: Map<string, string> = new Map()) {
  const missing = p.slides.filter((f) => !pending.has(f));
  const stored = await readSlideMap(p.id, missing);
  const writes: Slide[] = [];
  p.slides.forEach((file, i) => {
    const html = pending.has(file) ? pending.get(file)! : stored.get(file);
    if (html === undefined) throw new HttpError(500, `Slide ${file} ontbreekt in de database.`);
    const next = p.brandChrome ? applyChrome(html, i, p.slides.length) : stripChrome(html);
    if (pending.has(file) || next !== html) writes.push({ file, html: next });
  });
  // Gewijzigde slides die (inmiddels) niet meer actief zijn, toch opslaan — zoals
  // writeSlide() in de bron het bestand ook altijd schreef.
  for (const [file, html] of pending) if (!p.slides.includes(file)) writes.push({ file, html });
  await writeSlides(p.id, writes);
}

/** POST /restore: RPC uit migratie 0014 (één transactie). null = geen eerdere versie. */
export async function restoreLatest(pid: string): Promise<Project | null> {
  const { data, error } = await db().rpc("social_restore_latest", { p_project_id: pid });
  if (error) dbFail(error, "Kon de vorige versie niet terugzetten.");
  return data ? rowToProject(data as ProjectRow) : null;
}

// ---------------------------------------------------------------- huisstijl

export type Brand = { css: string; guide: string };

export async function getBrand(): Promise<Brand> {
  const { data, error } = await db().from("social_brand").select("css, guide").eq("id", 1).maybeSingle();
  if (error) dbFail(error);
  if (!data) throw new HttpError(503, "De huisstijl staat nog niet in de database: voer in Supabase migratie 0016 uit.");
  return { css: data.css as string, guide: data.guide as string };
}

export async function setBrand(update: Partial<Brand>) {
  const { data, error: readErr } = await db().from("social_brand").select("css, guide").eq("id", 1).maybeSingle();
  if (readErr) dbFail(readErr);
  const row = {
    id: 1,
    css: update.css ?? (data?.css as string | undefined) ?? "",
    guide: update.guide ?? (data?.guide as string | undefined) ?? "",
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("social_brand").upsert(row, { onConflict: "id" });
  if (error) dbFail(error, "Kon de huisstijl niet opslaan.");
}

// ---------------------------------------------------------------- beeldmateriaal (Storage)

export const assetPath = (pid: string, file: string) => `${pid}/${file}`;

export function mediaType(file: string) {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  return ext === ".png"
    ? "image/png"
    : ext === ".webp"
      ? "image/webp"
      : ext === ".gif"
        ? "image/gif"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : "application/octet-stream";
}

/** Downloadt een asset; null als het object niet bestaat (zoals `fs.existsSync`). */
export async function downloadAsset(pid: string, file: string): Promise<Buffer | null> {
  if (!safe(pid) || !safe(file)) return null;
  const { data, error } = await db().storage.from(BUCKET).download(assetPath(pid, file));
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Alle objecten direct onder `<pid>/` (geen submappen), met grootte. */
export async function listAssetObjects(pid: string): Promise<{ name: string; size: number }[]> {
  const storage = db().storage.from(BUCKET);
  const out: { name: string; size: number }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.list(pid, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) dbFail(error, "Kon het beeldmateriaal niet ophalen.");
    const files = (data ?? []).filter((o) => o.id !== null);
    for (const o of files) out.push({ name: o.name, size: Number(o.metadata?.size ?? 0) });
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** Verwijdert één object uit de bucket (best effort; fouten worden alleen gelogd). */
export async function removeAssetObject(pid: string, file: string): Promise<void> {
  if (!safe(pid) || !safe(file)) return;
  const { error } = await db().storage.from(BUCKET).remove([assetPath(pid, file)]);
  if (error) console.error(error);
}

/** Zoekt één object op (bestaat het, en hoe groot is het). */
export async function statAsset(pid: string, file: string): Promise<{ size: number } | null> {
  const { data, error } = await db().storage.from(BUCKET).list(pid, { limit: 100, search: file });
  if (error) dbFail(error, "Kon het beeldmateriaal niet ophalen.");
  const hit = (data ?? []).find((o) => o.name === file && o.id !== null);
  return hit ? { size: Number(hit.metadata?.size ?? 0) } : null;
}
