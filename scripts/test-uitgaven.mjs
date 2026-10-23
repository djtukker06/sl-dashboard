// Tests voor de uitgaven-logica zonder database en (standaard) zonder netwerk:
//   - lib/uitgaven/model.ts: bedragen, datums, periodes, normaliseren van wat Claude
//     teruggeeft, filteren, totalen, CSV en bestandsnamen voor de boekhouder;
//   - lib/uitgaven/claude.ts: het verzoek aan Claude (model, JSON-schema, afbeelding als
//     base64), het uitlezen van het antwoord en de terugval zonder schema na een 400 —
//     met een nagebootste fetch, dus zonder echte API-aanroep;
//   - verplichte velden (leverancier, datum, bedrag): rechtsvorm-ruis, ontbrekend en onzeker,
//     de "onzeker:"-markeringen in ai_fields en de melding "Kon … niet lezen";
//   - een gegenereerde testafbeelding van een bonnetje (PNG via sharp) loopt door die keten.
//
// Gebruik:  node scripts/test-uitgaven.mjs
//           node scripts/test-uitgaven.mjs --claude   één échte aanroep met de testafbeelding
//                                                     (alleen als ANTHROPIC_API_KEY in de omgeving staat;
//                                                     de key wordt nooit getoond)
import path from "node:path";
import assert from "node:assert/strict";
import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ECHT = process.argv.includes("--claude");

// TS laden vereist type-stripping (Node >= 22.6). Zo nodig opnieuw starten met de vlag.
// Relatieve imports zonder extensie ('./model') krijgen via een resolve-hook '.ts' erachter.
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

let model, claude;
try {
  model = await import(pathToFileURL(path.join(ROOT, "lib", "uitgaven", "model.ts")).href);
  claude = await import(pathToFileURL(path.join(ROOT, "lib", "uitgaven", "claude.ts")).href);
} catch (err) {
  if (process.env.UG_CHILD) throw err;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, UG_CHILD: "1" },
  });
  process.exit(r.status ?? 1);
}

const VANDAAG = "2026-10-22";
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

// ---------------------------------------------------------------- bedragen & datums
await test("leesBedrag", () => {
  const g = model.leesBedrag;
  assert.equal(g("12,50"), 12.5);
  assert.equal(g("€ 1.234,56"), 1234.56);
  assert.equal(g("1,234.56"), 1234.56);
  assert.equal(g("1.234"), 1234);
  assert.equal(g("12.5"), 12.5);
  assert.equal(g("-3,10"), -3.1);
  assert.equal(g("(5,00)"), -5);
  assert.equal(g(" EUR 7 "), 7);
  assert.equal(g(19.999), 20);
  assert.equal(g(""), null);
  assert.equal(g("abc"), null);
  assert.equal(g(null), null);
  assert.equal(g(Number.NaN), null);
});
await test("bedragNL", () => {
  assert.equal(model.bedragNL(1234.5), "1.234,50");
  assert.equal(model.bedragNL(-0.5), "-0,50");
  assert.equal(model.bedragNL(1000000), "1.000.000,00");
  assert.equal(model.bedragNL(null), "");
});
await test("leesDatum", () => {
  assert.equal(model.leesDatum("2026-10-22"), "2026-10-22");
  assert.equal(model.leesDatum("22-10-2026"), "2026-10-22");
  assert.equal(model.leesDatum("2/3/26"), "2026-03-02");
  assert.equal(model.leesDatum("31.12.2025"), "2025-12-31");
  assert.equal(model.leesDatum("2026-02-30"), null);
  assert.equal(model.leesDatum("31-02-2026"), null);
  assert.equal(model.leesDatum("gisteren"), null);
});
await test("btwUitTotaal", () => {
  assert.equal(model.btwUitTotaal(121, "21"), 21);
  assert.equal(model.btwUitTotaal(10.9, "9"), 0.9);
  assert.equal(model.btwUitTotaal(50, "verlegd"), 0);
  assert.equal(model.btwUitTotaal(50, null), null);
});

// ---------------------------------------------------------------- periodes
await test("periodes", () => {
  const m = model.periodeRond("maand", VANDAAG);
  assert.deepEqual(m, { soort: "maand", van: "2026-10-01", tot: "2026-10-31" });
  assert.deepEqual(model.periodeRond("kwartaal", VANDAAG), { soort: "kwartaal", van: "2026-10-01", tot: "2026-12-31" });
  assert.deepEqual(model.periodeRond("jaar", VANDAAG), { soort: "jaar", van: "2026-01-01", tot: "2026-12-31" });
  assert.deepEqual(model.periodeRond("maand", "2028-02-10").tot, "2028-02-29"); // schrikkeljaar
  assert.deepEqual(model.schuifPeriode(m, 1), { soort: "maand", van: "2026-11-01", tot: "2026-11-30" });
  assert.deepEqual(model.schuifPeriode(model.periodeRond("maand", "2026-01-05"), -1).van, "2025-12-01");
  assert.deepEqual(model.schuifPeriode(model.periodeRond("kwartaal", VANDAAG), 1), { soort: "kwartaal", van: "2027-01-01", tot: "2027-03-31" });
  assert.equal(model.periodeLabel(m), "oktober 2026");
  assert.equal(model.periodeLabel(model.periodeRond("kwartaal", VANDAAG)), "Q4 2026");
  assert.equal(model.kwartaalVan("2026-04-01"), 2);
});

// ---------------------------------------------------------------- bestanden
await test("snuffelType", () => {
  const b = (...x) => new Uint8Array(x);
  assert.equal(model.snuffelType(b(0x25, 0x50, 0x44, 0x46, 0x2d)), "application/pdf");
  assert.equal(model.snuffelType(b(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(model.snuffelType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
  const tekst = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  assert.equal(model.snuffelType(tekst("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(model.snuffelType(tekst("\0\0\0\x18ftypheic\0\0")), "image/heic");
  assert.equal(model.snuffelType(tekst("<html><body>")), null);
  assert.equal(model.typeUitNaam("Factuur 123.PDF"), "application/pdf");
  assert.equal(model.typeUitNaam("foto.heic"), "image/heic");
  assert.equal(model.typeUitNaam("script.svg"), null);
});
await test("exportBestandsnaam", () => {
  const u = { datum: "2026-10-22", leverancier: "Albert Heijn B.V.", totaal: 12.5 };
  assert.equal(model.exportBestandsnaam(u, "image/jpeg"), "2026-10-22_albert-heijn-b-v_12,50.jpg");
  assert.equal(model.exportBestandsnaam({ ...u, totaal: 1234.5 }, "application/pdf", 2), "2026-10-22_albert-heijn-b-v_1234,50-2.pdf");
  assert.equal(model.exportBestandsnaam({ datum: null, leverancier: "", totaal: null }, "image/png"), "0000-00-00_onbekend_onbekend.png");
  assert.equal(model.slug("Café Één & Co"), "cafe-een-co");
});

// ---------------------------------------------------------------- normaliseren (Claude-uitvoer)
await test("normaliseerUitgelezen: bonnetje", () => {
  const r = model.normaliseerUitgelezen(
    { leverancier: " Albert Heijn ", datum: "22-10-2026", totaal: "12,50", btwBedrag: null, btwTarief: "9%", valuta: "eur", factuurnummer: "", omschrijving: "Lunch", categorie: "representatie", betaalmethode: "PIN" },
    VANDAAG,
  );
  assert.equal(r.leverancier, "Albert Heijn");
  assert.equal(r.datum, "2026-10-22");
  assert.equal(r.totaal, 12.5);
  assert.equal(r.btwTarief, "9");
  assert.equal(r.btwBedrag, 1.03); // berekend uit 9%
  assert.equal(r.valuta, "EUR");
  assert.equal(r.factuurnummer, null);
  assert.equal(r.categorie, "representatie");
  assert.equal(r.betaaldVia, "zakelijk");
});
await test("normaliseerUitgelezen: grenzen", () => {
  const n = (x) => model.normaliseerUitgelezen(x, VANDAAG);
  assert.equal(n({ datum: "2031-01-01" }).datum, null); // toekomst
  assert.equal(n({ datum: "1999-12-31" }).datum, null);
  assert.equal(n({ datum: "2026-10-25" }).datum, "2026-10-25"); // binnen 7 dagen mag
  assert.equal(n({ totaal: 10, btwBedrag: 50 }).btwBedrag, null); // btw > totaal
  assert.equal(n({ totaal: 100, btwTarief: "reverse charge" }).btwTarief, "verlegd");
  assert.equal(n({ totaal: 100, btwTarief: "reverse charge" }).btwBedrag, 0);
  assert.equal(n({ totaal: 121, btwBedrag: 21 }).btwTarief, "21"); // afgeleid
  assert.equal(n({ categorie: "eten" }).categorie, null);
  assert.equal(n({ leverancier: "onbekend" }).leverancier, null);
  assert.equal(n({ valuta: "dollars" }).valuta, null);
  assert.equal(n({ betaalmethode: "Visa ****1234" }).betaaldVia, "creditcard");
  assert.equal(n({ betaalmethode: null }).betaaldVia, null);
  assert.equal(n({ leverancier: "x".repeat(500) }).leverancier.length, 200);
});
await test("jsonUitTekst", () => {
  assert.deepEqual(model.jsonUitTekst('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(model.jsonUitTekst('Hier: {"a":{"b":2}} klaar'), { a: { b: 2 } });
  assert.equal(model.jsonUitTekst("geen json"), null);
  assert.equal(model.jsonUitTekst("[1,2]"), null);
});
await test("vindLeverancier", () => {
  const bekend = [
    { naam: "Adobe", categorie: "software", betaaldVia: "creditcard", aantal: 5 },
    { naam: "NS", categorie: "reiskosten", betaaldVia: "zakelijk", aantal: 3 },
    { naam: "Coolblue", categorie: "hardware", betaaldVia: null, aantal: 1 },
  ];
  assert.equal(model.vindLeverancier("adobe", bekend)?.naam, "Adobe");
  assert.equal(model.vindLeverancier("Coolblue B.V.", bekend)?.naam, "Coolblue");
  assert.equal(model.vindLeverancier("NSA", bekend), null);
  assert.equal(model.vindLeverancier("", bekend), null);
});

// ---------------------------------------------------------------- samenvoegen
const basisUitgave = {
  id: "00000000-0000-0000-0000-000000000001",
  datum: null, leverancier: "", omschrijving: "", categorie: null, totaal: null, btwBedrag: null, btwTarief: null,
  valuta: "EUR", factuurnummer: "", betaaldVia: null, klantId: null, klantNaam: null, projectNotitie: "", notitie: "",
  status: "concept", aiVelden: [], aiOnzeker: [], aiStatus: "geen", aiMelding: "", bron: "upload", bronInfo: "", bestanden: [],
  aangemaakt: "2026-10-22T10:00:00Z", gewijzigd: "2026-10-22T10:00:00Z",
};
await test("samenvoegen: alleen lege velden, bekende leverancier wint", () => {
  const r = model.normaliseerUitgelezen(
    { leverancier: "adobe", datum: "2026-10-01", totaal: 72.6, btwBedrag: 12.6, btwTarief: "21", valuta: "EUR", omschrijving: "Creative Cloud", categorie: "overig", betaalmethode: null },
    VANDAAG,
  );
  const bekend = [{ naam: "Adobe", categorie: "software", betaaldVia: "creditcard", aantal: 4 }];
  const s = claude.samenvoegen({ ...basisUitgave, omschrijving: "Zelf ingevuld" }, r, bekend);
  assert.equal(s.kolommen.supplier, "Adobe"); // schrijfwijze van eerder
  assert.equal(s.kolommen.category, "software"); // laatst gebruikte categorie gaat voor
  assert.equal(s.kolommen.payment_method, "creditcard");
  assert.equal(s.kolommen.description, undefined); // al ingevuld: niet overschreven
  assert.equal(s.kolommen.currency, undefined); // EUR is de standaard: niets te doen
  assert.equal(s.kolommen.total_amount, 72.6);
  assert.ok(s.velden.includes("totaal") && !s.velden.includes("omschrijving"));
});

// ---------------------------------------------------------------- verplicht: ontbrekend en onzeker
await test("schoneBedrijfsnaam: rechtsvorm-ruis weg", () => {
  const n = model.schoneBedrijfsnaam;
  assert.equal(n("Albert Heijn B.V."), "Albert Heijn");
  assert.equal(n("Albert Heijn BV"), "Albert Heijn");
  assert.equal(n("Coolblue N.V."), "Coolblue");
  assert.equal(n("Adobe Systems Software Ireland Ltd."), "Adobe Systems Software Ireland");
  assert.equal(n("Figma, Inc."), "Figma");
  assert.equal(n("Hornbach Baumarkt AG"), "Hornbach Baumarkt");
  assert.equal(n("Bakkerij De Zon V.O.F."), "Bakkerij De Zon");
  assert.equal(n("Google Cloud EMEA Limited"), "Google Cloud EMEA");
  assert.equal(n("Coolblue"), "Coolblue"); // 'co' alleen als los woord
  assert.equal(n("Bol.com"), "Bol.com");
  assert.equal(n("BV"), "BV"); // alleen een rechtsvorm: laten staan
  assert.equal(model.normaliseerUitgelezen({ leverancier: "Albert Heijn B.V." }, VANDAAG).leverancier, "Albert Heijn");
});
await test("normaliseerUitgelezen: zekerheid per verplicht veld", () => {
  const n = (x) => model.normaliseerUitgelezen(x, VANDAAG);
  const zeker = { leverancier: "zeker", datum: "zeker", totaal: "zeker" };
  assert.deepEqual(n({ leverancier: "NS", datum: "2026-10-01", totaal: 5, zekerheid: zeker }).onzeker, []);
  assert.deepEqual(n({ leverancier: "NS", datum: "2026-10-01", totaal: 5, zekerheid: { ...zeker, datum: "onzeker" } }).onzeker, ["datum"]);
  // onzeker over een veld dat null is: dat is gewoon ontbrekend, niet "onzeker"
  assert.deepEqual(n({ leverancier: "NS", datum: null, totaal: 5, zekerheid: { ...zeker, datum: "onzeker" } }).onzeker, []);
  // ongeldige datum (toekomst) wordt null en telt dus ook niet als onzeker
  assert.deepEqual(n({ datum: "2031-01-01", zekerheid: { datum: "onzeker" } }).onzeker, []);
  // zonder zekerheid-object (oud antwoord / terugval): niets extra markeren
  assert.deepEqual(n({ leverancier: "NS", datum: "2026-10-01", totaal: 5 }).onzeker, []);
  // een onbekende waarde telt als onzeker
  assert.deepEqual(n({ leverancier: "NS", zekerheid: { leverancier: "misschien" } }).onzeker, ["leverancier"]);
  // een bedrag in een andere valuta altijd laten controleren
  assert.deepEqual(n({ totaal: 20, valuta: "USD", zekerheid: zeker }).onzeker, ["totaal"]);
  assert.deepEqual(n({ totaal: 20, valuta: "EUR", zekerheid: zeker }).onzeker, []);
});
await test("ontbrekendeVelden, aandachtVoor en ontbreektMelding", () => {
  const leeg = { leverancier: "", datum: null, totaal: null, aiOnzeker: [] };
  assert.deepEqual(model.ontbrekendeVelden(leeg), ["leverancier", "datum", "totaal"]);
  assert.deepEqual(model.ontbrekendeVelden({ leverancier: "  ", datum: "2026-10-01", totaal: 0 }), ["leverancier"]); // 0 is een bedrag
  assert.equal(model.aandachtVoor(leeg), "aanvullen");
  assert.equal(model.aandachtVoor({ leverancier: "NS", datum: "2026-10-01", totaal: 5, aiOnzeker: ["datum"] }), "controleren");
  assert.equal(model.aandachtVoor({ leverancier: "NS", datum: null, totaal: 5, aiOnzeker: ["leverancier"] }), "aanvullen"); // ontbreken gaat voor
  assert.equal(model.aandachtVoor({ leverancier: "NS", datum: "2026-10-01", totaal: 5, aiOnzeker: [] }), null);
  assert.equal(model.ontbreektMelding(["datum"]), "Kon de datum niet lezen — vul hem zelf in.");
  assert.equal(model.ontbreektMelding(["leverancier", "totaal"]), "Kon de leverancier en het bedrag niet lezen — vul ze zelf in.");
  assert.equal(model.ontbreektMelding(["leverancier", "datum", "totaal"]), "Kon de leverancier, de datum en het bedrag niet lezen — vul ze zelf in.");
  assert.equal(model.ontbreektMelding(["totaal"], false), "Vul het bedrag nog in.");
  assert.equal(model.ontbreektMelding([]), "");
});
await test("ai_fields: onzeker-markeringen heen en terug", () => {
  const kolom = model.schrijfAiVelden(["leverancier", "datum", "omschrijving", "rommel"], ["datum", "totaal", "omschrijving"]);
  // totaal is niet automatisch ingevuld en omschrijving is geen verplicht veld: niet als onzeker
  assert.deepEqual(kolom, ["leverancier", "datum", "omschrijving", "onzeker:datum"]);
  assert.deepEqual(model.leesAiVelden(kolom), { velden: ["leverancier", "datum", "omschrijving"], onzeker: ["datum"] });
  assert.deepEqual(model.leesAiVelden(["onzeker:datum"]), { velden: [], onzeker: [] }); // zonder het veld zelf
  assert.deepEqual(model.leesAiVelden(null), { velden: [], onzeker: [] });
});
await test("samenvoegen: onzeker alleen voor wat nu wordt ingevuld", () => {
  const r = model.normaliseerUitgelezen(
    { leverancier: "Bakkerij De Zon", datum: "2026-10-14", totaal: null, zekerheid: { leverancier: "onzeker", datum: "onzeker", totaal: "onzeker" } },
    VANDAAG,
  );
  assert.deepEqual(r.onzeker, ["leverancier", "datum"]);
  // datum was al ingevuld door de gebruiker: niet overschreven en dus niet onzeker
  const s = claude.samenvoegen({ ...basisUitgave, datum: "2026-10-13" }, r, []);
  assert.deepEqual(s.onzeker, ["leverancier"]);
  assert.equal(s.kolommen.expense_date, undefined);
  // bekende leverancier: de eerdere schrijfwijze geldt als zeker
  const s2 = claude.samenvoegen(basisUitgave, r, [{ naam: "Bakkerij De Zon", categorie: null, betaaldVia: null, aantal: 1 }]);
  assert.deepEqual(s2.onzeker, ["datum"]);
});
await test("schema en prompt: zekerheid, ISO-datum, EUR, null bij twijfel", () => {
  const z = claude.SCHEMA.properties.zekerheid;
  assert.equal(z.type, "object");
  assert.equal(z.additionalProperties, false);
  assert.deepEqual([...z.required], ["leverancier", "datum", "totaal"]);
  assert.ok(claude.SCHEMA.required.includes("zekerheid"));
  const p = claude.systeemPrompt(VANDAAG, []);
  assert.ok(p.includes("YYYY-MM-DD"));
  assert.ok(/euro \(EUR\)/.test(p));
  assert.ok(/gok niet/.test(p) && /null/.test(p));
  assert.ok(/zonder rechtsvorm/.test(p));
});

// ---------------------------------------------------------------- filteren, totalen, CSV
const lijst = [
  { ...basisUitgave, id: "a", datum: "2026-10-02", leverancier: "Adobe", omschrijving: "CC", categorie: "software", totaal: 72.6, btwBedrag: 12.6, btwTarief: "21", betaaldVia: "creditcard", status: "verwerkt" },
  { ...basisUitgave, id: "b", datum: "2026-10-05", leverancier: "NS", omschrijving: "Trein; Utrecht", categorie: "reiskosten", totaal: 10.9, btwBedrag: 0.9, btwTarief: "9", betaaldVia: "zakelijk" },
  { ...basisUitgave, id: "c", datum: "2026-10-07", leverancier: "Figma", omschrijving: "=HYPERLINK(\"x\")", categorie: "software", totaal: 15, btwBedrag: 0, btwTarief: "verlegd", valuta: "USD" },
];
await test("filterUitgaven", () => {
  assert.deepEqual(model.filterUitgaven(lijst, { categorie: "software" }).map((u) => u.id), ["a", "c"]);
  assert.deepEqual(model.filterUitgaven(lijst, { zoek: "trein utr" }).map((u) => u.id), ["b"]);
  assert.deepEqual(model.filterUitgaven(lijst, { zoek: "72,60" }).map((u) => u.id), ["a"]);
  assert.deepEqual(model.filterUitgaven(lijst, { leverancier: "ns" }).map((u) => u.id), ["b"]);
  assert.deepEqual(model.filterUitgaven(lijst, { status: "concept", betaaldVia: "zakelijk" }).map((u) => u.id), ["b"]);
  assert.deepEqual(model.filterUitgaven(lijst, { categorie: "geen" }), []);
});
await test("totalen (alleen EUR)", () => {
  const t = model.totalen(lijst);
  assert.deepEqual(t, { aantal: 3, incl: 83.5, btw: 13.5, excl: 70, andereValuta: 1, zonderBedrag: 0 });
  const c = model.perCategorie(lijst);
  assert.deepEqual(c.map((x) => [x.categorie, x.excl]), [["software", 60], ["reiskosten", 10]]);
});
await test("maakCsv", () => {
  const csv = model.maakCsv(lijst, new Map([["a", ["2026-10-02_adobe_72,60.pdf"]]]));
  assert.ok(csv.startsWith("﻿Datum;Leverancier;"));
  const regels = csv.trim().split("\r\n");
  assert.equal(regels.length, 4);
  assert.equal(regels[1], "02-10-2026;Adobe;CC;Software & abonnementen;72,60;12,60;60,00;21%;EUR;;Creditcard;;;;Verwerkt;2026-10-02_adobe_72,60.pdf");
  assert.ok(regels[2].includes('"Trein; Utrecht"'), "puntkomma in veld wordt gequote");
  assert.ok(regels[3].includes("'=HYPERLINK"), "formule onschadelijk gemaakt");
});

// ---------------------------------------------------------------- Claude-verzoek (nagebootst)
const sharp = (await import("sharp")).default;
function bonnetjeSvg() {
  const regels = [
    ["Croissant", "3,25"],
    ["Cappuccino 2x", "7,00"],
    ["Broodje kaas", "6,50"],
  ];
  const y0 = 230;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">
  <rect width="600" height="900" fill="#fbfaf7"/>
  <g font-family="Courier New, monospace" fill="#222">
    <text x="300" y="80" font-size="34" text-anchor="middle" font-weight="bold">BAKKERIJ DE ZON</text>
    <text x="300" y="120" font-size="20" text-anchor="middle">Oudegracht 12, 3511 AP Utrecht</text>
    <text x="300" y="150" font-size="20" text-anchor="middle">KvK 12345678  BTW NL001234567B01</text>
    <text x="60" y="195" font-size="20">Datum: 14-10-2026  12:41   Bon 4711</text>
    ${regels.map(([n, b], i) => `<text x="60" y="${y0 + i * 40}" font-size="24">${n}</text><text x="540" y="${y0 + i * 40}" font-size="24" text-anchor="end">${b}</text>`).join("")}
    <line x1="60" y1="${y0 + 120}" x2="540" y2="${y0 + 120}" stroke="#222" stroke-dasharray="6 6"/>
    <text x="60" y="${y0 + 170}" font-size="30" font-weight="bold">TOTAAL</text>
    <text x="540" y="${y0 + 170}" font-size="30" font-weight="bold" text-anchor="end">EUR 16,75</text>
    <text x="60" y="${y0 + 220}" font-size="22">BTW 9% over 15,37</text>
    <text x="540" y="${y0 + 220}" font-size="22" text-anchor="end">1,38</text>
    <text x="60" y="${y0 + 270}" font-size="22">Betaald met PIN (Maestro)</text>
    <text x="300" y="${y0 + 360}" font-size="22" text-anchor="middle">Bedankt en tot ziens!</text>
  </g>
</svg>`;
}
const png = await sharp(Buffer.from(bonnetjeSvg())).png().toBuffer();
const beeldBlok = { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } };

await test("testafbeelding", () => {
  assert.equal(model.snuffelType(png.subarray(0, 16)), "image/png");
  assert.ok(png.length > 5000 && png.length < 5 * 1024 * 1024);
});

const echteFetch = globalThis.fetch;
function nepAntwoord(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
}
const antwoordTekst = JSON.stringify({
  leverancier: "Bakkerij De Zon", datum: "2026-10-14", totaal: 16.75, btwBedrag: 1.38, btwTarief: "9", valuta: "EUR",
  factuurnummer: "4711", omschrijving: "Lunch: croissant, koffie en broodje", categorie: "representatie", betaalmethode: "zakelijk",
  zekerheid: { leverancier: "zeker", datum: "zeker", totaal: "zeker" },
});
const berichtVan = (tekst) => ({
  id: "msg_test", type: "message", role: "assistant", model: claude.MODEL, stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text: tekst }], usage: { input_tokens: 1, output_tokens: 1 },
});

if (!ECHT) {
  const verzoeken = [];
  const bewaardeKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test-alleen-voor-nagebootste-fetch";
  // De SDK onthoudt fetch bij het aanmaken van de client: één vaste nep-fetch die doorgeeft
  // aan de handler van de huidige test.
  let handler = null;
  globalThis.fetch = (url, init) => handler(url, init);
  try {
    await test("vraagClaude: verzoek met schema en afbeelding", async () => {
      handler = async (url, init) => {
        verzoeken.push({ url: String(url), body: JSON.parse(init.body) });
        return nepAntwoord(200, berichtVan(antwoordTekst));
      };
      const ruw = await claude.vraagClaude([beeldBlok], claude.systeemPrompt(VANDAAG, [{ naam: "Bakkerij De Zon", categorie: "representatie", betaaldVia: null, aantal: 2 }]));
      const v = verzoeken[0].body;
      assert.ok(verzoeken[0].url.endsWith("/v1/messages"));
      assert.equal(v.model, "claude-sonnet-5-5");
      assert.equal(v.output_config.format.type, "json_schema");
      assert.deepEqual(Object.keys(v.output_config.format.schema.properties).sort(), [...v.output_config.format.schema.required].sort());
      assert.equal(v.output_config.format.schema.additionalProperties, false);
      assert.equal(v.messages[0].content[0].type, "image");
      assert.equal(v.messages[0].content[0].source.media_type, "image/png");
      assert.ok(v.system.includes("Bakkerij De Zon"), "bekende leveranciers in de prompt");
      assert.ok(v.system.includes("software: Software & abonnementen"));
      const r = model.normaliseerUitgelezen(ruw, VANDAAG);
      assert.deepEqual(
        [r.leverancier, r.datum, r.totaal, r.btwBedrag, r.btwTarief, r.categorie, r.betaaldVia, r.factuurnummer],
        ["Bakkerij De Zon", "2026-10-14", 16.75, 1.38, "9", "representatie", "zakelijk", "4711"],
      );
      assert.deepEqual(r.onzeker, []);
      assert.deepEqual(v.output_config.format.schema.properties.zekerheid.required, ["leverancier", "datum", "totaal"]);
    });
    await test("vraagClaude: terugval zonder schema na een 400", async () => {
      verzoeken.length = 0;
      handler = async (url, init) => {
        const body = JSON.parse(init.body);
        verzoeken.push(body);
        if (body.output_config) return nepAntwoord(400, { type: "error", error: { type: "invalid_request_error", message: "schema" } });
        return nepAntwoord(200, berichtVan("Natuurlijk:\n```json\n" + antwoordTekst + "\n```"));
      };
      const ruw = await claude.vraagClaude([beeldBlok], "systeem");
      assert.equal(verzoeken.length, 2);
      assert.equal(verzoeken[1].output_config, undefined);
      assert.ok(verzoeken[1].system.includes("uitsluitend met één JSON-object"));
      assert.equal(ruw.totaal, 16.75);
    });
    await test("vraagClaude: weigering en kapotte JSON geven een fout", async () => {
      handler = async () => nepAntwoord(200, { ...berichtVan(""), stop_reason: "refusal" });
      await assert.rejects(() => claude.vraagClaude([beeldBlok], "s"));
      handler = async () => nepAntwoord(200, berichtVan("geen json hier"));
      await assert.rejects(() => claude.vraagClaude([beeldBlok], "s"), /geen geldige JSON/);
    });
  } finally {
    globalThis.fetch = echteFetch;
    if (bewaardeKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = bewaardeKey;
  }
} else if (!claude.heeftApiKey()) {
  console.log("--claude overgeslagen: ANTHROPIC_API_KEY staat niet in de omgeving.");
} else {
  await test("échte Claude-aanroep met de testafbeelding", async () => {
    const t0 = Date.now();
    const ruw = await claude.vraagClaude([beeldBlok], claude.systeemPrompt(VANDAAG, []));
    const r = model.normaliseerUitgelezen(ruw, VANDAAG);
    console.log(`  Claude (${claude.MODEL}, ${((Date.now() - t0) / 1000).toFixed(1)} s):`, r);
    assert.equal(r.totaal, 16.75);
    assert.equal(r.datum, "2026-10-14");
    assert.equal(r.btwTarief, "9");
    assert.ok(r.leverancier && /zon/i.test(r.leverancier));
    assert.ok(ruw.zekerheid && typeof ruw.zekerheid === "object", "zekerheid per veld teruggegeven");
    assert.deepEqual(r.onzeker, [], "een scherp testbonnetje is zeker leesbaar");
  });
  await test("échte Claude-aanroep: onleesbaar bonnetje geeft null (geen gok)", async () => {
    // Datum en totaal zijn weggevaagd/afgesneden: verwacht null of 'onzeker', nooit een stellige gok.
    const svg = bonnetjeSvg()
      .replace(/Datum: 14-10-2026/, "Datum: ▒▒-▒▒-▒▒▒▒")
      .replace(/EUR 16,75/, "EUR ▒▒,▒▒");
    const vaag = await sharp(Buffer.from(svg)).png().toBuffer();
    const ruw = await claude.vraagClaude(
      [{ type: "image", source: { type: "base64", media_type: "image/png", data: vaag.toString("base64") } }],
      claude.systeemPrompt(VANDAAG, []),
    );
    const r = model.normaliseerUitgelezen(ruw, VANDAAG);
    console.log("  Onleesbaar bonnetje:", { leverancier: r.leverancier, datum: r.datum, totaal: r.totaal, onzeker: r.onzeker }, "ontbreekt:", model.ontbrekendeVelden(r));
    assert.ok(r.datum === null || r.onzeker.includes("datum"), "datum niet stellig gegokt");
    assert.ok(r.totaal === null || r.onzeker.includes("totaal") || r.totaal === 16.75, "totaal niet stellig gegokt");
  });
}

console.log(`${geslaagd} geslaagd, ${fouten.length} mislukt`);
for (const f of fouten) console.log(`  FOUT  ${f}`);
process.exit(fouten.length ? 1 : 0);
