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
let geld, btw, periode, model, journaal, constanten, seed, demo;
try {
  [geld, btw, periode, model, journaal, constanten, seed, demo] = await Promise.all([
    laad("kern/geld.ts"),
    laad("kern/btw.ts"),
    laad("kern/periode.ts"),
    laad("model.ts"),
    laad("kern/journaal.ts"),
    laad("kern/constanten.ts"),
    laad("repo/demo-seed.ts"),
    laad("repo/demo.ts"),
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
await test("demo-seed: journaal sluit, saldi = grootboek, kruisposten 0, saldo nooit negatief", () => {
  const posten = journaal.journaal(data.stamdata, data.boekingen);
  const pb = journaal.proefbalans(posten);
  assert.equal([...pb.values()].reduce((a, b) => a + b, 0), 0);
  const saldi = model.saldoPerRekening(data.boekingen, data.stamdata.rekeningen);
  assert.equal(pb.get("1100"), saldi.get(RB));
  assert.equal(pb.get("1110"), saldi.get(RV));
  assert.equal(pb.get("2000") ?? 0, 0);
  const lopend = model.lopendSaldo(data.boekingen, data.stamdata.rekeningen);
  assert.ok(Math.min(...lopend.values()) >= 0, `laagste saldo ${Math.min(...lopend.values())}`);
});
await test("demo-seed: ingediende kwartalen vergrendeld en betaald (btw-saldo = betaling)", () => {
  const a = data.aangiften.map((x) => `Q${x.kwartaal} ${x.jaar}`);
  assert.deepEqual(a, ["Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026"]);
  assert.equal(periode.isVergrendeld("2026-06-30", data.stamdata.vergrendeling), true);
  assert.equal(periode.isVergrendeld("2026-07-01", data.stamdata.vergrendeling), false);
  for (const ag of data.aangiften) {
    const { van, tot } = periode.kwartaalGrenzen(ag.jaar, ag.kwartaal);
    const t = model.totalen(data.boekingen.filter((x) => x.datum >= van && x.datum <= tot));
    assert.equal(ag.teBetalen, t.verschuldigd - t.voorbelasting);
    const betaling = data.boekingen.find((x) => x.soort === "btw" && x.omschrijving === `Belastingdienst btw Q${ag.kwartaal} ${ag.jaar}`);
    assert.ok(betaling && betaling.bedrag === Math.abs(ag.teBetalen) && betaling.richting === (ag.teBetalen > 0 ? "af" : "bij"));
    assert.ok(betaling.datum <= periode.aangifteDeadline(ag.jaar, ag.kwartaal));
  }
});
await test("demo-opslag: importeert geen Supabase en schrijft niets naar het netwerk", () => {
  for (const f of ["repo/demo.ts", "repo/demo-seed.ts", "model.ts", "kern/geld.ts", "kern/btw.ts", "kern/periode.ts", "kern/journaal.ts", "kern/constanten.ts"]) {
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
