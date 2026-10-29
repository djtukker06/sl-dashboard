// Tests voor de Scratchpad (migratie 0031), zonder database en zonder netwerk:
//   - lib/notities/kern.ts: invoer controleren (titel, emoji, koppeling, privé, vastpinnen,
//     terugzetten), de Tiptap-inhoud opschonen (alleen bekende knopen/marks/attributen, veilige
//     links, maximale grootte), platte tekst en fragmenten, zoeken (zonder accenten, alle
//     termen), veilige zoektermen voor de database, filteren en sorteren;
//   - bronbewaking: de pagina en elke API-route gaan via de centrale teamcheck, de inhoud
//     wordt nergens als losse HTML getoond, migratie 0031 = UITVOEREN_0031.sql met RLS via
//     is_teamlid(), de module staat in de rail, de tabel zit in de back-up, het dashboard en
//     de klant- en projectpagina tonen het blok, en uitloggen wist de concepten.
// De RLS van public.notities (gedeeld/privé, maker, zacht verwijderen) staat in
// scripts/test-rls.mjs (scenario E, PGlite).
//
// Gebruik:  node scripts/test-notities.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let K;
try {
  K = await import(pathToFileURL(path.join(ROOT, "lib", "notities", "kern.ts")).href);
} catch (e) {
  if (process.execArgv.includes("--experimental-strip-types")) throw e;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

let goed = 0;
let fout = 0;
function test(naam, fn) {
  try {
    fn();
    goed++;
  } catch (e) {
    fout++;
    console.log(`  FOUT  ${naam}\n        ${e.message.split("\n")[0]}`);
  }
}

const doc = (...content) => ({ type: "doc", content });
const p = (...content) => ({ type: "paragraph", content });
const t = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

// ---------------------------------------------------------------------------------
// Invoer
// ---------------------------------------------------------------------------------
test("nieuw zonder velden mag (lege notitie)", () => {
  const r = K.parseNotitie({}, true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.waarde, {});
});
test("wijzigen zonder velden geeft een fout", () => {
  assert.equal(K.parseNotitie({}, false).ok, false);
});
test("titel: één regel, randen weg, max. 200", () => {
  assert.equal(K.parseNotitie({ titel: "  Idee\nvoor   logo  " }, true).waarde.titel, "Idee voor logo");
  assert.equal(K.parseNotitie({ titel: "a".repeat(300) }, true).waarde.titel.length, 200);
  assert.equal(K.parseNotitie({ titel: "a".repeat(900) }, true).ok, false);
  assert.equal(K.parseNotitie({ titel: 12 }, true).ok, false);
});
test("emoji: één emoji (ook ZWJ, huidskleur, vlag), geen tekst of HTML", () => {
  for (const e of ["💡", "🖌️", "👩‍💻", "👍🏽", "🇳🇱", "❤️"]) assert.equal(K.isEmoji(e), true, e);
  for (const e of ["a", "<b>", "💡 idee", "", "123", "<img src=x onerror=alert(1)>", "💡".repeat(9)]) assert.equal(K.isEmoji(e), false, e);
  assert.equal(K.parseNotitie({ emoji: null }, false).waarde.emoji, null);
  assert.equal(K.parseNotitie({ emoji: "" }, false).waarde.emoji, null);
  assert.equal(K.parseNotitie({ emoji: "x" }, false).ok, false);
});
test("koppeling: uuid of leeg", () => {
  const r = K.parseNotitie({ klantId: UUID, projectId: null }, false);
  assert.deepEqual(r.waarde, { client_id: UUID, project_id: null });
  assert.equal(K.parseNotitie({ klantId: "1; drop table" }, false).ok, false);
  assert.equal(K.parseNotitie({ projectId: 5 }, false).ok, false);
  assert.equal(K.parseNotitie({ klantId: "" }, false).waarde.client_id, null);
});
test("privé en vastgepind alleen als boolean", () => {
  assert.deepEqual(K.parseNotitie({ prive: true, vastgepind: false }, false).waarde, { prive: true, vastgepind: false });
  assert.equal(K.parseNotitie({ prive: "ja" }, false).ok, false);
});
test("terugzetten: alleen verwijderd = false, alleen bij wijzigen", () => {
  assert.deepEqual(K.parseNotitie({ verwijderd: false }, false).waarde, { verwijderd_op: null });
  assert.equal(K.parseNotitie({ verwijderd: true }, false).ok, false);
  assert.equal(K.parseNotitie({ verwijderd: false }, true).ok, false);
});
test("onbekende velden (created_by, id) komen nooit in de rij", () => {
  const r = K.parseNotitie({ titel: "x", created_by: UUID, id: UUID, updated_by: UUID, verwijderd_op: null }, false);
  assert.deepEqual(Object.keys(r.waarde), ["titel"]);
});
test("sinds: alleen een geldige tijd", () => {
  assert.equal(K.parseSinds("2026-10-29T10:11:12.123456+00:00"), "2026-10-29T10:11:12.123456+00:00");
  assert.equal(K.parseSinds("gisteren"), null);
  assert.equal(K.parseSinds(123), null);
  assert.equal(K.parseSinds("x".repeat(50)), null);
});

// ---------------------------------------------------------------------------------
// Inhoud opschonen
// ---------------------------------------------------------------------------------
test("inhoud: geen document → fout; leeg document → één lege alinea", () => {
  assert.equal(K.parseNotitie({ inhoud: "tekst" }, false).ok, false);
  assert.equal(K.parseNotitie({ inhoud: { type: "paragraph" } }, false).ok, false);
  assert.deepEqual(K.schoonInhoud({ type: "doc", content: [] }), { type: "doc", content: [{ type: "paragraph" }] });
});
test("inhoud: bekende blokken blijven staan (koppen, lijsten, afvinklijst, citaat, code, lijn)", () => {
  const d = doc(
    { type: "heading", attrs: { level: 2 }, content: [t("Kop")] },
    { type: "bulletList", content: [{ type: "listItem", content: [p(t("a"))] }] },
    { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("b"))] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("klaar"))] }] },
    { type: "blockquote", content: [p(t("citaat"))] },
    { type: "codeBlock", attrs: { language: "js" }, content: [t("let x = 1")] },
    { type: "horizontalRule" },
    p(t("vet", [{ type: "bold" }, { type: "italic" }]), { type: "hardBreak" }, t("code", [{ type: "code" }])),
  );
  assert.deepEqual(K.schoonInhoud(d), d);
});
test("inhoud: onbekende knopen, marks en attributen vallen weg", () => {
  const d = doc(
    { type: "iframe", attrs: { src: "https://evil.example" } },
    { type: "paragraph", attrs: { onclick: "alert(1)", style: "x" }, content: [t("hoi", [{ type: "script" }, { type: "bold", attrs: { x: 1 } }])] },
    { type: "heading", attrs: { level: 9, id: "x" }, content: [t("H")] },
    { type: "taskItem", attrs: { checked: "ja" }, content: [p(t("los"))] },
  );
  assert.deepEqual(K.schoonInhoud(d), doc(p(t("hoi", [{ type: "bold" }])), { type: "heading", attrs: { level: 3 }, content: [t("H")] }, { type: "taskItem", attrs: { checked: false }, content: [p(t("los"))] }));
});
test("inhoud: links alleen http(s), mailto, tel of een eigen pad", () => {
  const link = (href) => K.schoonInhoud(doc(p(t("x", [{ type: "link", attrs: { href, target: "_self", onclick: "x" } }]))))?.content[0].content[0].marks;
  assert.deepEqual(link("https://studio-levant.nl"), [{ type: "link", attrs: { href: "https://studio-levant.nl", target: "_blank", rel: "noopener noreferrer nofollow" } }]);
  assert.equal(link("/klanten/123")[0].attrs.href, "/klanten/123");
  assert.equal(link("mailto:info@example.com")[0].attrs.href, "mailto:info@example.com");
  for (const slecht of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "//evil.example", "vbscript:x", " ", 'https://x" onmouseover="y']) {
    assert.equal(link(slecht), undefined, slecht);
  }
});
test("inhoud: lege tekstknopen en lege lijsten vallen weg, tekst direct in doc niet", () => {
  assert.deepEqual(K.schoonInhoud(doc(t("los"), { type: "bulletList", content: [] }, p(t("")))), doc({ type: "paragraph" }));
});
test("inhoud: te diep of te groot wordt geweigerd/afgekapt", () => {
  let diep = p(t("x"));
  for (let i = 0; i < 80; i++) diep = { type: "blockquote", content: [diep] };
  const s = K.schoonInhoud(doc(diep));
  assert.ok(JSON.stringify(s).length < JSON.stringify(doc(diep)).length);
  const groot = doc(...Array.from({ length: 20 }, () => p(t("a".repeat(60_000)))));
  const r = K.parseNotitie({ inhoud: groot }, false);
  assert.equal(r.ok, false);
  assert.match(r.fout, /te groot/);
});
// Het echte schema van de editor (zelfde extensies als components/notities/Editor.tsx): wat
// schoonInhoud teruggeeft moet Tiptap zonder fouten kunnen laden (anders gooit Tiptap de
// inhoud weg en zou autosave een lege notitie opslaan).
const { getSchema } = await import("@tiptap/core");
const StarterKit = (await import("@tiptap/starter-kit")).default;
const TaskList = (await import("@tiptap/extension-task-list")).default;
const TaskItem = (await import("@tiptap/extension-task-item")).default;
const SCHEMA = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3] } }), TaskList, TaskItem.configure({ nested: true })]);
test("inhoud: knopen en marks bestaan in het schema van de editor", () => {
  for (const type of ["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "blockquote", "codeBlock", "horizontalRule", "hardBreak"]) {
    assert.ok(SCHEMA.nodes[type], type);
  }
  for (const m of ["bold", "italic", "strike", "code", "underline", "link"]) assert.ok(SCHEMA.marks[m], m);
});
test("inhoud: opgeschoond document is geldig in het schema (ook na rommelige invoer)", () => {
  const rommel = doc(
    { type: "heading", attrs: { level: 7 }, content: [t("Kop", [{ type: "link", attrs: { href: "javascript:x" } }])] },
    { type: "onbekend", content: [p(t("weg"))] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("a")), { type: "taskList", content: [{ type: "taskItem", content: [p(t("genest"))] }] }] }] },
    { type: "orderedList", attrs: { start: 1, type: null }, content: [{ type: "listItem", content: [p(t("b", [{ type: "link", attrs: { href: "https://x.nl", class: null } }]))] }] },
    { type: "codeBlock", attrs: { language: null }, content: [t("x")] },
    { type: "horizontalRule" },
    p(),
  );
  const schoon = K.schoonInhoud(rommel);
  assert.doesNotThrow(() => SCHEMA.nodeFromJSON(schoon).check());
  assert.doesNotThrow(() => SCHEMA.nodeFromJSON(K.schoonInhoud({ type: "doc", content: [] })).check());
  // Wat de editor zelf maakt, blijft (op standaardwaarden na) gelijk na opschonen.
  const terug = SCHEMA.nodeFromJSON(schoon).toJSON();
  assert.deepEqual(K.schoonInhoud(terug), schoon);
});
test("inhoud: geen prototype-vervuiling via type", () => {
  assert.deepEqual(K.schoonInhoud(doc({ type: "__proto__" }, { type: "constructor" }, { type: "toString" })), doc({ type: "paragraph" }));
});

// ---------------------------------------------------------------------------------
// Platte tekst en fragment
// ---------------------------------------------------------------------------------
test("platte tekst: blokken op eigen regels, afvinkpunten, harde regelovergang", () => {
  const d = doc(
    { type: "heading", attrs: { level: 1 }, content: [t("Brainstorm")] },
    p(t("Eerste "), t("idee", [{ type: "bold" }])),
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("Logo"))] }, { type: "taskItem", attrs: { checked: false }, content: [p(t("Kleuren"))] }] },
    { type: "horizontalRule" },
    p(t("regel 1"), { type: "hardBreak" }, t("regel 2")),
  );
  assert.equal(K.platteTekst(d), "Brainstorm\nEerste idee\n[x] Logo\n[ ] Kleuren\nregel 1\nregel 2");
  assert.equal(K.parseNotitie({ inhoud: d }, false).waarde.inhoud_tekst, K.platteTekst(d));
  assert.equal(K.platteTekst(null), "");
});
test("fragment: witruimte samengevoegd, afgekapt op een woord", () => {
  assert.equal(K.maakFragment("  a \n b  "), "a b");
  const f = K.maakFragment("woord ".repeat(60), 40);
  assert.ok(f.length <= 41 && f.endsWith("…") && !f.includes("  "));
});

// ---------------------------------------------------------------------------------
// Zoeken, filteren, sorteren
// ---------------------------------------------------------------------------------
const n = (o) => ({ id: "x", titel: "", emoji: null, fragment: "", klant: null, project: null, prive: false, vastgepind: false, gemaaktDoor: "a", bewerktDoor: "a", gemaaktOp: "2026-10-01T10:00:00Z", bewerktOp: "2026-10-01T10:00:00Z", ...o });
test("zoeken: zonder accenten en hoofdletters, alle termen, ook klant/project", () => {
  const notitie = n({ titel: "Ideeën huisstijl", fragment: "Kleuren en LOGO", klant: { id: UUID, naam: "Bakkerij Één", lead: true } });
  assert.equal(K.pastBijZoek(notitie, "ideeen logo"), true);
  assert.equal(K.pastBijZoek(notitie, "bakkerij een"), true);
  assert.equal(K.pastBijZoek(notitie, "logo typografie"), false);
  assert.equal(K.pastBijZoek(notitie, "   "), true);
});
test("zoektermen voor de database: geen jokertekens of scheidingstekens", () => {
  assert.deepEqual(K.dbZoekTermen("logo, (rood)* %_ a.b@c-d"), ["logo", "rood", "a.b@c-d"]);
  assert.deepEqual(K.dbZoekTermen("één"), ["één"]);
  assert.equal(K.dbZoekTermen("a b c d e f g h").length, 6);
  for (const term of K.dbZoekTermen('x"),titel.neq.y y*,z')) assert.ok(!/[,()*"%]/.test(term), term);
});
test("filter: mijn, klant, project, privé", () => {
  const lijst = [n({ id: "1", gemaaktDoor: "ik" }), n({ id: "2", klant: { id: UUID, naam: "K", lead: false } }), n({ id: "3", project: { id: UUID, naam: "P" } }), n({ id: "4", prive: true, gemaaktDoor: "ik" })];
  const ids = (f) => lijst.filter((x) => K.pastBijFilter(x, f, "ik")).map((x) => x.id).join(",");
  assert.equal(ids("alles"), "1,2,3,4");
  assert.equal(ids("mijn"), "1,4");
  assert.equal(ids("klant"), "2");
  assert.equal(ids("project"), "3");
  assert.equal(ids("prive"), "4");
  assert.deepEqual(K.NOTITIE_FILTERS, ["alles", "mijn", "klant", "project", "prive"]);
});
test("sorteren: vastgepind eerst, dan laatst bewerkt, stabiel", () => {
  const lijst = [
    n({ id: "a", bewerktOp: "2026-10-01T10:00:00Z" }),
    n({ id: "b", bewerktOp: "2026-10-03T10:00:00Z" }),
    n({ id: "c", bewerktOp: "2026-09-01T10:00:00Z", vastgepind: true }),
    n({ id: "d", bewerktOp: "2026-10-03T10:00:00Z" }),
  ];
  assert.deepEqual(K.sorteerNotities(lijst).map((x) => x.id), ["c", "b", "d", "a"]);
  assert.equal(lijst[0].id, "a", "origineel niet gewijzigd");
});
test("weergavetitel: titel of Naamloos", () => {
  assert.equal(K.weergaveTitel(n({ titel: "  Plan " })), "Plan");
  assert.equal(K.weergaveTitel(n({ titel: " " })), "Naamloos");
});

// ---------------------------------------------------------------------------------
// Bron
// ---------------------------------------------------------------------------------
test("pagina en API-routes via de teamcheck", () => {
  const pagina = lees("app/(app)/scratchpad/page.tsx");
  assert.ok(pagina.indexOf("vereisTeamlidPagina(") > 0 && pagina.indexOf("vereisTeamlidPagina(") < pagina.indexOf("notitiesLijst("));
  for (const f of ["app/api/notities/route.ts", "app/api/notities/[id]/route.ts"]) {
    const src = lees(f);
    const methoden = [...src.matchAll(/export const (GET|POST|PATCH|DELETE|PUT)\b/g)].map((m) => m[1]);
    assert.ok(methoden.length > 0, f);
    for (const m of methoden) assert.match(src, new RegExp(`export const ${m} = teamlidRoute\\(`), `${f} ${m}`);
    assert.ok(!/createServiceRoleClient|service-role/.test(src), `${f}: geen service-role`);
  }
  assert.ok(!/createServiceRoleClient/.test(lees("lib/notities/repo.ts")), "repo zonder service-role");
});
test("inhoud nooit als losse HTML (geen dangerouslySetInnerHTML/innerHTML)", () => {
  const map = path.join(ROOT, "components", "notities");
  const bestanden = fs.readdirSync(map).map((f) => `components/notities/${f}`);
  bestanden.push("components/dashboard/ScratchpadWidget.tsx", "app/(app)/scratchpad/page.tsx");
  for (const f of bestanden) assert.ok(!/dangerouslySetInnerHTML|innerHTML|insertContent\(\s*['"`]</.test(lees(f)), f);
  assert.match(lees("components/notities/Editor.tsx"), /isAllowedUri: \(url\) => veiligeLink\(url\) !== null/);
});
test("migratie 0031 = UITVOEREN_0031.sql, met RLS via is_teamlid() en controle", () => {
  const m = lees("supabase/migrations/0031_scratchpad.sql");
  assert.equal(m, lees("supabase/UITVOEREN_0031.sql"));
  assert.match(m, /create table if not exists public\.notities/);
  assert.match(m, /enable row level security/);
  assert.equal((m.match(/create policy /g) || []).length, 4);
  assert.equal((m.match(/drop policy if exists /g) || []).length, 4);
  assert.ok(!/auth\.uid\(\)\s+is not null/i.test(m), "geen open policy");
  assert.match(m, /not prive or created_by = \(select auth\.uid\(\)\)/);
  assert.match(m, /octet_length\(inhoud::text\) <= 1048576/);
  assert.match(m, /on delete set null/);
  assert.match(m, /select 'notities' as onderdeel/);
  assert.match(m, /revoke all on public\.notities from anon/);
});
test("module Scratchpad in de rail, met eigen icoon", () => {
  const modules = lees("lib/modules.ts");
  assert.match(modules, /id: 'scratchpad',[\s\S]*?href: '\/scratchpad',[\s\S]*?icoon: 'scratchpad'/);
  assert.match(lees("lib/shell/iconen.ts"), /scratchpad:/);
});
test("back-up: notities in de vaste tabellenlijst (fragment niet schrijven)", () => {
  assert.match(lees("lib/backup/formaat-kern.ts"), /\{ naam: 'notities', pk: \['id'\], zonder: \['fragment'\] \}/);
});
test("dashboard, klant- en projectpagina tonen de Scratchpad", () => {
  const dash = lees("app/(app)/page.tsx");
  assert.match(dash, /<Suspense fallback=\{<KaartSkelet label="Scratchpad"[^>]*\/>\}>\s*<ScratchpadWidget lid=\{lid\} \/>/);
  assert.match(lees("components/crm/KlantInhoud.tsx"), /<NotitiesBlok koppeling=\{\{ klant: klant\.id \}\} \/>/);
  assert.match(lees("components/crm/ProjectInhoud.tsx"), /<NotitiesBlok koppeling=\{\{ project: project\.id \}\} \/>/);
  assert.match(lees("app/(app)/layout.tsx"), /import '\.\/notities\.css';/);
});
test("zelfdeInhoud: editor-JSON en database-JSON (andere sleutelvolgorde, extra attributen) zijn gelijk", () => {
  const editor = doc(
    { type: "codeBlock", attrs: { language: null }, content: [t("x = 1")] },
    p(t("zie ", undefined), t("site", [{ type: "link", attrs: { href: "https://a.nl", target: "_blank", rel: "noopener noreferrer nofollow", class: null } }])),
  );
  const db = { content: [{ content: [{ text: "x = 1", type: "text" }], type: "codeBlock" }, { type: "paragraph", content: [{ text: "zie ", type: "text" }, { marks: [{ attrs: { rel: "noopener noreferrer nofollow", href: "https://a.nl", target: "_blank" }, type: "link" }], text: "site", type: "text" }] }], type: "doc" };
  assert.equal(K.zelfdeInhoud(editor, db), true);
  assert.equal(K.zelfdeInhoud(editor, doc(p(t("anders")))), false);
});
test("autosave: concept terugzetten wordt ook verstuurd als de nieuwe editor er nog niet is", () => {
  const scherm = lees("components/notities/NotitieScherm.tsx");
  assert.match(scherm, /huidigeInhoud\(\) \?\? geladen\.current/);
  assert.match(scherm, /zelfdeInhoud\(c\.inhoud, notitie\.inhoud\)/);
});
test("autosave: vertraging, flush bij verlaten, concept wissen bij uitloggen", () => {
  const scherm = lees("components/notities/NotitieScherm.tsx");
  assert.match(scherm, /const VERTRAGING = 800;/);
  assert.match(scherm, /'pagehide'/);
  assert.match(scherm, /'visibilitychange'/);
  assert.match(scherm, /keepalive/);
  assert.match(lees("public/shell/shell.js"), /startsWith\("sl-notitie-concept:"\)/);
});

// ---------- bijlagen (0032) ----------
const NID = "a1a1a1a1-0000-4000-8000-000000000001";
const BID = "b2b2b2b2-0000-4000-8000-000000000002";
const EIGEN = `/api/notities/${NID}/bestanden/${BID}`;
test("foto: alleen de eigen bijlage-route, maat begrensd", () => {
  const doc = (attrs) => K.schoonInhoud({ type: "doc", content: [{ type: "image", attrs }] }).content[0];
  assert.deepEqual(doc({ src: EIGEN, alt: "foto.jpg", width: 320.4, height: 99999, title: "x", onerror: "alert(1)" }), {
    type: "image",
    attrs: { src: EIGEN, alt: "foto.jpg", width: 320, height: null },
  });
  for (const src of ["https://evil.example/x.png", "data:image/png;base64,AAAA", "javascript:alert(1)", `${EIGEN}?x=1`, `//evil${EIGEN}`, null]) {
    assert.equal(doc({ src }).type, "paragraph", String(src));
  }
});
test("bestandskaartje: naam, type en grootte opgeschoond; zonder geldige src weg", () => {
  const k = K.schoonInhoud({
    type: "doc",
    content: [
      { type: "bijlage", attrs: { src: EIGEN, naam: "../../<b>offerte</b>.pdf", type: "Application/PDF", grootte: "2048" }, content: [{ type: "text", text: "x" }] },
      { type: "bijlage", attrs: { src: "https://evil.example/a.exe", naam: "a.exe" } },
    ],
  });
  assert.equal(k.content.length, 1);
  assert.deepEqual(k.content[0], { type: "bijlage", attrs: { src: EIGEN, naam: "b.pdf", type: "application/pdf", grootte: 2048 } });
  assert.match(K.platteTekst(k), /b\.pdf/);
});
test("bijlage-paden: per notitie, vast formaat", () => {
  const pad = K.bijlagePad(NID, "Offerte Café 2026.PDF", 1761700000000, "0a1b2c3d");
  assert.equal(pad, `${NID}/1761700000000-0a1b2c3d-offerte-cafe-2026.pdf`);
  assert.ok(K.isBijlagePadVan(NID, pad));
  assert.ok(!K.isBijlagePadVan(BID, pad));
  assert.ok(!K.isBijlagePadVan(NID, `${NID}/../x/1761700000000-0a1b2c3d-a.pdf`));
  assert.equal(K.bijlagePad(NID, "zonder-extensie", 1, "00000000").split(".").pop(), "bin");
  assert.equal(K.schoonType("text/html<script>"), "application/octet-stream");
  assert.equal(K.leesbareGrootte(2_500_000), "2,4 MB");
  assert.ok(K.isAfbeelding("image/PNG") && !K.isAfbeelding("image/svg+xml"));
});

console.log(`test-notities: ${fout ? `FOUTEN (${goed} geslaagd, ${fout} mislukt)` : `${goed} geslaagd`}`);
if (fout) process.exit(1);
