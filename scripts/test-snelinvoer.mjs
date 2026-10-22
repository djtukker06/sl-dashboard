// Tests voor de snelinvoer (lib/agenda/snelinvoer.ts) en de Amsterdamse datumrekening
// (lib/agenda/datum.ts), inclusief de wintertijdwissel van 25 oktober 2026.
// Geen netwerk, geen database.
//
// Gebruik:  node scripts/test-snelinvoer.mjs
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// TS laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
let snel, datum;
try {
  snel = await import(pathToFileURL(path.join(ROOT, "lib", "agenda", "snelinvoer.ts")).href);
  datum = await import(pathToFileURL(path.join(ROOT, "lib", "agenda", "datum.ts")).href);
} catch (err) {
  if (process.env.SNEL_CHILD) throw err;
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url)],
    { stdio: "inherit", env: { ...process.env, SNEL_CHILD: "1" } },
  );
  process.exit(r.status ?? 1);
}

const VANDAAG = "2026-10-22"; // donderdag
let geslaagd = 0;
const fouten = [];

function test(naam, fn) {
  try {
    fn();
    geslaagd++;
  } catch (e) {
    fouten.push(`✗ ${naam}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
}

function p(tekst, opties) {
  return snel.parseSnelinvoer(tekst, VANDAAG, opties);
}

function verwacht(tekst, exp, opties) {
  test(tekst, () => {
    const r = p(tekst, opties);
    const sub = Object.fromEntries(Object.keys(exp).map((k) => [k, r[k]]));
    assert.deepEqual(sub, exp);
  });
}

// ---------- acceptatie ----------
verwacht("Offerte sturen @Jansen vrijdag 14:00 !", {
  soort: "taak", titel: "Offerte sturen", datum: "2026-10-23", tijd: "14:00", prioriteit: 1, klant: "Jansen",
});
verwacht("afspraak Kennismaking morgen 10:00-11:00", {
  soort: "afspraak", titel: "Kennismaking", datum: "2026-10-23", tijd: "10:00", eindTijd: "11:00", duur: 60,
});

// ---------- datums ----------
verwacht("Bellen met drukker", { soort: "taak", titel: "Bellen met drukker", datum: null, tijd: null });
verwacht("Mail beantwoorden vandaag", { titel: "Mail beantwoorden", datum: "2026-10-22" });
verwacht("Logo afronden overmorgen", { titel: "Logo afronden", datum: "2026-10-24" });
verwacht("Review donderdag", { titel: "Review", datum: "2026-10-29" }); // eerstvolgende, niet vandaag
verwacht("Moodboard op maandag", { titel: "Moodboard", datum: "2026-10-26" });
verwacht("Workshop volgende week dinsdag 9:30", { titel: "Workshop", datum: "2026-10-27", tijd: "09:30" });
verwacht("Planning volgende week", { titel: "Planning", datum: "2026-10-26" });
verwacht("Evaluatie volgende vrijdag", { titel: "Evaluatie", datum: "2026-10-30" });
verwacht("Presentatie 12 nov 15u", { titel: "Presentatie", datum: "2026-11-12", tijd: "15:00" });
verwacht("Oplevering 3 december 2026", { titel: "Oplevering", datum: "2026-12-03" });
verwacht("Deadline 22 okt", { titel: "Deadline", datum: "2026-10-22" });
verwacht("Btw-aangifte 31-1", { titel: "Btw-aangifte", datum: "2027-01-31" }); // al voorbij → volgend jaar
verwacht("Jaarafsluiting 22/10/2026", { titel: "Jaarafsluiting", datum: "2026-10-22" });
verwacht("Contract verlengen 5/1/27", { titel: "Contract verlengen", datum: "2027-01-05" });
verwacht("Website live over 2 weken", { titel: "Website live", datum: "2026-11-05" });
verwacht("Zo snel mogelijk factuur maken", { titel: "Zo snel mogelijk factuur maken", datum: null });
verwacht("Ma vragen om de foto's", { titel: "Ma vragen om de foto's", datum: null });
verwacht("Kick-off do 9u", { titel: "Kick-off", datum: "2026-10-29", tijd: "09:00" });
verwacht("Content plannen vr. ", { titel: "Content plannen", datum: "2026-10-23" });
verwacht("Datum 31-2 klopt niet", { datum: null });

// ---------- tijden en duur ----------
verwacht("Lunch om 12", { titel: "Lunch", datum: "2026-10-22", tijd: "12:00" }); // tijd zonder dag = vandaag
verwacht("Klant bellen om 2 uur", { titel: "Klant bellen", tijd: "02:00", duur: null });
verwacht("Strategiesessie vr 14.30 90m !laag", {
  titel: "Strategiesessie", datum: "2026-10-23", tijd: "14:30", duur: 90, prioriteit: 3,
});
verwacht("Fotoshoot zaterdag 10:00 2u", { soort: "taak", titel: "Fotoshoot", datum: "2026-10-24", tijd: "10:00", duur: 120 });
verwacht("1u30 schetsen", { titel: "Schetsen", duur: 90, tijd: null });
verwacht("Teksten nalopen 45 min", { titel: "Teksten nalopen", duur: 45 });
verwacht("Inlezen 1,5 uur", { titel: "Inlezen", duur: 90 });
verwacht("Call 14:00 - 15:30", { soort: "afspraak", titel: "Call", datum: "2026-10-22", tijd: "14:00", eindTijd: "15:30", duur: 90 });
verwacht("Borrel van 17 tot 19 uur vrijdag", { soort: "afspraak", titel: "Borrel", datum: "2026-10-23", tijd: "17:00", eindTijd: "19:00" });
verwacht("Afspraak tandarts 25 okt 10:00", { soort: "afspraak", titel: "Tandarts", datum: "2026-10-25", tijd: "10:00", eindTijd: null });
verwacht("afspraak Lunch met Eva morgen 12:00 1u", { soort: "afspraak", titel: "Lunch met Eva", tijd: "12:00", eindTijd: "13:00", duur: 60 });
verwacht("5 mails sturen", { titel: "5 mails sturen", duur: null });
verwacht("Versie 10-11 checken", { datum: "2026-11-10" });

// ---------- prioriteit, klant, soort ----------
verwacht("Factuur maken !!", { titel: "Factuur maken", prioriteit: 1 });
verwacht("Opruimen !laag", { titel: "Opruimen", prioriteit: 3 });
verwacht("Hallo! Wat leuk", { titel: "Hallo! Wat leuk", prioriteit: null });
verwacht('Taak: posts plannen @"De Vries Bouw" over 2 weken', {
  soort: "taak", titel: "Posts plannen", klant: "De Vries Bouw", datum: "2026-11-05",
});
verwacht("Mail naar info@example.nl sturen", { klant: null, titel: "Mail naar info@example.nl sturen" });
verwacht("Moodboard @Bakker-BV.", { klant: "Bakker-BV", titel: "Moodboard" });

// ---------- chips wegklikken (negeer) ----------
verwacht("Boek lezen morgen", { titel: "Boek lezen morgen", datum: null }, { negeer: ["datum"] });
verwacht("Offerte @Jansen !", { titel: "Offerte @Jansen", klant: null, prioriteit: 1 }, { negeer: ["klant"] });
verwacht("afspraak Kennismaking", { soort: "taak", titel: "Afspraak Kennismaking" }, { negeer: ["soort"] });

test("tokens en labels", () => {
  const r = p("Offerte sturen @Jansen vrijdag 14:00 !");
  assert.deepEqual(
    r.tokens.map((t) => [t.soort, t.label]),
    [["tijd", "14:00"], ["datum", "morgen"], ["prioriteit", "Hoge prioriteit"], ["klant", "Jansen"]],
  );
});
test("datumlabel ander jaar", () => assert.equal(snel.datumLabel("2027-01-31", VANDAAG), "zo 31 jan 2027"));

// ---------- Amsterdamse tijd en zomer-/wintertijd ----------
const iso = (d) => d.toISOString().replace(".000", "");
test("zomertijd: 24 okt 12:00 = 10:00 UTC", () => assert.equal(iso(datum.amsterdamNaarMoment("2026-10-24", "12:00")), "2026-10-24T10:00:00Z"));
test("wintertijd: 25 okt 12:00 = 11:00 UTC", () => assert.equal(iso(datum.amsterdamNaarMoment("2026-10-25", "12:00")), "2026-10-25T11:00:00Z"));
test("dubbel uur 25 okt 02:30 → eerste keer", () => assert.equal(iso(datum.amsterdamNaarMoment("2026-10-25", "02:30")), "2026-10-25T00:30:00Z"));
test("ontbrekend uur 29 mrt 02:30 → 03:30 zomertijd", () => {
  const m = datum.amsterdamNaarMoment("2026-03-29", "02:30");
  assert.equal(iso(m), "2026-03-29T01:30:00Z");
  assert.equal(datum.inAmsterdam(m).tijd, "03:30");
});
test("25 okt duurt 25 uur", () => {
  const b = datum.bereikMomenten("2026-10-25", "2026-10-25");
  assert.equal(b.start, "2026-10-24T22:00:00.000Z");
  assert.equal(b.eind, "2026-10-25T23:00:00.000Z");
});
test("inAmsterdam rond de wissel", () => {
  assert.deepEqual(datum.inAmsterdam("2026-10-25T00:30:00Z"), { dag: "2026-10-25", minuten: 150, tijd: "02:30" });
  assert.deepEqual(datum.inAmsterdam("2026-10-25T01:30:00Z"), { dag: "2026-10-25", minuten: 150, tijd: "02:30" });
  assert.deepEqual(datum.inAmsterdam("2026-10-24T22:30:00Z"), { dag: "2026-10-25", minuten: 30, tijd: "00:30" });
});
test("vandaag na 23:00 UTC in de zomer = volgende dag", () => assert.equal(datum.vandaag(new Date("2026-07-01T22:30:00Z")), "2026-07-02"));
test("weekrekenen", () => {
  assert.equal(datum.maandagVan("2026-10-25"), "2026-10-19");
  assert.equal(datum.weeknummer("2026-10-22"), 43);
  assert.equal(datum.plusMaanden("2026-12-15", 1), "2027-01-01");
  assert.equal(datum.dagenTussen("2026-10-22", "2026-11-01"), 10);
  assert.equal(datum.isDag("2026-02-29"), false);
  assert.equal(datum.normTijd("09:05:00"), "09:05");
});

for (const f of fouten) console.error(f);
console.log(`${geslaagd} geslaagd, ${fouten.length} mislukt`);
process.exit(fouten.length ? 1 : 0);
