// Tests voor lib/agenda/ics.ts (agenda-abonnement): node --experimental-strip-types scripts/test-agenda-feed.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
// Relatieve imports zonder extensie (./datum) naar .ts laten wijzen.
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec.startsWith('./') && !/\\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.endsWith('.ts')) return next(spec + '.ts', ctx);
  return next(spec, ctx);
}`),
  import.meta.url
);
const { maakIcs, vouw, icsTekst, clientVan } = await import("../lib/agenda/ics.ts");

let n = 0;
const test = (naam, fn) => { fn(); n++; console.log(`  ✓ ${naam}`); };

const ics = maakIcs({
  naam: "Bram",
  link: "https://backoffice.studio-levant.nl/agenda",
  nu: new Date("2026-10-28T10:00:00Z"),
  taken: [
    { id: "t1", titel: "Offerte Finkers", notitie: "Bel eerst, dan mail", datum: "2026-11-02", tijd: "14:30", duur: 60, prioriteit: 1, afgerond: false },
    { id: "t2", titel: "Logo; versie 2", notitie: "", datum: "2026-07-15", tijd: null, duur: null, prioriteit: 2, afgerond: true }
  ],
  afspraken: [
    { id: "a1", titel: "Overleg", notitie: "", locatie: "Javatoren, Almelo", start: "2026-11-03T09:00:00.000Z", eind: "2026-11-03T10:00:00.000Z", heleDag: false },
    { id: "a2", titel: "Beurs", notitie: "", locatie: "", start: "2026-11-09T23:00:00.000Z", eind: "2026-11-11T23:00:00.000Z", heleDag: true }
  ]
});

test("geldige omhulling en CRLF", () => {
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.ok(!/[^\r]\n/.test(ics), "alleen CRLF");
});
test("urgente taak met tijd: UTC (wintertijd +1), duur, melding", () => {
  assert.match(ics, /UID:taak-t1@studio-levant\.nl/);
  assert.match(ics, /DTSTART:20261102T133000Z\r\nDTEND:20261102T143000Z/);
  assert.match(ics, /SUMMARY:‼ URGENT: Offerte Finkers/);
  assert.match(ics, /BEGIN:VALARM[\s\S]*TRIGGER:-PT15M/);
});
test("afgeronde taak zonder tijd: hele dag, vinkje, escapes", () => {
  assert.match(ics, /DTSTART;VALUE=DATE:20260715\r\nDTEND;VALUE=DATE:20260716/);
  assert.match(ics, /SUMMARY:✓ Logo\; versie 2/);
});
test("afspraken: tijd in UTC, hele dag in Amsterdamse dagen, locatie escaped", () => {
  assert.match(ics, /DTSTART:20261103T090000Z/);
  assert.match(ics, /LOCATION:Javatoren\\, Almelo/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261112/);
});
test("vouwen op 75 octets, ook met multibyte", () => {
  const lang = "DESCRIPTION:" + "é".repeat(100);
  const gevouwen = vouw(lang);
  for (const r of gevouwen.split("\r\n")) assert.ok(new TextEncoder().encode(r).length <= 75);
  assert.equal(gevouwen.split("\r\n ").join(""), lang);
  assert.equal(icsTekst("a\nb,c;d\\"), "a\\nb\\,c\;d\\\\");
});
test("client herkennen", () => {
  assert.equal(clientVan("Google-Calendar-Importer"), "google");
  assert.equal(clientVan("macOS/15.1 (24B83) CalendarAgent/1000"), "apple");
  assert.equal(clientVan("iOS/18.0 (22A3354) dataaccessd/1.0"), "apple");
  assert.equal(clientVan("curl/8"), "overig");
});
console.log(`\n${n} tests geslaagd.`);
