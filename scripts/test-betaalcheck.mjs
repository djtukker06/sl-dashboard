// Tests voor de betaalstatus en de betaalcheck (migratie 0037), zonder database en netwerk:
//   - lib/boekhouding/kern/betaalcheck.ts: betaald/deels/open met betaaldatum, omzet (alleen
//     helemaal betaald) en nog te ontvangen, en welke facturen de pop-up navraagt;
//   - bron: de route gaat via de teamcheck en het vinkje Boekhouding, boekt niet zelf, en de
//     migratie is veilig om opnieuw uit te voeren.
//   node --experimental-strip-types scripts/test-betaalcheck.mjs
import fs from "node:fs";
import assert from "node:assert/strict";
import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (/^\\.\\.?\\//.test(spec) && !/\\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.endsWith('.ts')) return next(spec + '.ts', ctx);
  return next(spec, ctx);
}`),
  import.meta.url
);
const K = await import("../lib/boekhouding/kern/betaalcheck.ts");

let geslaagd = 0;
let mislukt = 0;
function test(naam, fn) {
  try {
    fn();
    geslaagd++;
  } catch (e) {
    mislukt++;
    console.error(`✗ ${naam}\n  ${e.message}`);
  }
}
const lees = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const k = (boekingId, bedrag) => ({ id: `k-${boekingId}`, boekingId, bron: "factuur", bronId: "f", bedrag, aangemaakt: "" });
const datums = new Map([["b1", "2026-11-02"], ["b2", "2026-11-10"]]);

test("betaalinfo: open, deels en betaald met de datum van de laatste bankregel", () => {
  const open = K.betaalInfoVan({ status: "open", totaal: 10000, betaald: 0, open: 10000, koppelingen: [] }, datums);
  assert.deepEqual(open, { stand: "open", totaal: 10000, betaald: 0, open: 10000, betaaldOp: null });
  const deels = K.betaalInfoVan({ status: "deels", totaal: 10000, betaald: 4000, open: 6000, koppelingen: [k("b1", 4000)] }, datums);
  assert.equal(deels.stand, "deels");
  assert.equal(deels.open, 6000);
  assert.equal(deels.betaaldOp, "2026-11-02");
  const betaald = K.betaalInfoVan({ status: "betaald", totaal: 10000, betaald: 10000, open: 0, koppelingen: [k("b2", 6000), k("b1", 4000)] }, datums);
  assert.equal(betaald.stand, "betaald");
  assert.equal(betaald.betaaldOp, "2026-11-10");
});
test("betaalinfo: te veel betaald telt als betaald (niets meer open)", () => {
  const i = K.betaalInfoVan({ status: "te_veel", totaal: 10000, betaald: 12000, open: -2000, koppelingen: [k("b1", 12000)] }, datums);
  assert.equal(i.stand, "betaald");
  assert.equal(i.open, 0);
});
test("betaalinfo: een bankregel die niet (meer) bestaat geeft geen datum", () => {
  const i = K.betaalInfoVan({ status: "betaald", totaal: 500, betaald: 500, open: 0, koppelingen: [k("weg", 500)] }, datums);
  assert.equal(i.betaaldOp, null);
});

const info = (stand, totaal, open) => ({ stand, totaal, betaald: totaal - open, open, betaaldOp: null });
test("omzet: alleen helemaal betaalde facturen; deels betaald telt niet mee", () => {
  const facturen = [
    { id: "a", omzet: 10000, totaal: 12100 },
    { id: "b", omzet: 20000, totaal: 24200 },
    { id: "c", omzet: 5000, totaal: 6050 },
    { id: "d", omzet: 1000, totaal: 1210 }
  ];
  const m = new Map([
    ["a", info("betaald", 12100, 0)],
    ["b", info("deels", 24200, 14200)],
    ["c", info("open", 6050, 6050)]
    // d: geen info → open met het hele totaal
  ]);
  const o = K.omzetOverzicht(facturen, m);
  assert.equal(o.betaaldeOmzet, 10000);
  assert.equal(o.gefactureerd, 36000);
  assert.equal(o.teOntvangen, 14200 + 6050 + 1210);
  assert.equal(o.aantalOpen, 3);
});

const f = (over) => ({ id: "f1", datum: "2026-11-01", verzonden: null, checkNa: null, totaal: 331225, ...over });
const open = info("open", 331225, 331225);
test("check: een week na de factuurdatum, of na verzonden_op als die er is", () => {
  assert.equal(K.moetChecken(f(), open, "2026-11-07"), false);
  assert.equal(K.moetChecken(f(), open, "2026-11-08"), true);
  assert.equal(K.moetChecken(f({ verzonden: "2026-11-05" }), open, "2026-11-08"), false);
  assert.equal(K.moetChecken(f({ verzonden: "2026-11-05" }), open, "2026-11-12"), true);
});
test("check: na Nee pas weer op betaalcheck_na", () => {
  assert.equal(K.volgendeCheck("2026-11-17"), "2026-11-24");
  assert.equal(K.moetChecken(f({ checkNa: "2026-11-24" }), open, "2026-11-23"), false);
  assert.equal(K.moetChecken(f({ checkNa: "2026-11-24" }), open, "2026-11-24"), true);
});
test("check: niet bij betaald, € 0 of negatief, of ouder dan een jaar; wel bij deels", () => {
  assert.equal(K.moetChecken(f(), info("betaald", 331225, 0), "2026-11-17"), false);
  assert.equal(K.moetChecken(f({ totaal: 0 }), info("open", 0, 0), "2026-11-17"), false);
  assert.equal(K.moetChecken(f({ totaal: -5000 }), info("open", -5000, -5000), "2026-11-17"), false);
  assert.equal(K.moetChecken(f({ datum: "2025-11-01" }), open, "2026-11-17"), false);
  assert.equal(K.moetChecken(f({ datum: "2025-11-20" }), open, "2026-11-17"), true);
  assert.equal(K.moetChecken(f(), info("deels", 331225, 100000), "2026-11-17"), true);
  assert.equal(K.moetChecken(f(), undefined, "2026-11-17"), false);
});
test("teChecken: oudste (verstuurd) eerst, alleen wat aan de beurt is", () => {
  const lijst = [
    f({ id: "nieuw", datum: "2026-11-15" }),
    f({ id: "b", datum: "2026-10-01", verzonden: "2026-10-20" }),
    f({ id: "a", datum: "2026-10-10" }),
    f({ id: "betaald", datum: "2026-09-01" })
  ];
  const m = new Map(lijst.map((x) => [x.id, x.id === "betaald" ? info("betaald", 331225, 0) : open]));
  assert.deepEqual(K.teChecken(lijst, m, "2026-11-17").map((x) => x.id), ["a", "b"]);
});

test("bron: route met teamcheck, vinkje Boekhouding en zonder eigen boeklogica", () => {
  const r = lees("app/api/facturen/betaalcheck/route.ts");
  assert.match(r, /controleerRoute\(request\)/);
  assert.ok((r.match(/lid\.boekhouding/g) ?? []).length >= 2, "GET en POST controleren het vinkje Boekhouding");
  assert.doesNotMatch(r, /koppelingToevoegen|boekingToevoegen/);
  assert.match(r, /kolom_ontbreekt/);
  const s = lees("lib/boekhouding/betaalstatus.ts");
  assert.match(s, /if \(!lid\.boekhouding/);
  assert.match(s, /'demo'\) return null/);
  const v = lees("components/facturen/BetaalFormulier.tsx");
  assert.match(v, /\/api\/boekhouding\/koppelingen\/betaald/);
});
test("bron: migratie 0037 is veilig om opnieuw uit te voeren en gelijk aan UITVOEREN_0037", () => {
  const m = lees("supabase/migrations/0037_betaalcheck.sql");
  assert.match(m, /add column if not exists betaalcheck_na date/);
  assert.equal(m, lees("supabase/UITVOEREN_0037.sql"));
});

console.log(`${geslaagd} geslaagd, ${mislukt} mislukt`);
if (mislukt) process.exit(1);
