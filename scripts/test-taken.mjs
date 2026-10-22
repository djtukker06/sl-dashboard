// Tests voor taken op naam, zonder database en zonder netwerk:
//   - lib/agenda/teaminvoer.ts: voor wie (teamleden), subtaken, projecten en de regel
//     "project hoort bij de klant";
//   - lib/agenda/rechten.ts: wie een taak/afspraak mag wijzigen (zelfde regel als de RLS
//     van migratie 0021) en de namenlijst in meldingen.
//
// Gebruik:  node scripts/test-taken.mjs
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// TS laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
let inv, rechten;
try {
  inv = await import(pathToFileURL(path.join(ROOT, "lib", "agenda", "teaminvoer.ts")).href);
  rechten = await import(pathToFileURL(path.join(ROOT, "lib", "agenda", "rechten.ts")).href);
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

console.log(`test-taken: ${goed} geslaagd${process.exitCode ? ", met fouten" : ""}`);
