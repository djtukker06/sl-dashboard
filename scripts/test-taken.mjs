// Tests voor taken op naam, zonder database en zonder netwerk:
//   - lib/agenda/teaminvoer.ts: voor wie (teamleden), subtaken, projecten en de regel
//     "project hoort bij de klant";
//   - lib/agenda/rechten.ts: wie een taak/afspraak mag wijzigen (zelfde regel als de RLS
//     van migratie 0021) en de namenlijst in meldingen;
//   - lib/agenda/zichtbaarheid.ts: "mijn taak" vs. "uitgezet" en de groepen van de tab
//     Uitgezet (0022, stap 2);
//   - bronbewaking: geen teamweergave meer ("Heel team", ?wie=…, WieFilter) en de
//     lijst-/agenda-API kan niet de taken van een ander opvragen.
//
// Gebruik:  node scripts/test-taken.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// TS laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
let inv, rechten, zicht;
try {
  inv = await import(pathToFileURL(path.join(ROOT, "lib", "agenda", "teaminvoer.ts")).href);
  rechten = await import(pathToFileURL(path.join(ROOT, "lib", "agenda", "rechten.ts")).href);
  zicht = await import(pathToFileURL(path.join(ROOT, "lib", "agenda", "zichtbaarheid.ts")).href);
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

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const K1 = "33333333-3333-4333-8333-333333333333";
const K2 = "44444444-4444-4444-8444-444444444444";

// ---------- voor wie ----------
test("één persoon", () => assert.deepEqual(inv.parsePersonen([A]), { ok: true, waarde: [A] }));
test("meerdere personen, dubbelen eruit", () => assert.deepEqual(inv.parsePersonen([A, B, A]).waarde, [A, B]));
test("hoofdletters worden kleine letters", () => assert.deepEqual(inv.parsePersonen([A.toUpperCase()]).waarde, [A]));
test("lege lijst geweigerd", () => assert.equal(inv.parsePersonen([]).ok, false));
test("geen lijst geweigerd", () => assert.equal(inv.parsePersonen("abc").ok, false));
test("ongeldige id geweigerd", () => assert.equal(inv.parsePersonen([A, "robert'); drop table tasks;--"]).ok, false));
test("te veel personen geweigerd", () =>
  assert.equal(inv.parsePersonen(Array.from({ length: 21 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`)).ok, false));
test("melding noemt deelnemer bij afspraken", () => assert.match(inv.parsePersonen([], "deelnemer").fout, /deelnemer/));

// ---------- subtaken ----------
test("subtaken: lege regels vallen weg, witruimte samengevoegd", () =>
  assert.deepEqual(inv.parseSubtaken(["  Offerte  maken ", "", "   ", "Bellen"]).waarde, ["Offerte maken", "Bellen"]));
test("subtaken: geen subtaken mag", () => assert.deepEqual(inv.parseSubtaken(undefined), { ok: true, waarde: [] }));
test("subtaken: maximaal 50", () => assert.equal(inv.parseSubtaken(Array.from({ length: 51 }, (_, i) => `Stap ${i}`)).ok, false));
test("subtaken: 50 mag", () => assert.equal(inv.parseSubtaken(Array.from({ length: 50 }, (_, i) => `Stap ${i}`)).ok, true));
test("subtaak: maximaal 200 tekens", () => assert.equal(inv.parseSubtaakTitel("x".repeat(201)).ok, false));
test("subtaak: geen tekst geweigerd", () => assert.equal(inv.parseSubtaakTitel(42).ok, false));
test("subtaak afvinken zet klaar_op en klaar_door", () => {
  const r = inv.parseSubtaakWijziging({ klaar: true }, A);
  assert.equal(r.ok, true);
  assert.equal(r.waarde.klaar_door, A);
  assert.ok(Date.parse(r.waarde.klaar_op) > 0);
});
test("subtaak heropenen wist klaar_op en klaar_door", () =>
  assert.deepEqual(inv.parseSubtaakWijziging({ klaar: false }, A).waarde, { klaar_op: null, klaar_door: null }));
test("subtaak: ongeldige volgorde", () => assert.equal(inv.parseSubtaakWijziging({ volgorde: -1 }, A).ok, false));
test("subtaak: lege wijziging geweigerd", () => assert.equal(inv.parseSubtaakWijziging({}, A).ok, false));
test("subtaak: klaar moet boolean zijn", () => assert.equal(inv.parseSubtaakWijziging({ klaar: "ja" }, A).ok, false));

// ---------- projecten ----------
test("project: naam verplicht bij nieuw", () => assert.equal(inv.parseProject({}, true).ok, false));
test("project: naam wordt opgeschoond", () => assert.equal(inv.parseProject({ naam: "  Huisstijl   2027 " }, true).waarde.naam, "Huisstijl 2027"));
test("project: te lange naam", () => assert.equal(inv.parseProject({ naam: "x".repeat(121) }, true).ok, false));
test("project: ongeldige klant", () => assert.equal(inv.parseProject({ naam: "A", klantId: "x" }, true).ok, false));
test("project: archiveren", () => assert.deepEqual(inv.parseProject({ status: "gearchiveerd" }, false).waarde, { status: "gearchiveerd" }));
test("project: onbekende status", () => assert.equal(inv.parseProject({ status: "weg" }, false).ok, false));
test("project: lege wijziging geweigerd", () => assert.equal(inv.parseProject({}, false).ok, false));

// ---------- klant ↔ project ----------
test("project zonder klant past bij elke klant", () => assert.deepEqual(inv.klantBijProject(K1, { klantId: null }), { ok: true, waarde: K1 }));
test("project vult een lege klant in", () => assert.deepEqual(inv.klantBijProject(null, { klantId: K1 }), { ok: true, waarde: K1 }));
test("zelfde klant: goed", () => assert.deepEqual(inv.klantBijProject(K1, { klantId: K1 }), { ok: true, waarde: K1 }));
test("project van een andere klant: fout", () => assert.equal(inv.klantBijProject(K2, { klantId: K1 }).ok, false));
test("geen project: klant blijft", () => assert.deepEqual(inv.klantBijProject(null, null), { ok: true, waarde: null }));

// ---------- rechten ----------
const taak = (maker, toegewezen) => ({ aangemaaktDoor: maker, toegewezen });
test("maker mag wijzigen", () => assert.equal(rechten.magTaakWijzigen(taak(A, [B]), A, false), true));
test("toegewezene mag wijzigen", () => assert.equal(rechten.magTaakWijzigen(taak(A, [B]), B, false), true));
test("ander teamlid mag niet wijzigen", () => assert.equal(rechten.magTaakWijzigen(taak(A, [A]), B, false), false));
test("vóór 0021 (overgang) mag iedereen", () => assert.equal(rechten.magTaakWijzigen(taak(null, []), B, true), true));
test("afspraak: deelnemer mag wijzigen", () =>
  assert.equal(rechten.magAfspraakWijzigen({ aangemaaktDoor: A, deelnemers: [A, B] }, B, false), true));
test("afspraak: buitenstaander niet", () => assert.equal(rechten.magAfspraakWijzigen({ aangemaaktDoor: A, deelnemers: [A] }, B, false), false));
test("namenlijst", () => {
  assert.equal(rechten.namenLijst(["jou"]), "jou");
  assert.equal(rechten.namenLijst(["Daniel", "Mark"]), "Daniel en Mark");
  assert.equal(rechten.namenLijst(["jou", "Mark", "Eva"]), "jou, Mark en Eva");
});

// ---------- wie ziet welke taak (0022) ----------
const C = "55555555-5555-4555-8555-555555555555";
const t2 = (maker, toegewezen, afgerond = false, id = "x") => ({ id, aangemaaktDoor: maker, toegewezen, afgerond });
test("Daniel maakt voor Bram: niet op Daniels naam, wel uitgezet", () => {
  const t = t2(A, [B]);
  assert.equal(zicht.opMijnNaam(t, A), false);
  assert.equal(zicht.isUitgezet(t, A), true);
  assert.equal(zicht.opMijnNaam(t, B), true);
  assert.equal(zicht.isUitgezet(t, B), false);
});
test("taak voor twee: bij beiden, niet uitgezet", () => {
  const t = t2(A, [A, B]);
  assert.equal(zicht.opMijnNaam(t, A) && zicht.opMijnNaam(t, B), true);
  assert.equal(zicht.isUitgezet(t, A), false);
});
test("taak van een ander voor een derde: niet van mij, niet uitgezet door mij", () => {
  const t = t2(B, [C]);
  assert.equal(zicht.opMijnNaam(t, A), false);
  assert.equal(zicht.isUitgezet(t, A), false);
});
test("vóór 0021 (overgang): alles op mijn naam", () => assert.equal(zicht.opMijnNaam(t2(null, []), A, true), true));
test("Uitgezet: groepen per persoon, klaar onderaan", () => {
  const g = zicht.groepeerUitgezet([t2(A, [B], true, "1"), t2(A, [B], false, "2"), t2(A, [C, B], false, "3"), t2(A, [B], false, "4")], A);
  assert.deepEqual(
    g.map((x) => [x.sleutel, x.klaar, x.taken.map((t) => t.id)]),
    [
      [`p:${B}`, false, ["2", "4"]],
      [`p:${[B, C].sort().join(",")}`, false, ["3"]],
      ["~klaar", true, ["1"]],
    ],
  );
});
test("Uitgezet: mijzelf telt niet mee in de groep", () =>
  assert.deepEqual(zicht.groepeerUitgezet([t2(A, [B, A])], A)[0].personen, [B]));

// ---------- bronbewaking: geen teamweergave ----------
const bron = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const bestaat = (p) => fs.existsSync(path.join(ROOT, p));
test("WieFilter en wieKleur zijn weg", () => {
  assert.equal(bestaat("components/agenda/WieFilter.tsx"), false);
  assert.equal(bestaat("components/agenda/wieKleur.ts"), false);
});
function alleBronnen(map) {
  const uit = [];
  for (const e of fs.readdirSync(path.join(ROOT, map), { withFileTypes: true })) {
    const p = path.join(map, e.name);
    if (e.isDirectory()) uit.push(...alleBronnen(p));
    else if (/\.(tsx?|css)$/.test(e.name)) uit.push(p);
  }
  return uit;
}
test("nergens nog een knop 'Heel team' of een link met ?wie=", () => {
  const fout = [];
  for (const p of [...alleBronnen("app"), ...alleBronnen("components")]) {
    const s = bron(p);
    if (/>\s*Heel team\s*</.test(s) || /[?&]wie=/.test(s.replace(/\/\/.*$/gm, ""))) fout.push(p);
  }
  assert.deepEqual(fout, []);
});
test("API agenda/taken leest geen 'wie' en geen ander user-id", () => {
  for (const p of ["app/api/agenda/route.ts", "app/api/taken/route.ts"]) {
    const s = bron(p).replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(s, /get\(['"]wie['"]\)|leesWie/, p);
  }
  assert.doesNotMatch(bron("lib/agenda/api.ts"), /leesWie/);
});
test("repo: persoonVoor heeft geen persoon-parameter meer (altijd jijzelf)", () =>
  assert.match(bron("lib/agenda/repo.ts"), /export function persoonVoor\(bron: AgendaBron\): string \| null \{\s*return bron\.team \? bron\.userId : null;/));
test("dashboard: geen taakrijen van anderen, alleen het aantal uitgezet", () => {
  const s = bron("components/dashboard/Planning.tsx");
  assert.doesNotMatch(s, /Uitgedeeld|uitgedeeld/);
  assert.match(s, /\/agenda\?lijst=uitgezet/);
});
test("Uitgezet filtert in SQL (anti-join), niet achteraf in JS", () => {
  const s = bron("lib/agenda/repo.ts");
  assert.match(s, /\.eq\('mij\.user_id', bron\.userId\)\s*\.is\('mij', null\)/);
  assert.doesNotMatch(s, /export async function uitgedeeld/);
});
test("0022: leesregels op taken/afspraken, geen 'teamleden lezen taken' meer", () => {
  const s = bron("supabase/migrations/0022_team_crm.sql");
  for (const p of ["betrokkenen lezen taken", "betrokkenen lezen toewijzingen", "betrokkenen lezen subtaken", "betrokkenen lezen afspraken", "betrokkenen lezen deelnemers"]) {
    assert.match(s, new RegExp(`create policy "${p}"`));
  }
  assert.match(s, /drop policy if exists "teamleden lezen taken" on public\.tasks/);
});

console.log(`test-taken: ${goed} geslaagd${process.exitCode ? ", met fouten" : ""}`);
