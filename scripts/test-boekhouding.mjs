// Tests voor de rekenregels van de boekhouding, zonder database en zonder netwerk:
//   - kern/geld.ts      centen parsen (NL en punt-notatie), afronden half weg van nul,
//                       formatteren, exact verdelen;
//   - kern/btw.ts       btw uit incl./excl. (21/9/0), alle codes → rubrieken, verlegging
//                       (verschuldigd én aftrekbaar), handmatige btw met waarschuwing;
//   - kern/periode.ts   kwartalen, NL-tijdgrens, deadlines, vergrendeling;
//   - model.ts          invoercontrole, vergrendelregels (zoals de trigger in 0027), lopend
//                       saldo, totalen, IBAN;
//   - kern/journaal.ts  elke boeking is een sluitende journaalpost, met de juiste rekeningen;
//   - demo              de seed: alles sluit, saldi kloppen met het journaal, btw-betalingen
//                       gelijk aan het kwartaalsaldo, niets in de toekomst; de demo-opslag
//                       importeert geen Supabase, houdt teamleden gescheiden en volgt de
//                       vergrendeling.
//   Stap 2:
//   - kern/bronnen.ts   facturen/bonnetjes uit databaserijen (tekst → centen, NL-dag), btw-code
//                       (verlegd EU → 3b), categorie → grootboek;
//   - journaal          factuur (21%, verlegd, doorberekend, creditnota, aanbetaling+rest),
//                       bonnetje (zakelijk/privé/contant/verlegd/activeren), een gekoppelde
//                       bankregel is alleen een betaling: omzet en btw veranderen niet;
//   - kern/afletteren   openstaand/deels/betaald, ouderdom, suggesties, koppelregels (ook
//                       vergrendeling), overboekingen paren, bon ontbreekt, verweesd;
//   - kern/bankimport   CSV (aanhalingstekens, BOM, scheidingsteken), datums, RegioBank- en
//                       Revolut-fixtures (alleen COMPLETED, fee apart, valuta), generiek met
//                       kolomkeuze, unieke sleutels, voorstel uit de geschiedenis;
//   - demo              facturen/bonnetjes/koppelingen: debiteuren = open facturen, opnieuw
//                       importeren geeft 0 nieuwe regels.
//   Stap 3:
//   - kern/afschrijving lineair per maand (laatste maand corrigeert), vrije termijn, restwaarde,
//                       boekwaarde op datum, desinvestering (boekwinst/-verlies), activastaat
//                       sluit, invoercontrole, hints (€ 450, fiscaal 5 jaar), vergrendeling;
//   - journaal          activa: inbreng, afschrijving per maand, desinvestering; een
//                       geactiveerde aankoop gaat naar de balans (niet dubbel als kosten);
//                       btw-afsluitpost per ingediende aangifte (1530 = aangegeven bedrag,
//                       afronding naar 8900, betaling maakt 1530 nul, drift blijft staan);
//   - kern/aangifte     rubrieken 1a–4b uit het journaal, hele euro's in je voordeel, 5a/5b/5c,
//                       vergelijking met de ingediende versie (volgende aangifte/suppletie),
//                       kwartaalstatus, betaalcontrole;
//   - kern/activeren    bron van een activum (bankregel/bonnetje), bedrag ≤ excl., voorstellen;
//   - kern/btw-controles  te verwerken, bon ontbreekt, ICP, verlegd 1e, eerdere kwartalen;
//   - demo              ingediende aangiften = herberekening, betalingen gekoppeld, 1530 = 0;
//                       indienen/intrekken/betaling/activa in de demo-opslag.
//
// Gebruik:  node scripts/test-boekhouding.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// TS laden (type-stripping, Node >= 22.6); zo nodig opnieuw starten met de vlag. Relatieve
// imports zonder extensie krijgen via een resolve-hook '.ts' erachter.
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

const laad = (p) => import(pathToFileURL(path.join(ROOT, "lib", "boekhouding", p)).href);
let geld, btw, periode, model, journaal, constanten, seed, demo, bronnen, afl, imp, voorbeeld, afs, ag, act, ctl;
try {
  [geld, btw, periode, model, journaal, constanten, seed, demo, bronnen, afl, imp, voorbeeld, afs, ag, act, ctl] = await Promise.all([
    laad("kern/geld.ts"),
    laad("kern/btw.ts"),
    laad("kern/periode.ts"),
    laad("model.ts"),
    laad("kern/journaal.ts"),
    laad("kern/constanten.ts"),
    laad("repo/demo-seed.ts"),
    laad("repo/demo.ts"),
    laad("kern/bronnen.ts"),
    laad("kern/afletteren.ts"),
    laad("kern/bankimport.ts"),
    laad("repo/demo-voorbeeld.ts"),
    laad("kern/afschrijving.ts"),
    laad("kern/aangifte.ts"),
    laad("kern/activeren.ts"),
    laad("kern/btw-controles.ts"),
  ]);
} catch (err) {
  if (process.env.BK_CHILD) throw err;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, BK_CHILD: "1" },
  });
  process.exit(r.status ?? 1);
}

let geslaagd = 0;
const fouten = [];
async function test(naam, fn) {
  try {
    await fn();
    geslaagd++;
  } catch (e) {
    fouten.push(`${naam}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------------- geld
await test("naarCenten: NL- en punt-notatie, tekens en ongeldig", () => {
  const c = geld.naarCenten;
  assert.equal(c("1.234,56"), 123456);
  assert.equal(c("1234,5"), 123450);
  assert.equal(c("1234.5"), 123450);
  assert.equal(c("1234.50"), 123450);
  assert.equal(c("12.50"), 1250);
  assert.equal(c("1,234.56"), 123456);
  assert.equal(c("1.234"), 123400);
  assert.equal(c("1.234.567,89"), 123456789);
  assert.equal(c("-12,30"), -1230);
  assert.equal(c("−12,30"), -1230);
  assert.equal(c("€ 12,50"), 1250);
  assert.equal(c("€12"), 1200);
  assert.equal(c("(5,00)"), -500);
  assert.equal(c("0,5"), 50);
  assert.equal(c(",99"), 99);
  assert.equal(c("0"), 0);
  assert.equal(c(1234.5), 123450);
  assert.equal(c(0.1 + 0.2), 30);
  assert.equal(c(19.99), 1999);
  assert.equal(c("12,345"), null);
  assert.equal(c("1,2,3"), null);
  assert.equal(c("abc"), null);
  assert.equal(c(""), null);
  assert.equal(c(null), null);
  assert.equal(c(Number.NaN), null);
  assert.equal(c("12.5.3"), null);
});
await test("rondAf: half weg van nul, alleen gehele getallen", () => {
  const r = geld.rondAf;
  assert.equal(r(1, 2), 1);
  assert.equal(r(-1, 2), -1);
  assert.equal(r(3, 2), 2);
  assert.equal(r(-3, 2), -2);
  assert.equal(r(2100, 121), 17);
  assert.equal(r(1, 3), 0);
  assert.equal(r(5, 10), 1);
  assert.equal(r(4, 10), 0);
  assert.equal(r(-5, 10), -1);
  assert.equal(r(0, 7), 0);
  assert.throws(() => r(1.5, 2));
  assert.throws(() => r(1, 0));
});
await test("formatCenten / formatBedrag / centenNaarInvoer", () => {
  assert.equal(geld.formatCenten(123456), "€ 1.234,56");
  assert.equal(geld.formatCenten(-500), "−€ 5,00");
  assert.equal(geld.formatCenten(0), "€ 0,00");
  assert.equal(geld.formatCenten(5), "€ 0,05");
  assert.equal(geld.formatCenten(999999999), "€ 9.999.999,99");
  assert.equal(geld.centenNaarInvoer(123405), "1234,05");
  assert.equal(geld.centenNaarDecimaal(-1205), "-12.05");
  assert.throws(() => geld.formatCenten(1.5));
});
await test("verdeel: exact (grootste rest), ook negatief", () => {
  assert.deepEqual(geld.verdeel(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(geld.verdeel(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(geld.verdeel(1001, [50, 50]), [501, 500]);
  assert.deepEqual(geld.verdeel(0, [60, 40]), [0, 0]);
  assert.deepEqual(geld.verdeel(1000, [60, 40]), [600, 400]);
  let x = 7;
  for (let i = 0; i < 300; i++) {
    x = (x * 48271) % 2147483647;
    const totaal = (x % 2000003) - 1000000;
    const delen = [1 + (x % 7), 1 + ((x >> 3) % 11), (x >> 5) % 5];
    const uit = geld.verdeel(totaal, delen);
    assert.equal(uit.reduce((a, b) => a + b, 0), totaal);
  }
  assert.throws(() => geld.verdeel(10, [0, 0]));
});

// ---------------------------------------------------------------------------------- btw
await test("btw uit incl. en excl.", () => {
  assert.equal(btw.btwUitIncl(12100, 21), 2100);
  assert.equal(btw.btwUitIncl(4840, 21), 840);
  assert.equal(btw.btwUitIncl(3815, 9), 315);
  assert.equal(btw.btwUitIncl(100, 21), 17);
  assert.equal(btw.btwUitIncl(6, 21), 1);
  assert.equal(btw.btwUitIncl(1, 21), 0);
  assert.equal(btw.btwUitIncl(1000, 0), 0);
  assert.equal(btw.btwUitExcl(10000, 21), 2100);
  assert.equal(btw.btwUitExcl(50, 21), 11); // 10,5 → 11
  assert.equal(btw.btwUitExcl(-50, 21), -11);
  assert.equal(btw.btwUitExcl(250, 9), 23); // 22,5 → 23
  assert.equal(btw.btwUitExcl(249900, 21), 52479);
});
await test("berekenBtw: uitgave 21% incl. en inkomst 21% excl.", () => {
  const u = btw.berekenBtw({ kant: "uitgave", bedrag: 12100, isExcl: false, code: "21" });
  assert.deepEqual([u.bank, u.excl, u.btw, u.voorbelasting, u.verschuldigd, u.rubriek], [12100, 10000, 2100, 2100, 0, "5b"]);
  const i = btw.berekenBtw({ kant: "inkomst", bedrag: 10000, isExcl: true, code: "21" });
  assert.deepEqual([i.bank, i.excl, i.btw, i.voorbelasting, i.verschuldigd, i.rubriek], [12100, 10000, 2100, 0, 2100, "1a"]);
  const l = btw.berekenBtw({ kant: "inkomst", bedrag: 10900, isExcl: false, code: "9" });
  assert.deepEqual([l.excl, l.verschuldigd, l.rubriek], [10000, 900, "1b"]);
  const ns = btw.berekenBtw({ kant: "uitgave", bedrag: 3815, isExcl: false, code: "9" });
  assert.deepEqual([ns.excl, ns.voorbelasting], [3500, 315]);
});
await test("berekenBtw: verlegging bij inkoop = verschuldigd én aftrekbaar (2a/4a/4b)", () => {
  for (const [code, rubriek] of [["eu_dienst", "4b"], ["buiten_eu", "4a"], ["verlegd_nl", "2a"]]) {
    const x = btw.berekenBtw({ kant: "uitgave", bedrag: 5999, isExcl: false, code });
    assert.deepEqual([x.bank, x.excl, x.btw, x.verschuldigd, x.voorbelasting, x.rubriek], [5999, 5999, 1260, 1260, 1260, rubriek], code);
    // isExcl maakt bij verlegging niets uit (op de bank staat altijd het bedrag zonder btw)
    assert.equal(btw.berekenBtw({ kant: "uitgave", bedrag: 5999, isExcl: true, code }).bank, 5999);
  }
});
await test("berekenBtw: verkoop-rubrieken en geen btw", () => {
  const rub = (code) => btw.berekenBtw({ kant: "inkomst", bedrag: 10000, isExcl: false, code });
  assert.equal(rub("eu_dienst").rubriek, "3b");
  assert.equal(rub("buiten_eu").rubriek, "1e");
  assert.equal(rub("verlegd_nl").rubriek, "1e");
  assert.equal(rub("0").rubriek, "1e");
  assert.equal(rub("geen").rubriek, null);
  for (const c of ["eu_dienst", "buiten_eu", "verlegd_nl", "0", "geen"]) {
    const x = rub(c);
    assert.deepEqual([x.bank, x.excl, x.btw, x.verschuldigd, x.voorbelasting], [10000, 10000, 0, 0, 0], c);
  }
  const bank = btw.berekenBtw({ kant: "uitgave", bedrag: 950, isExcl: false, code: "geen" });
  assert.deepEqual([bank.excl, bank.voorbelasting, bank.rubriek], [950, 0, null]);
  assert.equal(btw.berekenBtw({ kant: "uitgave", bedrag: 950, isExcl: false, code: "0" }).rubriek, null);
});
await test("berekenBtw: handmatige btw en waarschuwing boven € 0,02", () => {
  const a = btw.berekenBtw({ kant: "uitgave", bedrag: 12100, isExcl: false, code: "21", handmatig: 2098 });
  assert.deepEqual([a.btw, a.excl, a.afwijking, a.berekend], [2098, 10002, false, 2100]);
  const b = btw.berekenBtw({ kant: "uitgave", bedrag: 12100, isExcl: false, code: "21", handmatig: 2097 });
  assert.equal(b.afwijking, true);
  const c = btw.berekenBtw({ kant: "uitgave", bedrag: 10000, isExcl: true, code: "21", handmatig: 2101 });
  assert.deepEqual([c.bank, c.excl, c.btw], [12101, 10000, 2101]);
  assert.throws(() => btw.berekenBtw({ kant: "uitgave", bedrag: 100, isExcl: false, code: "21", handmatig: 101 }));
  assert.throws(() => btw.berekenBtw({ kant: "uitgave", bedrag: 1.5, isExcl: false, code: "21" }));
});

// ---------------------------------------------------------------------------------- periode
await test("kwartalen, NL-tijdgrens en deadlines", () => {
  assert.equal(periode.kwartaalVan("2026-03-31"), 1);
  assert.equal(periode.kwartaalVan("2026-04-01"), 2);
  assert.equal(periode.kwartaalVan("2026-12-31"), 4);
  assert.equal(periode.datumNL("2026-03-31T23:30:00Z"), "2026-04-01"); // zomertijd: 01:30
  assert.equal(periode.datumNL("2025-12-31T23:30:00Z"), "2026-01-01"); // wintertijd: 00:30
  assert.equal(periode.datumNL("2026-03-31T21:30:00Z"), "2026-03-31");
  assert.equal(periode.aangifteDeadline(2026, 1), "2026-04-30");
  assert.equal(periode.aangifteDeadline(2026, 2), "2026-07-31");
  assert.equal(periode.aangifteDeadline(2026, 3), "2026-10-31");
  assert.equal(periode.aangifteDeadline(2026, 4), "2027-01-31");
  assert.deepEqual(periode.kwartaalGrenzen(2028, 1), { van: "2028-01-01", tot: "2028-03-31" });
  assert.deepEqual(periode.kwartaalGrenzen(2026, 4), { van: "2026-10-01", tot: "2026-12-31" });
  assert.equal(periode.isDatum("2026-02-29"), false);
  assert.equal(periode.isDatum("2028-02-29"), true);
  assert.equal(periode.isDatum("2026-13-01"), false);
  assert.equal(periode.plusMaanden("2026-01-31", 1), "2026-02-28");
  assert.equal(periode.plusMaanden("2026-01-15", -13), "2024-12-15");
  assert.equal(periode.plusDagen("2026-12-30", 3), "2027-01-02");
  assert.equal(periode.korteDatum("2026-10-24"), "24 okt 2026");
});
await test("vergrendeling: aangifte per kwartaal, boekjaar per jaar", () => {
  const v = { aangiften: [{ jaar: 2026, kwartaal: 1 }], boekjaren: [2025] };
  assert.match(periode.vergrendeldReden("2026-03-31", v), /Q1 2026/);
  assert.equal(periode.vergrendeldReden("2026-04-01", v), null);
  assert.match(periode.vergrendeldReden("2025-06-01", v), /Boekjaar 2025/);
  assert.equal(periode.isVergrendeld("2027-01-01", v), false);
});

// ---------------------------------------------------------------------------------- model
const VANDAAG = "2026-10-24";
const stam = seed.demoStamdata("2025-09-01");
stam.vergrendeling = { aangiften: [{ jaar: 2026, kwartaal: 2 }], boekjaren: [] };
const RB = seed.DEMO_ID.regiobank;
const RV = seed.DEMO_ID.revolut;
const parse = (b) => model.parseBoekingInvoer(b, stam, { vandaag: VANDAAG });

await test("parseBoekingInvoer: snelle invoer (standaard RegioBank, btw automatisch)", () => {
  const p = parse({ datum: "2026-10-20", omschrijving: "  Adobe   CC ", soort: "uitgave", bedrag: "71,39", btwCode: "eu_dienst", grootboek: "4000" });
  assert.equal(p.ok, true, p.fout);
  assert.equal(p.waarde.rekeningId, RB);
  assert.equal(p.waarde.omschrijving, "Adobe CC");
  assert.deepEqual([p.waarde.bedrag, p.waarde.btw, p.waarde.richting, p.waarde.status], [7139, 1499, "af", "geboekt"]);
  const r = parse({ rekeningId: RV, datum: "2026-10-20", omschrijving: "KPN", soort: "uitgave", bedrag: "48,40", btwCode: "21" });
  assert.equal(r.ok, true);
  assert.deepEqual([r.waarde.rekeningId, r.waarde.btw, r.waarde.grootboek], [RV, 840, "4990"]);
  const i = parse({ datum: "2026-10-20", omschrijving: "Factuur", soort: "inkomst", bedrag: "3.630,00", btwCode: "21" });
  assert.deepEqual([i.waarde.richting, i.waarde.btw, i.waarde.grootboek], ["bij", 63000, "8000"]);
  const ex = parse({ datum: "2026-10-20", omschrijving: "x", soort: "inkomst", bedrag: "3000", isExcl: true, btwCode: "21" });
  assert.deepEqual([ex.waarde.isExcl, ex.waarde.btw], [true, 63000]);
  const ex0 = parse({ datum: "2026-10-20", omschrijving: "x", soort: "inkomst", bedrag: "3000", isExcl: true, btwCode: "0" });
  assert.equal(ex0.waarde.isExcl, false);
  const cent = parse({ datum: "2026-10-20", omschrijving: "x", soort: "uitgave", bedragCenten: 12100, btwCode: "21" });
  assert.equal(cent.waarde.btw, 2100);
});
await test("parseBoekingInvoer: fouten", () => {
  const basis = { datum: "2026-10-20", omschrijving: "x", soort: "uitgave", bedrag: "10", btwCode: "21" };
  const veld = (w) => parse({ ...basis, ...w }).veld;
  assert.equal(veld({ omschrijving: "  " }), "omschrijving");
  assert.equal(veld({ bedrag: "0" }), "bedrag");
  assert.equal(veld({ bedrag: "-5" }), "bedrag");
  assert.equal(veld({ bedrag: "abc" }), "bedrag");
  assert.equal(veld({ bedrag: "100000000,00" }), "bedrag");
  assert.equal(veld({ datum: "2026-02-30" }), "datum");
  assert.equal(veld({ datum: "2028-01-01" }), "datum");
  assert.equal(veld({ soort: "kosten" }), "soort");
  assert.equal(veld({ btwCode: "19" }), "btwCode");
  assert.equal(veld({ rekeningId: "00000000-0000-4000-8000-000000000000" }), "rekeningId");
  assert.equal(veld({ grootboek: "8000" }), "grootboek"); // opbrengst bij een uitgave
  assert.equal(veld({ grootboek: "4800" }), "grootboek"); // afschrijvingen boekt het systeem
  assert.equal(veld({ soort: "inkomst", grootboek: "4000" }), "grootboek");
  assert.equal(veld({ btwCode: "geen", btwHandmatig: "1" }), "btwHandmatig");
  assert.equal(veld({ btwHandmatig: "10" }), "btwHandmatig"); // btw ≥ bedrag
  assert.equal(veld({ soort: "prive" }), "vennootId");
  assert.equal(parse({ ...basis, grootboek: "0210" }).ok, true); // investering mag
});
await test("parseBoekingInvoer: privé/overboeking/btw zonder btw", () => {
  const p = parse({ datum: "2026-10-20", omschrijving: "Opname", soort: "prive", bedrag: "1500", btwCode: "21", vennootId: seed.DEMO_ID.bram });
  assert.deepEqual([p.waarde.btwCode, p.waarde.btw, p.waarde.grootboek, p.waarde.vennootId, p.waarde.richting], ["geen", 0, null, seed.DEMO_ID.bram, "af"]);
  const o = parse({ datum: "2026-10-20", omschrijving: "Naar Revolut", soort: "overboeking", richting: "bij", bedrag: "500" });
  assert.deepEqual([o.waarde.btwCode, o.waarde.richting, o.waarde.vennootId], ["geen", "bij", null]);
  const t = parse({ datum: "2026-10-20", omschrijving: "Belastingdienst", soort: "btw", bedrag: "500", richting: "x" });
  assert.equal(t.veld, "richting");
});
await test("vergrendelFout: zoals de trigger in 0027", () => {
  const v = stam.vergrendeling;
  const w = parse({ datum: "2026-05-10", omschrijving: "x", soort: "uitgave", bedrag: "10", btwCode: "21" }).waarde;
  assert.match(model.vergrendelFout(null, w, v), /Q2 2026/);
  const open = { ...w, datum: "2026-07-01" };
  assert.equal(model.vergrendelFout(null, open, v), null);
  const oud = { id: "x", ...w, tegenrekening: null, kenmerk: null, importId: null, aangemaakt: "", aangemaaktDoor: null, gewijzigd: "" };
  assert.equal(model.vergrendelFout(oud, { ...w, notities: "ok", omschrijving: "y", status: "te_verwerken", tegenpartij: "z" }, v), null);
  assert.match(model.vergrendelFout(oud, { ...w, bedrag: 11 }, v), /vergrendeld/);
  assert.match(model.vergrendelFout(oud, { ...w, datum: "2026-07-01" }, v), /vergrendeld/); // uit Q2 weg
  assert.match(model.vergrendelFout({ ...oud, datum: "2026-07-01" }, w, v), /vergrendeld/); // naar Q2 toe
  assert.match(model.vergrendelFout(oud, null, v), /vergrendeld/);
  assert.equal(model.vergrendelFout({ ...oud, datum: "2026-07-01" }, null, v), null);
});
const maak = (w) => ({ id: w.id ?? `id-${Math.random()}`, rekeningId: RB, datum: "2026-07-01", omschrijving: "x", tegenpartij: null, tegenrekening: null, soort: "uitgave", richting: "af", bedrag: 12100, isExcl: false, btwCode: "21", btw: 2100, btwHandmatig: false, grootboek: "4000", vennootId: null, status: "geboekt", kenmerk: null, notities: null, importId: null, aangemaakt: "2026-07-01T09:00:00Z", aangemaaktDoor: null, gewijzigd: "", ...w });
await test("berekenBoeking: richting, teken en bankmutatie", () => {
  const u = model.berekenBoeking(maak({}));
  assert.deepEqual([u.teken, u.bankMutatie, u.kwartaal, u.jaar], [1, -12100, 3, 2026]);
  const terug = model.berekenBoeking(maak({ richting: "bij" }));
  assert.deepEqual([terug.teken, terug.bankMutatie], [-1, 12100]);
  const p = model.berekenBoeking(maak({ soort: "prive", btwCode: "21", richting: "bij" }));
  assert.deepEqual([p.teken, p.bankMutatie, p.btw.btw], [1, 12100, 0]);
});
await test("lopend saldo, saldo per rekening en totalen", () => {
  const rek = [{ ...stam.rekeningen[0], beginsaldo: 100000, begindatum: "2026-01-01" }, stam.rekeningen[1]];
  const lijst = [
    maak({ id: "a", datum: "2026-02-01", soort: "inkomst", richting: "bij", bedrag: 12100, btw: 2100, grootboek: "8000" }),
    maak({ id: "b", datum: "2026-01-15", bedrag: 4840, btw: 840 }),
    maak({ id: "c", datum: "2025-12-31", bedrag: 999 }), // vóór de begindatum: telt niet
    maak({ id: "d", datum: "2026-03-01", rekeningId: RV, soort: "overboeking", richting: "bij", bedrag: 5000, btwCode: "geen", btw: 0, grootboek: null }),
  ];
  const l = model.lopendSaldo(lijst, rek);
  assert.equal(l.get("b"), 100000 - 4840);
  assert.equal(l.get("a"), 100000 - 4840 + 12100);
  assert.equal(l.has("c"), false);
  const s = model.saldoPerRekening(lijst, rek);
  assert.equal(s.get(RB), 107260);
  assert.equal(s.get(RV), 32000 + 5000);
  const t = model.totalen(lijst);
  assert.deepEqual([t.bij, t.af, t.verschuldigd, t.voorbelasting, t.aantal], [17100, 4840 + 999, 2100, 840 + 173, 4]);
});
await test("IBAN en rekeninginvoer", () => {
  assert.equal(model.normaliseerIban("nl91 abna 0417 1643 00"), "NL91ABNA0417164300");
  assert.equal(model.normaliseerIban("NL91ABNA0417164301"), null);
  assert.equal(model.normaliseerIban("12345"), null);
  assert.equal(model.formatIban("NL91ABNA0417164300"), "NL91 ABNA 0417 1643 00");
  const ok = model.parseRekeningInvoer({ naam: " Bunq ", iban: "NL91ABNA0417164300", beginsaldo: "1.234,50", begindatum: "2026-01-01", importFormaat: "generiek" }, true);
  assert.deepEqual(ok.waarde, { naam: "Bunq", iban: "NL91ABNA0417164300", beginsaldo: 123450, begindatum: "2026-01-01", importFormaat: "generiek" });
  assert.equal(model.parseRekeningInvoer({ naam: "" }, true).veld, "naam");
  assert.equal(model.parseRekeningInvoer({ naam: "x", iban: "NL00" }, true).veld, "iban");
  assert.equal(model.parseRekeningInvoer({ naam: "x", beginsaldo: "10", begindatum: null }, true).veld, "begindatum");
  assert.equal(model.parseRekeningInvoer({ actief: "ja" }, false).veld, "actief");
  assert.deepEqual(model.parseRekeningInvoer({ actief: false }, false).waarde, { actief: false });
});

// ---------------------------------------------------------------------------------- journaal
const ctx = journaal.contextUit(stam);
const regels = (post) => post.regels.map((r) => `${r.grootboek}:${r.debet ? "D" + r.debet : "C" + r.credit}`).sort().join(" ");
await test("journaal: uitgave 21%, verlegd, inkomst 21%/9%, terugbetaling", () => {
  assert.equal(regels(journaal.boekingNaarPost(maak({}), ctx)), "1100:C12100 1520:D2100 4000:D10000");
  assert.equal(
    regels(journaal.boekingNaarPost(maak({ bedrag: 5999, btwCode: "eu_dienst", btw: 1260 }), ctx)),
    "1100:C5999 1510:C1260 1520:D1260 4000:D5999",
  );
  const ink = journaal.boekingNaarPost(maak({ soort: "inkomst", richting: "bij", grootboek: "8000" }), ctx);
  assert.equal(regels(ink), "1100:D12100 1500:C2100 8000:C10000");
  assert.deepEqual(ink.btw, { rubriek: "1a", grondslag: 10000, verschuldigd: 2100, voorbelasting: 0 });
  assert.equal(regels(journaal.boekingNaarPost(maak({ soort: "inkomst", richting: "bij", grootboek: "8000", bedrag: 10900, btwCode: "9" }), ctx)), "1100:D10900 1505:C900 8000:C10000");
  const terug = journaal.boekingNaarPost(maak({ richting: "bij" }), ctx);
  assert.equal(regels(terug), "1100:D12100 1520:C2100 4000:C10000");
  assert.deepEqual(terug.btw, { rubriek: "5b", grondslag: -10000, verschuldigd: 0, voorbelasting: -2100 });
  assert.equal(regels(journaal.boekingNaarPost(maak({ bedrag: 950, btwCode: "geen", grootboek: "4900" }), ctx)), "1100:C950 4900:D950");
  assert.equal(regels(journaal.boekingNaarPost(maak({ grootboek: null }), ctx)), "1100:C12100 1520:D2100 1900:D10000");
});
await test("journaal: privé, overboeking (kruisposten 0), btw-betaling, beginsaldo, memoriaal", () => {
  assert.equal(regels(journaal.boekingNaarPost(maak({ soort: "prive", btwCode: "geen", vennootId: seed.DEMO_ID.daniel, bedrag: 150000 }), ctx)), "0600:D150000 1100:C150000");
  const af = journaal.boekingNaarPost(maak({ soort: "overboeking", btwCode: "geen", bedrag: 50000 }), ctx);
  const bij = journaal.boekingNaarPost(maak({ soort: "overboeking", richting: "bij", rekeningId: RV, btwCode: "geen", bedrag: 50000 }), ctx);
  assert.equal(journaal.proefbalans([af, bij]).get("2000"), 0);
  assert.equal(regels(journaal.boekingNaarPost(maak({ soort: "btw", btwCode: "geen", bedrag: 30000 }), ctx)), "1100:C30000 1530:D30000");
  const begin = journaal.beginsaldoPosten(stam);
  assert.equal(begin.length, 2);
  assert.equal(regels(begin[0]), "0900:C845000 1100:D845000");
  assert.throws(() => journaal.memoriaalNaarPost({ id: "m", datum: "2026-01-01", omschrijving: "x", soort: "correctie", regels: [{ grootboek: "1100", debet: 10, credit: 0 }, { grootboek: "0900", debet: 0, credit: 9 }] }), /sluit niet/);
  assert.equal(journaal.memoriaalNaarPost({ id: "m", datum: "2026-01-01", omschrijving: "x", soort: "correctie", regels: [{ grootboek: "1100", debet: 10, credit: 0 }, { grootboek: "0900", debet: 0, credit: 10 }] }).regels.length, 2);
  assert.throws(() => journaal.assertSluit({ id: "x", regels: [{ grootboek: "1100", debet: -1, credit: -1 }] }));
});
await test("journaal: elke combinatie van soort/richting/btw-code sluit", () => {
  const codes = ["21", "9", "0", "geen", "verlegd_nl", "eu_dienst", "buiten_eu"];
  let n = 0;
  for (const soort of ["uitgave", "inkomst", "prive", "overboeking", "btw"]) {
    for (const richting of ["af", "bij"]) {
      for (const code of codes) {
        for (const isExcl of [false, true]) {
          for (const bedrag of [1, 99, 12100, 123457]) {
            const b = maak({ soort, richting, btwCode: ["uitgave", "inkomst"].includes(soort) ? code : "geen", isExcl, bedrag, vennootId: seed.DEMO_ID.bram, grootboek: soort === "inkomst" ? "8000" : "4000" });
            const p = journaal.boekingNaarPost(b, ctx);
            const bank = p.regels.filter((r) => r.grootboek === "1100").reduce((s, r) => s + r.debet - r.credit, 0);
            assert.equal(bank, model.berekenBoeking(b).bankMutatie);
            n++;
          }
        }
      }
    }
  }
  assert.ok(n > 500);
});

// ---------------------------------------------------------------------------------- demo
const data = seed.demoSeed(VANDAAG);
await test("demo-seed: realistisch, niets in de toekomst, alle soorten", () => {
  const b = data.boekingen;
  assert.ok(b.length > 150, `${b.length}`);
  assert.ok(b.every((x) => x.datum <= VANDAAG && x.datum >= "2025-09-01"));
  for (const s of ["uitgave", "inkomst", "prive", "overboeking", "btw"]) assert.ok(b.some((x) => x.soort === s), s);
  for (const c of ["21", "9", "geen", "eu_dienst", "buiten_eu"]) assert.ok(b.some((x) => x.btwCode === c), c);
  assert.ok(b.some((x) => x.grootboek === "0210"), "laptop als investering");
  assert.ok(b.filter((x) => x.status === "te_verwerken").length >= 3);
  assert.ok(b.some((x) => x.rekeningId === RV) && b.some((x) => x.rekeningId === RB));
  assert.equal(new Set(b.map((x) => x.id)).size, b.length);
  // Deterministisch.
  assert.deepEqual(seed.demoSeed(VANDAAG).boekingen.map((x) => x.id + x.bedrag), b.map((x) => x.id + x.bedrag));
  // Elke opgeslagen btw = de berekende btw.
  for (const x of b) assert.equal(x.btw, model.berekenBoeking(x).btw.btw, x.omschrijving);
});
const alles = (d) => ({ boekingen: d.boekingen, facturen: d.facturen, uitgaven: d.uitgaven, koppelingen: d.koppelingen, bronExtra: d.bronExtra, activa: d.activa });
await test("demo-seed: journaal sluit, saldi = grootboek, kruisposten 0, saldo nooit negatief", () => {
  const posten = journaal.journaal(data.stamdata, alles(data));
  const pb = journaal.proefbalans(posten);
  assert.equal([...pb.values()].reduce((a, b) => a + b, 0), 0);
  const saldi = model.saldoPerRekening(data.boekingen, data.stamdata.rekeningen);
  assert.equal(pb.get("1100"), saldi.get(RB));
  assert.equal(pb.get("1110"), saldi.get(RV));
  assert.equal(pb.get("2000") ?? 0, 0);
  const lopend = model.lopendSaldo(data.boekingen, data.stamdata.rekeningen);
  assert.ok(Math.min(...lopend.values()) >= 0, `laagste saldo ${Math.min(...lopend.values())}`);
});
await test("demo-seed: ingediende kwartalen vergrendeld, aangifte = herberekening, betaling gekoppeld", () => {
  const a = data.aangiften.map((x) => `Q${x.kwartaal} ${x.jaar}`);
  assert.deepEqual(a, ["Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026"]);
  assert.equal(periode.isVergrendeld("2026-06-30", data.stamdata.vergrendeling), true);
  assert.equal(periode.isVergrendeld("2026-07-01", data.stamdata.vergrendeling), false);
  const posten = journaal.journaal(data.stamdata, alles(data));
  for (const x of data.aangiften) {
    const ber = ag.aangifteRubrieken(posten, x.jaar, x.kwartaal);
    assert.deepEqual(ag.naarSnapshot(ber), x.snapshot, `snapshot ${x.jaar}-${x.kwartaal}`);
    assert.equal(x.teBetalen, ber.saldo.euro * 100);
    assert.ok(x.teBetalen % 100 === 0, "hele euro's");
    // Exacte btw (cent) en het formulier verschillen alleen door afronding in het voordeel.
    assert.ok(ber.saldo.centen - x.teBetalen >= 0 && ber.saldo.centen - x.teBetalen < 100 * 12);
    const bet = data.aangifteBetalingen.filter((b) => b.aangifteId === x.id);
    assert.equal(bet.reduce((t, b) => t + b.bedrag, 0), x.teBetalen);
    const b = data.boekingen.find((y) => y.id === bet[0].boekingId);
    assert.ok(b.soort === "btw" && b.bedrag === Math.abs(x.teBetalen) && b.richting === (x.teBetalen > 0 ? "af" : "bij"));
    assert.ok(b.datum > periode.kwartaalGrenzen(x.jaar, x.kwartaal).tot && b.datum <= periode.aangifteDeadline(x.jaar, x.kwartaal));
  }
  // Met de afsluitposten en de betalingen staat er niets meer op 1530 (af te dragen btw).
  const pb = journaal.proefbalans(journaal.journaal(data.stamdata, { ...alles(data), aangiften: data.aangiften }));
  assert.equal(pb.get("1530") ?? 0, 0);
  assert.equal([...pb.values()].reduce((x, y) => x + y, 0), 0);
});
await test("demo-opslag: importeert geen Supabase en schrijft niets naar het netwerk", () => {
  for (const f of ["repo/demo.ts", "repo/demo-seed.ts", "repo/demo-voorbeeld.ts", "model.ts", "kern/geld.ts", "kern/btw.ts", "kern/periode.ts", "kern/journaal.ts", "kern/constanten.ts", "kern/bronnen.ts", "kern/afletteren.ts", "kern/bankimport.ts", "kern/afschrijving.ts", "kern/aangifte.ts", "kern/activeren.ts", "kern/btw-controles.ts"]) {
    const src = fs.readFileSync(path.join(ROOT, "lib", "boekhouding", f), "utf8");
    assert.ok(!/supabase|@\/|fetch\(|node:fs/.test(src.replace(/\/\/[^\n]*/g, "")), `${f} importeert iets buiten de kern`);
  }
});
await test("demo-opslag: per teamlid, vergrendeling, herstellen", async () => {
  const a = new demo.DemoRepo("test-a", "u-a");
  const b = new demo.DemoRepo("test-b", "u-b");
  const voor = (await a.boekingen()).length;
  const stamA = await a.stamdata();
  const nu = periode.vandaagNL();
  const w = model.parseBoekingInvoer({ datum: nu, omschrijving: "Test", soort: "uitgave", bedrag: "12,10", btwCode: "21" }, stamA, { vandaag: nu });
  assert.equal(w.ok, true, w.fout);
  const nieuw = await a.boekingToevoegen(w.waarde);
  assert.equal(nieuw.aangemaaktDoor, "u-a");
  assert.equal((await a.boekingen()).length, voor + 1);
  assert.equal((await b.boekingen()).length, voor, "andere teamleden zien de demowijziging niet");
  // Kopieën: wijzigen van een teruggegeven object raakt de opslag niet.
  (await a.boekingen())[0].bedrag = 1;
  assert.notEqual((await a.boekingen())[0].bedrag, 1);
  await a.boekingWijzigen(nieuw.id, { ...w.waarde, notities: "gecontroleerd" });
  assert.equal((await a.boeking(nieuw.id)).notities, "gecontroleerd");
  // Vergrendeld kwartaal (ingediend in de demo)
  const vg = stamA.vergrendeling.aangiften[0];
  const oudeDatum = periode.kwartaalGrenzen(vg.jaar, vg.kwartaal).van;
  await assert.rejects(a.boekingToevoegen({ ...w.waarde, datum: oudeDatum }), (e) => e.status === 409 && e.code === "periode_vergrendeld");
  const oud = (await a.boekingen()).find((x) => periode.isVergrendeld(x.datum, stamA.vergrendeling));
  await assert.rejects(a.boekingVerwijderen(oud.id, "test"), (e) => e.status === 409);
  await assert.rejects(a.boekingWijzigen(oud.id, { ...model.parseBoekingInvoer(model.boekingAlsInvoer(oud), stamA, { vandaag: nu }).waarde, bedrag: oud.bedrag + 1 }), (e) => e.status === 409);
  await a.boekingVerwijderen(nieuw.id, "test");
  assert.equal(await a.boeking(nieuw.id), null);
  // Rekeningen
  const rek = await a.rekeningToevoegen({ naam: "Bunq", iban: null, importFormaat: "generiek", beginsaldo: 0, begindatum: null });
  assert.equal(rek.grootboek, "1120");
  await assert.rejects(a.rekeningToevoegen({ naam: "bunq", iban: null, importFormaat: "generiek", beginsaldo: 0, begindatum: null }), (e) => e.status === 409);
  await a.standaardRekening(rek.id);
  assert.deepEqual((await a.stamdata()).rekeningen.filter((r) => r.standaard).map((r) => r.naam), ["Bunq"]);
  assert.deepEqual((await b.stamdata()).rekeningen.filter((r) => r.standaard).map((r) => r.naam), ["RegioBank"]);
  demo.demoHerstellen("test-a");
  assert.equal((await a.boekingen()).length, voor);
  assert.equal((await a.stamdata()).rekeningen.length, 2);
});


// ---------------------------------------------------------------------------------- stap 2: bronnen
const F = (o = {}) => ({
  id: "f0000000-0000-4000-8000-000000000001", nummer: "2026-050", klant: "Hotel Zeezicht", datum: "2026-08-10",
  subtotaal: 300000, omzet: 300000, btw: 63000, totaal: 363000, btwPct: 21, verlegd: false, verlegdReden: null, aanbetaling: false, restVan: null, ...o,
});
const U = (o = {}) => ({
  id: "u0000000-0000-4000-8000-000000000001", datum: "2026-08-12", leverancier: "Coolblue B.V.", omschrijving: "Monitor", categorie: "hardware",
  totaal: 34900, btw: 6057, tarief: "21", valuta: "EUR", betaalwijze: "zakelijk", status: "verwerkt", factuurnummer: "", aangemaaktDoor: null, ...o,
});
await test("bronnen: factuur- en bonnetjesrijen exact naar centen, factuurdatum in NL-tijd", () => {
  const f = bronnen.factuurUitRij({ id: "a", invoice_number: "2026-011", client_company_name: "X", issued_at: "2026-03-31T23:30:00Z", subtotal: "1234.56", revenue_subtotal: null, vat_percentage: "21.00", vat_amount: "259.26", total: "1493.82", vat_reverse_charged: false });
  assert.deepEqual([f.datum, f.subtotaal, f.omzet, f.btw, f.totaal, f.btwPct], ["2026-04-01", 123456, 123456, 25926, 149382, 21]);
  const g = bronnen.factuurUitRij({ id: "b", issued_at: "2026-12-31T23:30:00Z", subtotal: 0.1 + 0.2, vat_amount: 0.07, total: 0.37, revenue_subtotal: 0.1 });
  assert.deepEqual([g.datum, g.subtotaal, g.btw, g.totaal, g.omzet], ["2027-01-01", 30, 7, 37, 10]);
  assert.equal(bronnen.factuurUitRij({ id: "c", issued_at: null, subtotal: 1, total: 1 }), null);
  const u = bronnen.uitgaveUitRij({ id: "u", expense_date: "2026-02-30", supplier: "Bol", total_amount: "42.95", vat_amount: "7.45", vat_rate: "21", currency: "EUR", payment_method: "prive", status: "verwerkt" });
  assert.deepEqual([u.datum, u.totaal, u.btw, u.tarief, u.betaalwijze], [null, 4295, 745, "21", "prive"]);
  assert.equal(bronnen.uitgaveTeltNiet(u), "datum of bedrag ontbreekt");
  assert.equal(bronnen.uitgaveTeltNiet(U({ status: "concept" })), "nog in concept");
  assert.equal(bronnen.uitgaveTeltNiet(U({ valuta: "USD" })), "in USD");
  assert.equal(bronnen.uitgaveTeltNiet(U()), null);
});
await test("bronnen: btw-code van facturen en bonnetjes, categorie → grootboek, verfijning gaat voor", () => {
  assert.equal(bronnen.factuurBtwCode(F()), "21");
  assert.equal(bronnen.factuurBtwCode(F({ btwPct: 9 })), "9");
  assert.equal(bronnen.factuurBtwCode(F({ btwPct: 0, btw: 0 })), "0");
  assert.equal(bronnen.factuurBtwCode(F({ verlegd: true, verlegdReden: "Btw verlegd — intracommunautaire dienst" })), "eu_dienst");
  assert.equal(bronnen.factuurBtwCode(F({ verlegd: true, verlegdReden: "art. 196 Btw-richtlijn" })), "eu_dienst");
  assert.equal(bronnen.factuurBtwCode(F({ verlegd: true, verlegdReden: "Onderaanneming, btw verlegd" })), "verlegd_nl");
  assert.equal(bronnen.factuurBtwCode(F({ verlegd: true }), { btwCode: "buiten_eu" }), "buiten_eu");
  assert.equal(bronnen.uitgaveBtwCode(U({ tarief: "verlegd" })), "eu_dienst");
  assert.equal(bronnen.uitgaveBtwCode(U({ tarief: "verlegd" }), { btwCode: "verlegd_nl" }), "verlegd_nl");
  assert.equal(bronnen.uitgaveGrootboek(U()), "4010");
  assert.equal(bronnen.uitgaveGrootboek(U({ categorie: null })), "4990");
  assert.equal(bronnen.uitgaveGrootboek(U(), { grootboek: "0210" }), "0210");
  assert.equal(bronnen.uitgaveBtw(U({ btw: null }), "21"), 6057);
});

// ---------------------------------------------------------------------------------- stap 2: journaal
await test("journaal: factuur 21%, doorberekende kosten, verlegd EU (3b), 9%, creditnota", () => {
  const p = journaal.factuurNaarPost(F());
  assert.equal(regels(p), "1300:D363000 1500:C63000 8000:C300000");
  assert.deepEqual(p.btw, { rubriek: "1a", grondslag: 300000, verschuldigd: 63000, voorbelasting: 0 });
  assert.equal(regels(journaal.factuurNaarPost(F({ omzet: 250000 }))), "1300:D363000 1500:C63000 8000:C250000 8090:C50000");
  const eu = journaal.factuurNaarPost(F({ verlegd: true, verlegdReden: "intracommunautair", btwPct: 0, btw: 0, subtotaal: 280000, omzet: 280000, totaal: 280000 }));
  assert.equal(regels(eu), "1300:D280000 8010:C280000");
  assert.equal(eu.btw.rubriek, "3b");
  const nl = journaal.factuurNaarPost(F({ verlegd: true, verlegdReden: "onderaanneming", btwPct: 0, btw: 0, subtotaal: 1000, omzet: 1000, totaal: 1000 }));
  assert.equal(nl.btw.rubriek, "1e");
  assert.equal(regels(journaal.factuurNaarPost(F({ btwPct: 9, subtotaal: 10000, omzet: 10000, btw: 900, totaal: 10900 }))), "1300:D10900 1505:C900 8000:C10000");
  const cn = journaal.factuurNaarPost(F({ subtotaal: -20000, omzet: -20000, btw: -4200, totaal: -24200 }));
  assert.equal(regels(cn), "1300:C24200 1500:D4200 8000:D20000");
  assert.deepEqual(cn.btw, { rubriek: "1a", grondslag: -20000, verschuldigd: -4200, voorbelasting: 0 });
  // Totaal wijkt 1 cent af (oude afronding): de post sluit toch en debiteuren = factuurtotaal.
  assert.equal(regels(journaal.factuurNaarPost(F({ totaal: 363001 }))), "1300:D363001 1500:C63000 8000:C300001");
  // Verfijning: andere omzetrekening.
  assert.equal(regels(journaal.factuurNaarPost(F(), { bron: "factuur", bronId: "x", btwCode: null, grootboek: "8900", vennootId: null, notitie: null })), "1300:D363000 1500:C63000 8900:C300000");
});
await test("journaal: aanbetaling + restfactuur tellen samen precies één keer", () => {
  const a = journaal.factuurNaarPost(F({ id: "a", aanbetaling: true, subtotaal: 150000, omzet: 150000, btw: 31500, totaal: 181500 }));
  const r = journaal.factuurNaarPost(F({ id: "r", restVan: "a", subtotaal: 150000, omzet: 150000, btw: 31500, totaal: 181500 }));
  const pb = journaal.proefbalans([a, r]);
  assert.deepEqual([pb.get("8000"), pb.get("1500"), pb.get("1300")], [-300000, -63000, 363000]);
});
await test("journaal: bonnetje zakelijk/privé/contant/verlegd/activeren; concept en valuta tellen niet", () => {
  const c = journaal.contextUit({ ...stam, vennoten: stam.vennoten.map((v) => (v.naam === "Bram" ? { ...v, userId: "user-bram" } : v)) });
  assert.equal(regels(journaal.uitgaveNaarPost(U(), c)), "1520:D6057 1600:C34900 4010:D28843");
  assert.equal(journaal.uitgaveNaarPost(U(), c).btw.rubriek, "5b");
  assert.equal(regels(journaal.uitgaveNaarPost(U({ betaalwijze: "prive", aangemaaktDoor: "user-bram" }), c)), "0610:C34900 1520:D6057 4010:D28843");
  assert.equal(regels(journaal.uitgaveNaarPost(U({ betaalwijze: "prive" }), c, { vennootId: seed.DEMO_ID.daniel })), "0600:C34900 1520:D6057 4010:D28843");
  assert.equal(regels(journaal.uitgaveNaarPost(U({ betaalwijze: "prive" }), c)), "1520:D6057 1900:C34900 4010:D28843");
  assert.equal(regels(journaal.uitgaveNaarPost(U({ betaalwijze: "contant" }), c)), "1000:C34900 1520:D6057 4010:D28843");
  const v = journaal.uitgaveNaarPost(U({ tarief: "verlegd", btw: 0, totaal: 7139, categorie: "software" }), c);
  assert.equal(regels(v), "1510:C1499 1520:D1499 1600:C7139 4000:D7139");
  assert.deepEqual(v.btw, { rubriek: "4b", grondslag: 7139, verschuldigd: 1499, voorbelasting: 1499 });
  assert.equal(regels(journaal.uitgaveNaarPost(U(), c, { grootboek: "0210" })), "0210:D28843 1520:D6057 1600:C34900");
  assert.equal(regels(journaal.uitgaveNaarPost(U({ tarief: "geen", btw: 0, categorie: "bankkosten" }), c)), "1600:C34900 4900:D34900");
  assert.equal(journaal.uitgaveNaarPost(U({ status: "concept" }), c), null);
  assert.equal(journaal.uitgaveNaarPost(U({ valuta: "USD" }), c), null);
});
await test("journaal: gekoppelde bankregel = alleen betaling; omzet en btw veranderen niet", () => {
  const f = F();
  const betaling = maak({ soort: "inkomst", richting: "bij", grootboek: "8000", bedrag: 363000, btwCode: "21" });
  const k = { id: "k1", boekingId: betaling.id, bron: "factuur", bronId: f.id, bedrag: 363000, aangemaakt: "" };
  const los = journaal.journaal(stam, { boekingen: [betaling], facturen: [f] });
  const gek = journaal.journaal(stam, { boekingen: [betaling], facturen: [f], koppelingen: [k] });
  // Los: dubbel (factuur + losse inkomst); gekoppeld: alleen de factuur.
  assert.equal(journaal.btwPerKwartaal(los).get("2026-3").verschuldigd, 126000);
  assert.equal(journaal.btwPerKwartaal(gek).get("2026-3").verschuldigd, 63000);
  const pb = journaal.proefbalans(gek);
  assert.deepEqual([pb.get("8000"), pb.get("1500"), pb.get("1300") ?? 0], [-300000, -63000, 0]);
  assert.equal(regels(journaal.boekingNaarPost(betaling, ctx, [k])), "1100:D363000 1300:C363000");
  // Bonnetje: bank tegen crediteuren, btw alleen uit het bonnetje.
  const u = U();
  const af = maak({ bedrag: 34900, btwCode: "21", grootboek: "4010" });
  const ku = { id: "k2", boekingId: af.id, bron: "uitgave", bronId: u.id, bedrag: 34900, aangemaakt: "" };
  const j = journaal.journaal(stam, { boekingen: [af], uitgaven: [u], koppelingen: [ku] });
  const pb2 = journaal.proefbalans(j);
  assert.deepEqual([pb2.get("1520"), pb2.get("1600") ?? 0, pb2.get("4010")], [6057, 0, 28843]);
  // Deelbetaling: debiteuren houdt het restant.
  const half = maak({ soort: "inkomst", richting: "bij", grootboek: "8000", bedrag: 100000, btwCode: "21" });
  const pb3 = journaal.proefbalans(journaal.journaal(stam, { boekingen: [half], facturen: [f], koppelingen: [{ ...k, boekingId: half.id, bedrag: 100000 }] }));
  assert.equal(pb3.get("1300"), 263000);
});

// ---------------------------------------------------------------------------------- stap 2: afletteren
await test("afletteren: openstaand, deels, betaald, te veel, ouderdom en termijn", () => {
  const k = (bronId, bedrag, id = "k" + bedrag) => ({ id, boekingId: "b" + id, bron: "factuur", bronId, bedrag, aangemaakt: "" });
  const fs = [F({ id: "a", datum: "2026-10-20" }), F({ id: "b", datum: "2026-09-01" }), F({ id: "c", datum: "2026-07-01" }), F({ id: "d" }), F({ id: "e", totaal: -24200 })];
  const p = afl.factuurPosten(fs, [k("b", 100000), k("c", 363000), k("d", 400000), k("e", -24200)], VANDAAG);
  assert.deepEqual(p.map((x) => x.status), ["open", "deels", "betaald", "te_veel", "betaald"]);
  assert.deepEqual(p.map((x) => x.open), [363000, 263000, 0, -37000, 0]);
  assert.deepEqual(p.map((x) => x.ouderdom), ["0-30", "31-60", "60+", "60+", "60+"]);
  assert.deepEqual(p.map((x) => x.vervallen), [false, true, false, true, false]);
  const t = afl.ouderdomTotalen(p.slice(0, 2));
  assert.deepEqual([t.aantal, t.open, t.per["0-30"], t.per["31-60"]], [2, 626000, 363000, 263000]);
  // Bonnetjes: alleen zakelijk betaald en meetellend.
  const u = afl.uitgavePosten([U({ id: "1" }), U({ id: "2", betaalwijze: "prive" }), U({ id: "3", status: "concept" }), U({ id: "4", betaalwijze: null })], [], VANDAAG);
  assert.deepEqual(u.map((x) => x.doc.id), ["1", "4"]);
});
await test("afletteren: factuurnummer herkennen, suggesties met score", () => {
  assert.equal(afl.nummerIn("2026-018", "Betaling factuur 2026-018 Fysio"), true);
  assert.equal(afl.nummerIn("2026-018", "betaling 2026018"), true);
  assert.equal(afl.nummerIn("2026-01", "factuur 2026-018"), false);
  assert.equal(afl.nummerIn("2026-018", "factuur 12026-018"), false);
  assert.ok(afl.naamOvereenkomst("Hotel Zeezicht B.V.", "HOTEL ZEEZICHT ZANDVOORT") === 1);
  assert.equal(afl.naamOvereenkomst("Studio Vlakveld", "Overboeking"), 0);
  const fs = afl.factuurPosten([F({ id: "a", nummer: "2026-050", klant: "Hotel Zeezicht" }), F({ id: "b", nummer: "2026-051", klant: "Fysio Noord", totaal: 121000 }), F({ id: "c", nummer: "2026-052", klant: "Fysio Noord", datum: "2026-10-30" })], [], VANDAAG);
  const b = maak({ soort: "inkomst", richting: "bij", bedrag: 121000, datum: "2026-10-20", omschrijving: "Betaling", tegenpartij: "FYSIO NOORD" });
  const s = afl.koppelSuggesties(b, fs, [], []);
  assert.equal(s[0].bronId, "b");
  assert.equal(s[0].bedrag, 121000);
  assert.ok(!s.some((x) => x.bronId === "c"), "factuur na de betaling is geen kandidaat");
  const b2 = maak({ soort: "inkomst", richting: "bij", bedrag: 50000, datum: "2026-10-20", omschrijving: "Termijn 1 factuur 2026-050" });
  const s2 = afl.koppelSuggesties(b2, fs, [], []);
  assert.deepEqual([s2[0].bronId, s2[0].bedrag], ["a", 50000], "deelbetaling via factuurnummer");
  // Bonnetje: zelfde bedrag, datum dichtbij, leverancier.
  const us = afl.uitgavePosten([U({ id: "x", leverancier: "bol.com", totaal: 4295, datum: "2026-10-21" }), U({ id: "y", leverancier: "Coolblue", totaal: 4295, datum: "2026-06-01" })], [], VANDAAG);
  const af = maak({ bedrag: 4295, datum: "2026-10-22", omschrijving: "BOL.COM B.V. 4021886533", tegenpartij: "bol.com" });
  assert.deepEqual(afl.koppelSuggesties(af, [], us, []).map((x) => x.bronId), ["x"]);
  // Omgekeerd: betalingen bij een open factuur.
  const bs = afl.betalingSuggesties("factuur", fs[1], [b, b2, maak({})], []);
  assert.deepEqual(bs.map((x) => x.boeking.id), [b.id]);
  // Al volledig gekoppeld: geen suggesties meer.
  assert.deepEqual(afl.koppelSuggesties(b, fs, [], [{ id: "k", boekingId: b.id, bron: "factuur", bronId: "b", bedrag: 121000, aangemaakt: "" }]), []);
});
await test("afletteren: koppelregels (soort, bedragen, dubbel, mengen, vergrendeling)", () => {
  const v0 = { aangiften: [], boekjaren: [] };
  const vQ3 = { aangiften: [{ jaar: 2026, kwartaal: 3 }], boekjaren: [] };
  const ink = maak({ soort: "inkomst", richting: "bij", bedrag: 121000, datum: "2026-08-20" });
  const doc = { bron: "factuur", id: "a", totaal: 363000, open: 363000 };
  assert.equal(afl.koppelFout(ink, doc, 121000, [], v0), null);
  assert.match(afl.koppelFout(ink, { ...doc, bron: "uitgave" }, 121000, [], v0), /Uitgave/);
  assert.match(afl.koppelFout(maak({ soort: "prive", vennootId: "x" }), doc, 1, [], v0), /Alleen een uitgave of inkomst/);
  assert.match(afl.koppelFout(ink, doc, 121001, [], v0), /nog € 1\.210,00/);
  assert.match(afl.koppelFout(ink, { ...doc, open: 100 }, 121000, [], v0), /nog € 1,00 open/);
  assert.match(afl.koppelFout(ink, { ...doc, open: 0 }, 1, [], v0), /helemaal betaald/);
  assert.match(afl.koppelFout(ink, doc, -5, [], v0), /bankregel over/);
  const al = [{ id: "k", boekingId: ink.id, bron: "factuur", bronId: "a", bedrag: 1000, aangemaakt: "" }];
  assert.match(afl.koppelFout(ink, doc, 1000, al, v0), /al aan dit document/);
  assert.equal(afl.koppelFout(ink, { ...doc, id: "b" }, 120000, al, v0), null, "één betaling voor meerdere facturen");
  assert.match(afl.koppelFout(ink, { ...doc, id: "b" }, 120001, al, v0), /nog € 1\.200,00/);
  // Vergrendeld kwartaal: alleen als de regel zelf geen btw-effect heeft.
  assert.match(afl.koppelFout(ink, doc, 121000, [], vQ3), /wijzigen/);
  assert.equal(afl.koppelFout({ ...ink, btwCode: "geen", btw: 0 }, doc, 121000, [], vQ3), null);
  assert.match(afl.koppelFout({ ...ink, btwCode: "geen", btw: 0 }, doc, 121000, [], { aangiften: [], boekjaren: [2026] }), /Boekjaar 2026/);
  // Creditnota: terugbetaling (inkomst af) koppelt een negatief bedrag.
  const terug = maak({ soort: "inkomst", richting: "af", bedrag: 24200, datum: "2026-09-01" });
  assert.equal(afl.betaaldBedrag(terug), -24200);
  assert.equal(afl.koppelFout(terug, { bron: "factuur", id: "cn", totaal: -24200, open: -24200 }, -24200, [], v0), null);
  assert.equal(afl.standaardBedrag(-24200, -10000), -10000);
  assert.equal(afl.standaardBedrag(500, -10000), 0);
});
await test("afletteren: overboekingen paren, bon ontbreekt, ontvangsten zonder factuur, verweesd", () => {
  const a = maak({ soort: "overboeking", richting: "af", bedrag: 50000, datum: "2026-10-01", btwCode: "geen" });
  const b = maak({ soort: "overboeking", richting: "bij", rekeningId: RV, bedrag: 50000, datum: "2026-10-02", btwCode: "geen" });
  const c = maak({ soort: "overboeking", richting: "af", bedrag: 20000, datum: "2026-10-05", btwCode: "geen" });
  const o = afl.overboekingen([a, b, c]);
  assert.deepEqual([o.paren.length, o.los.map((x) => x.id)], [1, [c.id]]);
  const kpn = maak({ btwCode: "21" });
  const bank = maak({ btwCode: "geen", grootboek: "4900" });
  const adobe = maak({ btwCode: "eu_dienst" });
  const gek = maak({ btwCode: "21" });
  assert.deepEqual(afl.bonOntbreekt([kpn, bank, adobe, gek], new Set([gek.id])).map((x) => x.id), [kpn.id]);
  const ink = maak({ soort: "inkomst", richting: "bij" });
  assert.deepEqual(afl.inkomstenZonderFactuur([ink, kpn], new Set()).map((x) => x.id), [ink.id]);
  const w = afl.verweesdeKoppelingen([{ id: "1", boekingId: "x", bron: "factuur", bronId: "weg", bedrag: 1, aangemaakt: "" }, { id: "2", boekingId: "x", bron: "factuur", bronId: F().id, bedrag: 1, aangemaakt: "" }], [F()], []);
  assert.deepEqual(w.map((x) => x.id), ["1"]);
});

// ---------------------------------------------------------------------------------- stap 2: bankimport
const fixture = (n) => fs.readFileSync(path.join(ROOT, "scripts", "fixtures", "boekhouding", n), "utf8");
await test("bankimport: CSV-parser (aanhalingstekens, BOM, regeleinde in veld) en scheidingsteken", () => {
  assert.deepEqual(imp.leesCsv('﻿a;"b;c";"d ""e"""\r\n1;2;3\n\n'), [["a", "b;c", 'd "e"'], ["1", "2", "3"]]);
  assert.deepEqual(imp.leesCsv('x,"regel1\nregel2",z'), [["x", "regel1\nregel2", "z"]]);
  assert.equal(imp.raadScheiding("a;b;c\n1,5;2;3"), ";");
  assert.equal(imp.raadScheiding('"a","b"\n"1,5","2"'), ",");
  assert.equal(imp.raadScheiding("a\tb\n1\t2"), "\t");
  for (const [v, d] of [["24-10-2026", "2026-10-24"], ["1/2/2026", "2026-02-01"], ["2026-10-24 13:05:00", "2026-10-24"], ["20261024", "2026-10-24"], ["31-02-2026", null], ["x", null]]) assert.equal(imp.leesDatum(v), d, v);
  assert.equal(imp.leesBedrag("-1.234,56"), -123456);
  assert.equal(imp.leesBedrag("-48.40"), -4840);
  assert.equal(imp.hash("abc"), imp.hash("abc"));
  assert.notEqual(imp.hash("abc"), imp.hash("abd"));
});
await test("bankimport: RegioBank (Volksbank-formaat) herkend, bedragen met teken, sleutel = volgnummer", () => {
  const a = imp.leesAfschrift(fixture("regiobank.csv"));
  assert.equal(a.formaat, "regiobank");
  assert.equal(a.iban, "NL52RBRB0123456789");
  assert.deepEqual(a.regels.map((r) => r.bedrag), [302500, -4840, -50000, -104300, -950]);
  assert.deepEqual(a.regels.map((r) => r.datum), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05", "2026-10-06"]);
  assert.equal(a.regels[0].sleutel, "rb:202610000001");
  assert.equal(a.regels[0].tegenpartij, "Fysio Noord");
  assert.equal(a.regels[0].omschrijving, "Factuur 2026-054");
  assert.equal(a.regels[3].omschrijving, 'Btw Q3 2026, "aangifte"');
  assert.equal(a.regels[1].kenmerk, "9876543210");
  assert.equal(a.regels[4].tegenrekening, null);
  assert.equal(a.overgeslagen.length, 0);
});
await test("bankimport: Revolut Business (alleen COMPLETED, fee apart, alleen euro's) en persoonlijk", () => {
  const a = imp.leesAfschrift(fixture("revolut-business.csv"));
  assert.equal(a.formaat, "revolut");
  assert.deepEqual(a.regels.map((r) => [r.datum, r.bedrag]), [["2026-10-01", 50000], ["2026-10-04", -7139], ["2026-10-05", -1499], ["2026-10-05", -50], ["2026-10-08", 280000]]);
  assert.deepEqual(a.regels.map((r) => r.sleutel), ["rv:9c1e0000-0000-4000-8000-000000000001", "rv:9c1e0000-0000-4000-8000-000000000002", "rv:9c1e0000-0000-4000-8000-000000000003", "rv:9c1e0000-0000-4000-8000-000000000003:fee", "rv:9c1e0000-0000-4000-8000-000000000006"]);
  assert.equal(a.regels[3].bankkosten, true);
  assert.equal(a.regels[2].omschrijving, "Fontstand, licentie · Font");
  assert.equal(a.regels[4].tegenpartij, "Agentur Nordlicht GmbH");
  assert.deepEqual(a.overgeslagen.map((o) => o.reden), ["status pending", "in USD (alleen euro's)"]);
  const p = imp.leesAfschrift(fixture("revolut-prive.csv"));
  assert.equal(p.formaat, "revolut");
  assert.deepEqual(p.regels.map((r) => r.bedrag), [-1250, -1250, -5000, -25]);
  const sl = p.regels.map((r) => r.sleutel);
  assert.equal(new Set(sl).size, 4, "twee gelijke regels krijgen elk een eigen sleutel");
  assert.ok(sl[0].endsWith(":1") && sl[1].endsWith(":2"));
  // Opnieuw lezen = dezelfde sleutels (zo herkent de database dubbele regels).
  assert.deepEqual(imp.leesAfschrift(fixture("revolut-prive.csv")).regels.map((r) => r.sleutel), sl);
});
await test("bankimport: generiek formaat met kopregel en Af/Bij (gok + kolomkeuze)", () => {
  const a = imp.leesAfschrift(fixture("generiek-af-bij.csv"));
  assert.equal(a.formaat, "generiek");
  assert.equal(a.mappingNodig, false);
  assert.deepEqual([a.mapping.datum, a.mapping.bedrag, a.mapping.afBij, a.mapping.tegenrekening], [0, 6, 5, 3]);
  assert.deepEqual(a.regels.map((r) => [r.datum, r.bedrag]), [["2026-10-01", -6050], ["2026-10-02", 123456]]);
  assert.equal(a.kolommen[6], "Bedrag (EUR)");
  // Een herkend formaat kan toch via de kolomkeuze (formaat 'generiek' afgedwongen).
  const g = imp.leesAfschrift(fixture("revolut-business.csv"), { formaat: "generiek" });
  assert.equal(g.formaat, "generiek");
  assert.ok(g.mapping && g.kolommen[0].startsWith("Date started"));
  // Onzin-bestand: kolomkeuze nodig.
  const x = imp.leesAfschrift("foo;bar\nbaz;qux\n");
  assert.equal(x.mappingNodig, true);
  // Met een expliciete kolomkeuze (zonder kopregel).
  const m = { heeftKop: false, datum: 1, bedrag: 0, afBij: null, omschrijving: [2], tegenpartij: null, tegenrekening: null, sleutel: 3 };
  assert.equal(imp.isKolommapping(m), true);
  assert.equal(imp.isKolommapping({ ...m, bedrag: null }), false);
  assert.equal(imp.isKolommapping({ ...m, datum: -1 }), false);
  const y = imp.leesAfschrift("-12,50;03-10-2026;Lunch;ID1\n", { mapping: m });
  assert.deepEqual(y.regels.map((r) => [r.datum, r.bedrag, r.omschrijving, r.sleutel]), [["2026-10-03", -1250, "Lunch", "g:ID1"]]);
});
await test("bankimport: voorstel (eigen rekening, fee, geschiedenis, Belastingdienst, standaard)", () => {
  const rek = stam.rekeningen.map((r) => (r.id === RV ? { ...r, iban: "LT123250012345678901" } : r));
  const a = imp.leesAfschrift(fixture("regiobank.csv"));
  const hist = [
    maak({ omschrijving: "KPN Zakelijk september", tegenpartij: "KPN B.V.", grootboek: "4700", btwCode: "21", datum: "2026-09-02" }),
    maak({ soort: "inkomst", richting: "bij", omschrijving: "Betaling", tegenpartij: "Fysio Noord", grootboek: "8000", btwCode: "21", datum: "2026-05-02" }),
    maak({ omschrijving: "Kosten Zakelijk Pakket", tegenpartij: null, grootboek: "4900", btwCode: "geen", datum: "2026-09-01" }),
  ];
  const v = a.regels.map((r) => imp.stelVoor(r, hist, rek));
  assert.deepEqual(v.map((x) => [x.soort, x.bron]), [["inkomst", "geschiedenis"], ["uitgave", "geschiedenis"], ["overboeking", "eigen_rekening"], ["btw", "belastingdienst"], ["uitgave", "geschiedenis"]]);
  assert.deepEqual([v[1].grootboek, v[1].btwCode, v[4].grootboek, v[4].btwCode], ["4700", "21", "4900", "geen"]);
  const r = imp.leesAfschrift(fixture("revolut-business.csv")).regels;
  assert.deepEqual(imp.stelVoor(r[3], [], rek), { soort: "uitgave", btwCode: "geen", grootboek: "4900", vennootId: null, bron: "bankkosten" });
  assert.deepEqual(imp.stelVoor(r[2], [], rek).bron, "standaard");
  const w = imp.naarImportBoeking(a.regels[1], RB, v[1]);
  assert.deepEqual([w.soort, w.richting, w.bedrag, w.btw, w.status, w.sleutel], ["uitgave", "af", 4840, 840, "te_verwerken", "rb:202610000002"]);
  const o = imp.naarImportBoeking(a.regels[2], RB, v[2]);
  assert.deepEqual([o.soort, o.btwCode, o.btw, o.grootboek], ["overboeking", "geen", 0, null]);
  // Privé-voorstel zonder vennoot wordt een gewone uitgave.
  assert.equal(imp.naarImportBoeking(a.regels[1], RB, { soort: "prive", btwCode: "geen", grootboek: null, vennootId: null, bron: "geschiedenis" }).soort, "uitgave");
});

// ---------------------------------------------------------------------------------- stap 2: demo
await test("demo-seed: facturen, bonnetjes en koppelingen; debiteuren/crediteuren = openstaande posten", () => {
  assert.ok(data.facturen.length >= 25, `${data.facturen.length} facturen`);
  assert.ok(data.facturen.some((f) => f.verlegd) && data.facturen.some((f) => f.aanbetaling) && data.facturen.some((f) => f.restVan) && data.facturen.some((f) => f.totaal < 0) && data.facturen.some((f) => f.omzet < f.subtotaal));
  assert.ok(data.uitgaven.some((u) => u.betaalwijze === "prive") && data.uitgaven.some((u) => u.status === "concept"));
  assert.ok(data.koppelingen.length >= 25);
  assert.equal(new Set(data.facturen.map((f) => f.nummer)).size, data.facturen.length, "unieke factuurnummers");
  assert.ok(data.facturen.every((f) => f.datum <= VANDAAG) && data.uitgaven.every((u) => !u.datum || u.datum <= VANDAAG));
  const fp = afl.factuurPosten(data.facturen, data.koppelingen, VANDAAG);
  assert.ok(fp.every((p) => p.status !== "te_veel"));
  const open = fp.filter((p) => p.open !== 0);
  assert.ok(open.some((p) => p.status === "deels") && open.some((p) => p.ouderdom === "60+") && open.some((p) => p.doc.klant === "Studio Vlakveld"));
  const up = afl.uitgavePosten(data.uitgaven, data.koppelingen, VANDAAG).filter((p) => p.open !== 0);
  const pb = journaal.proefbalans(journaal.journaal(data.stamdata, alles(data)));
  assert.equal(pb.get("1300"), open.reduce((s, p) => s + p.open, 0), "debiteuren = som open facturen");
  assert.equal(-(pb.get("1600") ?? 0), up.reduce((s, p) => s + p.open, 0), "crediteuren = som open bonnetjes");
  assert.ok(pb.get("0210") > 0, "laptop geactiveerd via verfijning");
  assert.equal(pb.get("1900") ?? 0, 0, "geen vraagposten");
  // Elke koppeling klopt met de regels (soort, bedrag).
  for (const k of data.koppelingen) {
    const b = data.boekingen.find((x) => x.id === k.boekingId);
    assert.equal(afl.koppelBronVoor(b), k.bron);
    assert.equal(afl.betaaldBedrag(b), k.bedrag);
  }
  // Suggesties voor de te verwerken regels bol.com en Studio Vlakveld.
  const tv = data.boekingen.filter((b) => b.status === "te_verwerken");
  const metSugg = tv.filter((b) => afl.koppelSuggesties(b, fp, afl.uitgavePosten(data.uitgaven, data.koppelingen, VANDAAG), data.koppelingen, 1).length);
  assert.deepEqual(metSugg.map((b) => b.tegenpartij).sort(), ["Studio Vlakveld", "bol.com"]);
});
await test("demo-opslag: koppelen, ontkoppelen, verfijnen, importeren (2x = 0 nieuw)", async () => {
  const a = new demo.DemoRepo("test-k", "u-k");
  const nu = periode.vandaagNL();
  const [bs, ks, br] = await Promise.all([a.boekingen(), a.koppelingen(), a.bronnen()]);
  const fp = afl.factuurPosten(br.facturen, ks, nu);
  const vlak = fp.find((p) => p.doc.klant === "Studio Vlakveld" && p.open !== 0);
  const ontv = bs.find((b) => b.tegenpartij === "Studio Vlakveld");
  await assert.rejects(a.koppelingToevoegen({ boekingId: ontv.id, bron: "factuur", bronId: vlak.doc.id, bedrag: vlak.open + 1 }), (e) => e.status === 400);
  const k = await a.koppelingToevoegen({ boekingId: ontv.id, bron: "factuur", bronId: vlak.doc.id, bedrag: vlak.open });
  assert.equal((await a.boeking(ontv.id)).status, "geboekt");
  await assert.rejects(a.koppelingToevoegen({ boekingId: ontv.id, bron: "factuur", bronId: vlak.doc.id, bedrag: 1 }), (e) => e.status === 400);
  await a.koppelingVerwijderen(k.id);
  assert.equal((await a.koppelingen()).length, ks.length);
  // In een vergrendeld kwartaal ontkoppelen kan niet (de regel heeft eigen btw-gegevens).
  const stam2 = await a.stamdata();
  const oud = ks.find((x) => periode.isVergrendeld(bs.find((b) => b.id === x.boekingId).datum, stam2.vergrendeling));
  await assert.rejects(a.koppelingVerwijderen(oud.id), (e) => e.status === 409);
  // Verfijning in een vergrendeld kwartaal: geweigerd; in een open kwartaal: ok.
  const oudeFactuur = br.facturen.find((f) => periode.isVergrendeld(f.datum, stam2.vergrendeling));
  await assert.rejects(a.bronExtraOpslaan({ bron: "factuur", bronId: oudeFactuur.id, btwCode: "eu_dienst", grootboek: null, vennootId: null, notitie: null }), (e) => e.status === 409);
  await a.bronExtraOpslaan({ bron: "factuur", bronId: vlak.doc.id, btwCode: null, grootboek: "8900", vennootId: null, notitie: "test" });
  assert.equal((await a.bronExtra()).find((e) => e.bronId === vlak.doc.id).grootboek, "8900");
  // Import: de voorbeeldafschriften, twee keer.
  const vb = a.voorbeeldAfschriften();
  const st = await a.stamdata();
  for (const [soort, rekId] of [["regiobank", RB], ["revolut", RV]]) {
    const af = imp.leesAfschrift(vb[soort]);
    assert.equal(af.formaat, soort);
    const boek = await a.boekingen();
    const regelsImp = af.regels.map((r) => imp.naarImportBoeking(r, rekId, imp.stelVoor(r, boek, st.rekeningen)));
    const eerste = await a.importeer(rekId, { bestandsnaam: "x.csv", formaat: soort }, regelsImp);
    assert.ok(eerste.nieuw >= 4 && eerste.dubbel === 0, JSON.stringify(eerste));
    const tweede = await a.importeer(rekId, { bestandsnaam: "x.csv", formaat: soort }, regelsImp);
    assert.deepEqual(tweede, { nieuw: 0, dubbel: regelsImp.length });
    if (soort === "regiobank") {
      const ov = regelsImp.find((r) => r.omschrijving === "Overboeking naar Revolut");
      assert.equal(ov.soort, "overboeking", "tegenrekening = eigen Revolut-rekening");
    } else {
      assert.equal(af.overgeslagen.length, 2, "pending en USD overgeslagen");
      assert.ok(af.regels.some((r) => r.bankkosten));
    }
  }
  // Na de import: de betaling van de oudste open factuur heeft een koppelsuggestie.
  const boek2 = await a.boekingen();
  const fp2 = afl.factuurPosten(br.facturen, await a.koppelingen(), nu);
  const nieuweInk = boek2.filter((b) => b.importId && b.soort === "inkomst");
  assert.ok(nieuweInk.length >= 1 && nieuweInk.every((b) => afl.koppelSuggesties(b, fp2, [], [], 1)[0]?.score >= 90));
  demo.demoHerstellen("test-k");
});


// ---------------------------------------------------------------------------------- stap 3: afschrijving
const A = (o = {}) => ({
  id: "a0000000-0000-4000-8000-000000000001", omschrijving: "MacBook", categorie: "0210", aanschafdatum: "2026-03-15", ingebruikname: "2026-03-15",
  aanschaf: 249900, restwaarde: 0, looptijdMaanden: 60, uitgaveId: null, boekingId: null, desinvesteringDatum: null, desinvesteringOpbrengst: null, notities: null, aangemaakt: "", ...o,
});
await test("afschrijving: € 2.499 in 5 jaar vanaf half maart — exact, eerste en laatste maand", () => {
  const s = afs.schema(A());
  assert.equal(s.length, 60);
  assert.ok(s.every((r) => r.afschrijving === 4165));
  assert.equal(s.reduce((t, r) => t + r.afschrijving, 0), 249900);
  assert.deepEqual([s[0].datum, s[59].datum, s[59].boekwaarde], ["2026-03-31", "2031-02-28", 0]);
  assert.deepEqual(afs.maandbedrag(A()), { gewoon: 4165, laatste: 4165 });
  // Per jaar: 2026 = 10 maanden (maart t/m december).
  assert.deepEqual(afs.perJaar(A()).map((r) => [r.jaar, r.afschrijving]), [[2026, 41650], [2027, 49980], [2028, 49980], [2029, 49980], [2030, 49980], [2031, 8330]]);
  assert.equal(afs.eindeAfschrijving(A()), "2031-02");
});
await test("afschrijving: 3 jaar en vrije termijn, laatste maand corrigeert, restwaarde", () => {
  const drie = A({ aanschaf: 200000, looptijdMaanden: 36 });
  const s = afs.schema(drie);
  assert.deepEqual(afs.maandbedrag(drie), { gewoon: 5555, laatste: 5575 });
  assert.equal(s.reduce((t, r) => t + r.afschrijving, 0), 200000);
  assert.equal(s.at(-1).boekwaarde, 0);
  const vrij = A({ aanschaf: 100001, looptijdMaanden: 48 });
  assert.equal(afs.schema(vrij).reduce((t, r) => t + r.afschrijving, 0), 100001);
  const rw = A({ aanschaf: 100000, restwaarde: 10000, looptijdMaanden: 36 });
  assert.equal(afs.schema(rw).at(-1).boekwaarde, 10000);
  assert.ok(afs.schema(rw).every((r) => r.afschrijving === 2500));
  // Klein bedrag: nooit negatief, som klopt.
  const klein = afs.schema(A({ aanschaf: 31, looptijdMaanden: 60 }));
  assert.ok(klein.every((r) => r.afschrijving >= 0));
  assert.equal(klein.reduce((t, r) => t + r.afschrijving, 0), 31);
  assert.equal(afs.looptijdLabel(36), "3 jaar");
  assert.equal(afs.looptijdLabel(30), "30 maanden");
});
await test("afschrijving: boekwaarde op datum, desinvestering met boekwinst en -verlies", () => {
  const a = A();
  assert.equal(afs.boekwaardeOp(a, "2026-03-14"), 0, "vóór aanschaf");
  assert.equal(afs.boekwaardeOp(a, "2026-03-30"), 249900);
  assert.equal(afs.boekwaardeOp(a, "2026-03-31"), 245735);
  assert.equal(afs.boekwaardeOp(a, "2026-12-31"), 249900 - 41650);
  const verkocht = A({ desinvesteringDatum: "2027-06-10", desinvesteringOpbrengst: 150000 });
  const s = afs.schema(verkocht);
  assert.equal(s.at(-1).maand, "2027-05", "afschrijving t/m de maand vóór de verkoop");
  assert.equal(s.length, 15);
  assert.equal(afs.boekwaardeBijDesinvestering(verkocht), 249900 - 15 * 4165);
  assert.equal(afs.boekresultaat(verkocht), 150000 - (249900 - 15 * 4165));
  assert.equal(afs.boekwaardeOp(verkocht, "2027-06-10"), 0);
  const weg = A({ desinvesteringDatum: "2027-06-10", desinvesteringOpbrengst: 0 });
  assert.ok(afs.boekresultaat(weg) < 0, "boekverlies bij weggooien");
});
await test("afschrijving: activastaat sluit (begin + investering − afschrijving − desinvestering = eind)", () => {
  const lijst = [A(), A({ id: "b", aanschafdatum: "2025-01-10", ingebruikname: "2025-02-01", aanschaf: 120000, looptijdMaanden: 36, categorie: "0200" }), A({ id: "c", aanschafdatum: "2024-05-01", ingebruikname: "2024-05-01", aanschaf: 90000, looptijdMaanden: 36, desinvesteringDatum: "2026-08-20", desinvesteringOpbrengst: 30000 })];
  for (const j of [2024, 2025, 2026, 2027, 2031]) {
    const { regels, totaal } = afs.activastaat(lijst, j);
    assert.equal(totaal.begin + totaal.investering - totaal.afschrijving - totaal.desinvestering, totaal.eind, String(j));
    for (const r of regels) assert.equal(r.begin + r.investering - r.afschrijving - r.desinvestering, r.eind);
  }
  const s26 = afs.activastaat(lijst, 2026);
  assert.equal(s26.totaal.investering, 249900);
  assert.equal(s26.regels.length, 3);
  assert.equal(afs.activastaat(lijst, 2027).regels.length, 2, "gedesinvesteerd valt het jaar erna weg");
});
await test("afschrijving: invoercontrole, hints en vergrendeling", () => {
  const p = (b) => afs.parseActivumInvoer({ omschrijving: "Camera", aanschafdatum: "2026-05-19", aanschaf: "1.850,00", jaren: 3, ...b }, { vandaag: "2026-10-24" });
  const ok = p({});
  assert.equal(ok.ok, true, ok.fout);
  assert.deepEqual([ok.waarde.aanschaf, ok.waarde.looptijdMaanden, ok.waarde.ingebruikname, ok.waarde.categorie, ok.waarde.restwaarde], [185000, 36, "2026-05-19", "0210", 0]);
  assert.equal(p({ jaren: undefined, looptijdMaanden: 30 }).waarde.looptijdMaanden, 30);
  for (const [b, veld] of [
    [{ omschrijving: " " }, "omschrijving"],
    [{ aanschaf: "0" }, "aanschaf"],
    [{ restwaarde: "1850" }, "restwaarde"],
    [{ jaren: undefined, looptijdMaanden: 6 }, "looptijdMaanden"],
    [{ jaren: 25 }, "looptijdMaanden"],
    [{ aanschafdatum: "2027-01-01" }, "aanschafdatum"],
    [{ ingebruikname: "2026-05-01" }, "ingebruikname"],
    [{ categorie: "4010" }, "categorie"],
    [{ uitgaveId: "a0000000-0000-4000-8000-000000000001", boekingId: "a0000000-0000-4000-8000-000000000002" }, "herkomst"],
    [{ desinvesteringDatum: "2026-05-01" }, "desinvesteringDatum"],
  ]) {
    const r = p(b);
    assert.equal(r.ok, false, JSON.stringify(b));
    assert.equal(r.veld, veld, JSON.stringify(b));
  }
  assert.deepEqual(afs.activumHints({ aanschaf: 40000, looptijdMaanden: 60, restwaarde: 0 }).map((h) => h.soort), ["hint"]);
  assert.deepEqual(afs.activumHints({ aanschaf: 185000, looptijdMaanden: 36, restwaarde: 0 }).map((h) => h.soort), ["let_op"]);
  assert.deepEqual(afs.activumHints({ aanschaf: 185000, looptijdMaanden: 60, restwaarde: 0 }), []);
  // Vergrendeling (zelfde regel als de trigger bk_activa_periode).
  const v = (boekjaren, dicht = []) => ({ boekjaren, open: (d) => !dicht.includes(d.slice(0, 7)) });
  const w = afs.parseActivumInvoer(afs.activumAlsInvoer(A()), { vandaag: "2026-10-24" }).waarde;
  assert.equal(afs.activumVergrendelFout(null, w, v([])), null);
  assert.match(afs.activumVergrendelFout(null, w, v([2026])), /afgesloten/);
  assert.match(afs.activumVergrendelFout(A(), { ...w, looptijdMaanden: 36 }, v([2026])), /vast/);
  assert.equal(afs.activumVergrendelFout(A(), { ...w, notities: "x" }, v([2026])), null, "notities mogen altijd");
  assert.match(afs.activumVergrendelFout(A(), { ...w, desinvesteringDatum: "2026-06-10", desinvesteringOpbrengst: 0 }, v([], ["2026-06"])), /vergrendeld/);
  assert.match(afs.activumVergrendelFout(A(), null, v([2027])), /vast/);
});

// ---------------------------------------------------------------------------------- stap 3: journaal activa
await test("journaal: activa — inbreng, afschrijving per maand, desinvestering; geactiveerde aankoop niet als kosten", () => {
  const inbreng = A({ id: "inb", aanschafdatum: "2025-01-01", ingebruikname: "2025-01-01", aanschaf: 120000, looptijdMaanden: 24, categorie: "0200", desinvesteringDatum: "2026-04-15", desinvesteringOpbrengst: 30000 });
  const p = journaal.activumPosten(inbreng);
  assert.equal(regels(p[0]), "0200:D120000 0900:C120000");
  const afschr = p.filter((x) => x.bron === "afschrijving");
  assert.equal(afschr.length, 15, "jan 2025 t/m maart 2026");
  assert.equal(regels(afschr[0]), "0209:C5000 4800:D5000");
  assert.equal(regels(p.at(-1)), "0200:C120000 0209:D75000 8900:D45000");
  // Bonnetje geactiveerd: de kostenkant wordt 0210 (rest naar kleine hardware).
  const c = journaal.contextUit(stam);
  const u = U({ totaal: 302379, btw: 52479, categorie: "hardware" });
  assert.equal(regels(journaal.uitgaveNaarPost(u, c, null, { categorie: "0210", aanschaf: 249900 })), "0210:D249900 1520:D52479 1600:C302379");
  assert.equal(regels(journaal.uitgaveNaarPost(u, c, null, { categorie: "0210", aanschaf: 200000 })), "0210:D200000 1520:D52479 1600:C302379 4010:D49900");
  // Bankregel geactiveerd.
  const b = maak({ bedrag: 223850, btwCode: "21", grootboek: "4010" });
  assert.equal(regels(journaal.boekingNaarPost(b, ctx, [], { categorie: "0210", aanschaf: 185000 })), "0210:D185000 1100:C223850 1520:D38850");
  // Volledig journaal: W&V-afschrijving per jaar = activastaat; 0210 − 0219 = boekwaarde.
  const act = A({ id: "act", boekingId: b.id, aanschafdatum: b.datum, ingebruikname: b.datum, aanschaf: 185000, looptijdMaanden: 36 });
  const posten = journaal.journaal(stam, { boekingen: [b], activa: [act, inbreng] });
  const pb = journaal.proefbalans(posten, "2026-12-31");
  assert.equal([...pb.values()].reduce((x, y) => x + y, 0), 0);
  assert.equal(pb.get("4010") ?? 0, 0, "aanschaf niet als kosten");
  assert.equal((pb.get("0210") ?? 0) + (pb.get("0219") ?? 0), afs.boekwaardeOp(act, "2026-12-31"));
  assert.equal((pb.get("0200") ?? 0) + (pb.get("0209") ?? 0), 0, "gedesinvesteerd: niets meer op de balans");
  const kosten26 = posten.filter((x) => x.datum.startsWith("2026")).flatMap((x) => x.regels).filter((r) => r.grootboek === "4800").reduce((t, r) => t + r.debet - r.credit, 0);
  assert.equal(kosten26, afs.activastaat([act, inbreng], 2026).totaal.afschrijving);
  // Twee activa uit één aankoop met dezelfde soort tellen samen.
  const m = journaal.activeringen([act, { ...act, id: "x", aanschaf: 1000 }]);
  assert.equal(m.perBoeking.get(b.id).aanschaf, 186000);
});

// ---------------------------------------------------------------------------------- stap 3: aangifte
await test("aangifte: afronden op hele euro's in je voordeel (ook negatief)", () => {
  assert.deepEqual([ag.euroOmlaag(123499), ag.euroOmlaag(123400), ag.euroOmlaag(-150), ag.euroOmlaag(-100), ag.euroOmlaag(0), ag.euroOmlaag(99)], [1234, 1234, -2, -1, 0, 0]);
  assert.deepEqual([ag.euroOmhoog(123401), ag.euroOmhoog(123400), ag.euroOmhoog(-150), ag.euroOmhoog(1)], [1235, 1234, -1, 1]);
  assert.equal(geld.formatHeleEuro(17800), "€ 17.800");
  assert.equal(geld.formatHeleEuro(-12), "−€ 12");
});
const kwartaalPosten = () => {
  const c = journaal.contextUit(stam);
  const lijst = [
    maak({ id: "i21", soort: "inkomst", richting: "bij", bedrag: 121050, btwCode: "21", grootboek: "8000", datum: "2026-07-02" }),
    maak({ id: "i9", soort: "inkomst", richting: "bij", bedrag: 10900, btwCode: "9", grootboek: "8000", datum: "2026-07-03" }),
    maak({ id: "u21", bedrag: 4840, btwCode: "21", grootboek: "4700", datum: "2026-07-12" }),
    maak({ id: "u9", bedrag: 3815, btwCode: "9", grootboek: "4200", datum: "2026-08-15" }),
    maak({ id: "ueu", bedrag: 7139, btwCode: "eu_dienst", grootboek: "4000", datum: "2026-08-03" }),
    maak({ id: "uus", bedrag: 3000, btwCode: "buiten_eu", grootboek: "4000", datum: "2026-08-08" }),
    maak({ id: "unl", bedrag: 50000, btwCode: "verlegd_nl", grootboek: "4600", datum: "2026-09-01" }),
    maak({ id: "ug", bedrag: 950, btwCode: "geen", grootboek: "4900", datum: "2026-09-01" }),
    maak({ id: "q4", soort: "inkomst", richting: "bij", bedrag: 12100, btwCode: "21", grootboek: "8000", datum: "2026-10-01" }),
    maak({ id: "terug", soort: "inkomst", richting: "af", bedrag: 2420, btwCode: "21", grootboek: "8000", datum: "2026-09-20" }),
  ];
  const facturen = [F({ datum: "2026-07-10" }), F({ id: "f-eu", nummer: "2026-051", datum: "2026-08-01", subtotaal: 280000, omzet: 280000, btw: 0, totaal: 280000, btwPct: 0, verlegd: true, verlegdReden: "intracommunautaire dienst" }), F({ id: "f-nl", nummer: "2026-052", datum: "2026-08-02", subtotaal: 50000, omzet: 50000, btw: 0, totaal: 50000, btwPct: 0, verlegd: true, verlegdReden: "onderaanneming" })];
  return { lijst, facturen, posten: journaal.journaal(stam, { boekingen: lijst, facturen }), c };
};
await test("aangifte: rubrieken 1a–4b, 5a/5b/5c uit het journaal (facturen + losse regels)", () => {
  const { posten } = kwartaalPosten();
  const a = ag.aangifteRubrieken(posten, 2026, 3);
  const r = a.rubrieken;
  // 1a: 1000,41 + 3000,00 − 20,00 (terugbetaling) = 3980,41 omzet; btw 210,09 + 630,00 − 4,20 = 835,89
  assert.deepEqual([r["1a"].grondslag.centen, r["1a"].btw.centen, r["1a"].grondslag.euro, r["1a"].btw.euro], [398041, 83589, 3980, 835]);
  assert.deepEqual([r["1b"].grondslag.centen, r["1b"].btw.centen, r["1b"].btw.euro], [10000, 900, 9]);
  assert.deepEqual([r["3b"].grondslag.euro, r["3b"].btw.euro], [2800, 0]);
  assert.deepEqual([r["1e"].grondslag.euro, r["1e"].btw.euro], [500, 0]);
  assert.deepEqual([r["2a"].grondslag.centen, r["2a"].btw.centen, r["2a"].btw.euro], [50000, 10500, 105]);
  assert.deepEqual([r["4a"].grondslag.centen, r["4a"].btw.centen, r["4a"].btw.euro], [3000, 630, 6]);
  assert.deepEqual([r["4b"].grondslag.centen, r["4b"].btw.centen, r["4b"].btw.euro], [7139, 1499, 14]);
  for (const k of ["1c", "1d", "3a", "3c"]) assert.deepEqual(r[k], { grondslag: { centen: 0, euro: 0 }, btw: { centen: 0, euro: 0 } });
  // 5a = som van de afgeronde btw; 5b naar boven; 5c = 5a − 5b.
  assert.equal(a.verschuldigd.euro, 835 + 9 + 105 + 6 + 14);
  assert.equal(a.verschuldigd.centen, 83589 + 900 + 10500 + 630 + 1499);
  const vb = 840 + 315 + 1499 + 630 + 10500; // KPN 21%, NS 9%, en de verlegde btw (aftrekbaar)
  assert.deepEqual([a.voorbelasting.centen, a.voorbelasting.euro], [vb, Math.ceil(vb / 100)]);
  assert.equal(a.saldo.euro, a.verschuldigd.euro - a.voorbelasting.euro);
  assert.equal(ag.teBetalenCenten(a), a.saldo.euro * 100);
  assert.ok(ag.afrondingsverschil(a) >= 0, "afronding altijd in het voordeel");
  // Q4-regel en vrijgestelde bankkosten tellen niet; posten per rubriek voor de doorklik.
  assert.ok(!a.posten["1a"].includes("boeking:q4"));
  assert.ok(!Object.values(a.posten).flat().includes("boeking:ug"));
  assert.ok(a.posten["5b"].includes("boeking:ueu") && a.posten["4b"].includes("boeking:ueu"));
  assert.deepEqual(a.posten["3b"], ["factuur:f-eu"]);
  // Snapshot is JSON-veilig en wordt weer ingelezen.
  const snap = JSON.parse(JSON.stringify(ag.naarSnapshot(a)));
  assert.deepEqual(ag.leesSnapshot(snap), snap);
  assert.equal(ag.leesSnapshot({ versie: 2 }), null);
  assert.equal(ag.leesSnapshot({ ...snap, saldo: { centen: 1.5, euro: 0 } }), null);
});
await test("aangifte: afsluitpost bij indienen — 1530 = aangegeven bedrag, betaling maakt 1530 nul", () => {
  const { lijst, facturen, posten } = kwartaalPosten();
  const ber = ag.aangifteRubrieken(posten, 2026, 3);
  const aangifte = { id: "ag3", jaar: 2026, kwartaal: 3, snapshot: ag.naarSnapshot(ber) };
  const met = journaal.journaal(stam, { boekingen: lijst, facturen, aangiften: [aangifte] });
  const sluit = met.find((p) => p.bron === "btw_afsluiting");
  assert.equal(sluit.datum, "2026-09-30");
  const pb = journaal.proefbalans(met, "2026-09-30");
  for (const g of ["1500", "1505", "1510", "1520"]) assert.equal(pb.get(g) ?? 0, 0, g);
  assert.equal(-(pb.get("1530") ?? 0), ag.teBetalenCenten(ber), "1530 = te betalen volgens het formulier");
  const voor = journaal.proefbalans(posten, "2026-09-30").get("8900") ?? 0;
  assert.equal(voor - pb.get("8900"), ag.afrondingsverschil(ber), "afronding naar 8900");
  // Betaling aan de Belastingdienst (soort btw) maakt 1530 nul.
  const betaling = maak({ id: "bd", soort: "btw", richting: "af", bedrag: ag.teBetalenCenten(ber), btwCode: "geen", grootboek: null, datum: "2026-10-28" });
  const na = journaal.proefbalans(journaal.journaal(stam, { boekingen: [...lijst, betaling], facturen, aangiften: [aangifte] }));
  assert.equal(na.get("1530") ?? 0, 0);
  assert.equal([...na.values()].reduce((x, y) => x + y, 0), 0);
  // Drift: een factuur wijzigt na indiening → het verschil blijft op 1530 en de vergelijking signaleert het.
  const gewijzigd = facturen.map((f) => (f.id === "f0000000-0000-4000-8000-000000000001" ? { ...f, subtotaal: 400000, omzet: 400000, btw: 84000, totaal: 484000 } : f));
  const drift = journaal.journaal(stam, { boekingen: [...lijst, betaling], facturen: gewijzigd, aangiften: [aangifte] });
  assert.equal(-(journaal.proefbalans(drift).get("1530") ?? 0), 21000);
  const vgl = ag.vergelijkMetIngediend(aangifte.snapshot, ag.aangifteRubrieken(drift, 2026, 3));
  assert.equal(vgl.verschil, 21000);
  assert.equal(vgl.advies, "volgende_aangifte");
  assert.ok(vgl.rubrieken.some((r) => r.rubriek === "1a" && r.soort === "btw"));
  const groot = facturen.map((f) => (f.id === "f0000000-0000-4000-8000-000000000001" ? { ...f, subtotaal: 1000000, omzet: 1000000, btw: 210000, totaal: 1210000 } : f));
  assert.equal(ag.vergelijkMetIngediend(aangifte.snapshot, ag.aangifteRubrieken(journaal.journaal(stam, { boekingen: lijst, facturen: groot }), 2026, 3)).advies, "suppletie");
  assert.equal(ag.vergelijkMetIngediend(aangifte.snapshot, ber).advies, "geen");
});
await test("aangifte: kwartaalstatus, volgende aangifte en betaalcontrole", () => {
  const { posten } = kwartaalPosten();
  const a3 = { id: "x3", jaar: 2026, kwartaal: 3, ingediendOp: "2026-10-20T10:00:00Z", ingediendDoor: null, kenmerk: null, opmerking: null, snapshot: null, teBetalen: 50000 };
  const rijen = ag.kwartaalOverzicht({ posten, aangiften: [a3], betalingen: [], vanaf: "2026-01-15", vandaag: "2026-10-24" });
  assert.deepEqual(rijen.map((r) => `${r.kwartaal}:${r.status}`), ["4:lopend", "3:ingediend", "2:te_laat", "1:te_laat"]);
  const betaald = ag.kwartaalOverzicht({ posten, aangiften: [a3], betalingen: [{ id: "b", boekingId: "x", aangifteId: "x3", bedrag: 50000 }], vanaf: "2026-07-01", vandaag: "2026-10-24" });
  assert.equal(betaald.find((r) => r.kwartaal === 3).status, "betaald");
  const zonder = ag.kwartaalOverzicht({ posten, aangiften: [], betalingen: [], vanaf: "2026-07-01", vandaag: "2026-10-24" });
  assert.equal(zonder.find((r) => r.kwartaal === 3).status, "te_doen");
  assert.equal(ag.volgendeAangifte(zonder).kwartaal, 3);
  assert.equal(ag.volgendeAangifte(rijen).kwartaal, 1, "oudste openstaande eerst");
  assert.equal(ag.kwartalenTot("2025-09-01", "2026-10-24").length, 6);
  const f = (o) => ag.betalingFout({ soort: "btw", richting: "af", bankBedrag: 50000, alGekoppeld: 0, aangifte: a3, bedrag: 50000, ...o });
  assert.equal(f({}), null);
  assert.match(f({ soort: "uitgave" }), /Btw-aangifte/);
  assert.match(f({ richting: "bij" }), /betaling/);
  assert.match(f({ bedrag: 60000 }), /hoger/);
  assert.match(f({ bedrag: -100 }), /Ongeldig/);
  assert.equal(ag.betalingFout({ soort: "btw", richting: "bij", bankBedrag: 1000, alGekoppeld: 0, aangifte: { ...a3, teBetalen: -1000 }, bedrag: -1000 }), null, "teruggaaf");
});

// ---------------------------------------------------------------------------------- stap 3: activeren en controles
await test("activeren: bron controleren (bankregel/bonnetje), bedrag ≤ excl., voorstellen en controles", () => {
  const b = maak({ id: "cam", bedrag: 223850, btwCode: "21", grootboek: "4010", datum: "2026-05-19" });
  const ink = maak({ id: "ink", soort: "inkomst", richting: "bij", grootboek: "8000" });
  const gek = maak({ id: "gek", bedrag: 302379, grootboek: "0210", datum: "2026-03-06" });
  const lap = U({ id: "lap", datum: "2026-03-05", totaal: 302379, btw: 52479 });
  const concept = U({ id: "con", status: "concept", totaal: 99999 });
  const ctxA = { boekingen: [b, ink, gek], uitgaven: [lap, concept], koppelingen: [{ id: "k", boekingId: "gek", bron: "uitgave", bronId: "lap", bedrag: 302379, aangemaakt: "" }], bronExtra: [], activa: [] };
  assert.equal(act.boekingExcl(b), 185000);
  assert.equal(act.uitgaveExcl(lap), 249900);
  assert.equal(act.uitgaveExcl(U({ tarief: "verlegd", btw: 0, totaal: 7139 })), 7139);
  assert.equal(act.herkomstVan({ boekingId: "cam", uitgaveId: null }, ctxA).herkomst.excl, 185000);
  assert.match(act.herkomstVan({ boekingId: "ink", uitgaveId: null }, ctxA).fout, /uitgave/);
  assert.match(act.herkomstVan({ boekingId: "gek", uitgaveId: null }, ctxA).fout, /bonnetje/);
  assert.match(act.herkomstVan({ boekingId: null, uitgaveId: "con" }, ctxA).fout, /concept/);
  const w = { ...A({ boekingId: "cam", aanschafdatum: "2026-05-19", ingebruikname: "2026-05-19", aanschaf: 185000, looptijdMaanden: 36 }) };
  assert.equal(act.activumBronFout(w, ctxA), null);
  assert.match(act.activumBronFout({ ...w, aanschaf: 185001 }, ctxA), /hoger/);
  assert.match(act.activumBronFout({ ...w, aanschafdatum: "2026-05-20" }, ctxA), /datum/);
  assert.match(act.activumBronFout({ ...w, aanschaf: 100000 }, { ...ctxA, activa: [{ ...w, id: "x", aanschaf: 90000 }] }), /samen hoger/);
  assert.match(act.activumBronFout({ ...w, aanschaf: 1000 }, { ...ctxA, activa: [{ ...w, id: "x", categorie: "0200", aanschaf: 1000 }] }), /soort/);
  // Voorstellen: hardware ≥ € 450 op de bank en het bonnetje (de gekoppelde betaling niet).
  const v = act.teActiveren(ctxA);
  assert.deepEqual(v.map((x) => `${x.soort}:${x.id}`).sort(), ["boeking:cam", "uitgave:lap"]);
  assert.deepEqual(act.teActiveren({ ...ctxA, activa: [{ ...w, id: "x" }] }).map((x) => x.id), ["lap"]);
  const opActiva = maak({ id: "inv", bedrag: 60500, btwCode: "21", grootboek: "0200" });
  assert.match(act.teActiveren({ ...ctxA, boekingen: [opActiva] })[0].reden, /zonder activum/);
  const klein = maak({ id: "kl", bedrag: 34900, btwCode: "21", grootboek: "4010" });
  assert.equal(act.teActiveren({ ...ctxA, boekingen: [klein], uitgaven: [] }).length, 0, "onder € 450 geen voorstel");
  // Controles: bron weg of te laag.
  assert.deepEqual(act.activaControles({ ...ctxA, activa: [{ ...w, id: "x" }] }), []);
  assert.match(act.activaControles({ ...ctxA, boekingen: [], activa: [{ ...w, id: "x" }] })[0].tekst, /bestaat niet/);
});
await test("btw-controles: te verwerken, bon ontbreekt, verlegd 1e, ICP, eerdere kwartalen, lopend", () => {
  const { lijst, facturen, posten } = kwartaalPosten();
  const kw = ag.kwartaalOverzicht({ posten, aangiften: [], betalingen: [], vanaf: "2026-04-01", vandaag: "2026-10-24" });
  const c = ctl.btwControles({ jaar: 2026, kwartaal: 3, vandaag: "2026-10-24", boekingen: [...lijst, maak({ id: "tv", status: "te_verwerken", datum: "2026-09-02" })], facturen, uitgaven: [U({ datum: "2026-08-01", status: "concept" })], koppelingen: [], bronExtra: [], kwartalen: kw });
  const per = Object.fromEntries(c.map((x) => [x.id, x]));
  assert.equal(per.te_verwerken.aantal, 1);
  assert.equal(per.te_verwerken.soort, "let_op");
  assert.ok(per.bon.aantal >= 2);
  assert.equal(per.concept.aantal, 1);
  assert.equal(per.verlegd.aantal, 1);
  assert.equal(per.verlegd.regels[0].actie.btwCode, "eu_dienst");
  assert.equal(per.icp.regels[0].bedrag, 280000);
  assert.equal(per.eerder.aantal, 1, "Q2 nog niet ingediend");
  assert.equal(per.lopend, undefined);
  const lopend = ctl.btwControles({ jaar: 2026, kwartaal: 4, vandaag: "2026-10-24", boekingen: [], facturen: [], uitgaven: [], koppelingen: [], bronExtra: [{ bron: "factuur", bronId: "f-nl", btwCode: "eu_dienst", grootboek: null, vennootId: null, notitie: null }], kwartalen: [] });
  assert.equal(lopend.find((x) => x.id === "lopend").soort, "info");
  assert.equal(lopend.find((x) => x.id === "te_verwerken").soort, "ok");
});

// ---------------------------------------------------------------------------------- stap 3: demo
await test("demo-seed: activa (laptop 5 jaar via bonnetje, camera 3 jaar via bank, inbreng, verkochte camera)", () => {
  const per = Object.fromEntries(data.activa.map((a) => [a.omschrijving, a]));
  const lap = per['MacBook Pro 14"'];
  assert.deepEqual([lap.aanschaf, lap.looptijdMaanden, lap.categorie, Boolean(lap.uitgaveId)], [249900, 60, "0210", true]);
  assert.equal(afs.maandbedrag(lap).gewoon, 4165);
  const cam = per["Sony A7 IV + 24-70 mm"];
  assert.deepEqual([cam.aanschaf, cam.looptijdMaanden, Boolean(cam.boekingId)], [185000, 36, true]);
  assert.ok(per["Canon EOS R (oud)"].desinvesteringDatum && afs.boekresultaat(per["Canon EOS R (oud)"]) > 0);
  const ctxA = { boekingen: data.boekingen, uitgaven: data.uitgaven, koppelingen: data.koppelingen, bronExtra: data.bronExtra, activa: data.activa };
  assert.deepEqual(act.activaControles(ctxA), []);
  assert.deepEqual(act.teActiveren(ctxA), [], "alles wat te activeren is, is geactiveerd");
  const posten = journaal.journaal(data.stamdata, { ...alles(data), aangiften: data.aangiften });
  const pb = journaal.proefbalans(posten, VANDAAG);
  const staat = afs.activastaat(data.activa, 2026);
  const bw = data.activa.reduce((t, a) => t + afs.boekwaardeOp(a, VANDAAG), 0);
  assert.equal(pb.get("0200") + pb.get("0209") + pb.get("0210") + pb.get("0219"), bw, "balans = boekwaarde");
  assert.ok(staat.totaal.afschrijving > 0 && staat.totaal.investering === 249900 + 185000);
});
await test("demo-opslag: aangifte indienen, betaling koppelen, intrekken; activa toevoegen, wijzigen, verwijderen", async () => {
  const r = new demo.DemoRepo("test-ag", "u-ag");
  const stamR = await r.stamdata();
  const nu = periode.vandaagNL();
  const d0 = await r.aangiften();
  assert.equal(d0.length, 4);
  const snap = d0[0].snapshot;
  const nieuw = await r.aangifteIndienen({ jaar: 2030, kwartaal: 1, snapshot: snap, teBetalen: 12300, kenmerk: "K", opmerking: null });
  assert.ok((await r.stamdata()).vergrendeling.aangiften.some((x) => x.jaar === 2030 && x.kwartaal === 1));
  await assert.rejects(r.aangifteIndienen({ jaar: 2030, kwartaal: 1, snapshot: snap, teBetalen: 0, kenmerk: null, opmerking: null }), (e) => e.status === 409);
  const btwRegel = (await r.boekingen()).find((b) => b.soort === "btw");
  const k = await r.aangifteBetalingKoppelen({ boekingId: btwRegel.id, aangifteId: nieuw.id, bedrag: 12300 });
  assert.equal((await r.aangifteBetalingen()).filter((x) => x.aangifteId === nieuw.id).length, 1);
  const uitg = (await r.boekingen()).find((b) => b.soort === "uitgave");
  await assert.rejects(r.aangifteBetalingKoppelen({ boekingId: uitg.id, aangifteId: nieuw.id, bedrag: 1 }), (e) => e.code === "koppeling_ongeldig");
  await r.aangifteBetalingOntkoppelen(k.id);
  await r.aangifteIntrekken(nieuw.id);
  assert.ok(!(await r.stamdata()).vergrendeling.aangiften.some((x) => x.jaar === 2030));
  // Activa
  const w = afs.parseActivumInvoer({ omschrijving: "Bureau", categorie: "0200", aanschafdatum: nu, aanschaf: "800", jaren: 5 }, { vandaag: nu }).waarde;
  const a = await r.activumToevoegen(w);
  assert.equal((await r.activa()).length, 5);
  const gew = await r.activumWijzigen(a.id, { ...w, looptijdMaanden: 36 });
  assert.equal(gew.looptijdMaanden, 36);
  await r.activumVerwijderen(a.id);
  assert.equal((await r.activa()).length, 4);
  // Desinvestering in een vergrendeld kwartaal: geweigerd.
  const lap = (await r.activa()).find((x) => x.uitgaveId);
  const dicht = periode.kwartaalGrenzen(stamR.vergrendeling.aangiften.at(-1).jaar, stamR.vergrendeling.aangiften.at(-1).kwartaal).tot;
  const wl = afs.parseActivumInvoer(afs.activumAlsInvoer(lap), { vandaag: nu }).waarde;
  await assert.rejects(r.activumWijzigen(lap.id, { ...wl, desinvesteringDatum: dicht, desinvesteringOpbrengst: 0 }), (e) => e.status === 409);
  demo.demoHerstellen("test-ag");
  assert.equal((await r.activa()).length, 4);
});

// ---------------------------------------------------------------------------------- constanten
await test("standaardgrootboek: unieke codes, systeemrekeningen bestaan", () => {
  const codes = constanten.STANDAARD_GROOTBOEK.map((g) => g.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of Object.values(constanten.GB)) assert.ok(codes.includes(c), c);
  for (const v of stam.vennoten) assert.ok(codes.includes(v.grootboekKapitaal) && codes.includes(v.grootboekPrive));
  for (const r of stam.rekeningen) assert.ok(codes.includes(r.grootboek));
  assert.equal(constanten.DREMPEL_ACTIVEREN, 45000);
});

if (fouten.length) {
  for (const f of fouten) console.log(`  FOUT  ${f}`);
  console.log(`\n${geslaagd} geslaagd, ${fouten.length} mislukt`);
  process.exit(1);
}
console.log(`test-boekhouding: ${geslaagd} geslaagd`);
