// Tests voor de Apple Agenda-koppeling (lib/apple-agenda/*-kern.ts), zonder netwerk:
//   node --experimental-strip-types scripts/test-apple-agenda.mjs
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
const D = await import("../lib/apple-agenda/dav-kern.ts");
const I = await import("../lib/apple-agenda/ics-kern.ts");
const ID = await import("../lib/apple-agenda/id-kern.ts");

let n = 0;
const test = (naam, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
};

const BASIS = "https://p42-caldav.icloud.com:443/1234567/calendars/";
const AGENDA = { id: "11111111-2222-4333-8444-555555555555", naam: "Werk", kleur: "#ff2968", schrijfbaar: true, email: "marith@icloud.com" };

test("principal en agenda-map uit een Multi-Status", () => {
  const p = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/1234567/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
  assert.equal(D.principalUit(p, "https://caldav.icloud.com/"), "https://caldav.icloud.com/1234567/principal/");
  const h = `<multistatus xmlns="DAV:"><response><href>/1234567/principal/</href><propstat><prop><calendar-home-set xmlns="urn:ietf:params:xml:ns:caldav"><href xmlns="DAV:">https://p42-caldav.icloud.com:443/1234567/calendars/</href></calendar-home-set></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
  assert.equal(D.homeUit(h, "https://caldav.icloud.com/"), "https://p42-caldav.icloud.com/1234567/calendars/");
});

test("nooit naar een server buiten iCloud", () => {
  assert.equal(D.absoluut("https://evil.example/x/", BASIS), null);
  assert.equal(D.absoluut("http://p42-caldav.icloud.com/x/", BASIS), null);
  assert.equal(D.absoluut("https://icloud.com.evil.nl/x/", BASIS), null);
  assert.ok(D.absoluut("/1234567/calendars/home/", BASIS).startsWith("https://p42-caldav.icloud.com/"));
});

test("agenda's: alleen agenda's met afspraken, kleur, rechten", () => {
  const xml = `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
 <response><href>/1234567/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/1234567/calendars/home/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Thuis &amp; zo</displayname>
   <calendar-color xmlns="http://apple.com/ns/ical/">#34AADCFF</calendar-color><calendar-order xmlns="http://apple.com/ns/ical/">2</calendar-order>
   <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
   <current-user-privilege-set><privilege><read/></privilege><privilege><write/></privilege></current-user-privilege-set></prop><status>HTTP/1.1 200 OK</status></propstat>
   <propstat><prop><getctag/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response>
 <response><href>/1234567/calendars/werk/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Werk</displayname>
   <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
   <current-user-privilege-set><privilege><read/></privilege></current-user-privilege-set><calendar-order xmlns="http://apple.com/ns/ical/">1</calendar-order></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/1234567/calendars/taken/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Herinneringen</displayname>
   <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/1234567/calendars/inbox/</href><propstat><prop><resourcetype><collection/><C:schedule-inbox/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`;
  const a = D.agendasUit(xml, BASIS, "#888888");
  assert.deepEqual(
    a.map((x) => [x.naam, x.kleur, x.schrijfbaar]),
    [
      ["Werk", "#888888", false],
      ["Thuis & zo", "#34aadc", true]
    ]
  );
});

test("afspraken uit een calendar-query (calendar-data als tekst)", () => {
  const xml = `<multistatus xmlns="DAV:"><response><href>/1234567/calendars/werk/ABC.ics</href><propstat><prop><getetag>"e1"</getetag>
<calendar-data xmlns="urn:ietf:params:xml:ns:caldav">BEGIN:VCALENDAR&#13;
BEGIN:VEVENT&#13;
SUMMARY:Overleg &lt;team&gt;&#13;
END:VEVENT&#13;
END:VCALENDAR&#13;
</calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
  const it = D.itemsUit(xml);
  assert.equal(it.length, 1);
  assert.equal(it[0].etag, '"e1"');
  assert.match(it[0].ics, /SUMMARY:Overleg <team>/);
});

test("id's: heen en terug, geen paden", () => {
  const id = ID.appleAfspraakId(AGENDA.id, "4F2A-ü.ics", "20261110T080000Z");
  assert.deepEqual(ID.splitsAppleId(id), { agendaId: AGENDA.id, bestand: "4F2A-ü.ics", voorkomen: "20261110T080000Z" });
  assert.equal(ID.splitsAppleId(ID.appleAfspraakId(AGENDA.id, "..")), null);
  assert.equal(ID.splitsAppleId(`a.${AGENDA.id}.${Buffer.from("a/b").toString("base64url")}`), null);
  assert.equal(ID.splitsAppleId("g.x"), null);
  assert.equal(ID.splitsAppleId(`a.${AGENDA.id}.QUJD~2026`), null);
});

const TZ = `BEGIN:VTIMEZONE
TZID:Europe/Amsterdam
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
DTSTART:19810329T020000
TZNAME:CEST
TZOFFSETTO:+0200
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
DTSTART:19961027T030000
TZNAME:CET
TZOFFSETTO:+0100
END:STANDARD
END:VTIMEZONE`;
const REEKS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//iPhone OS 18//EN
${TZ}
BEGIN:VEVENT
UID:reeks-1
DTSTART;TZID=Europe/Amsterdam:20261020T090000
DTEND;TZID=Europe/Amsterdam:20261020T100000
RRULE:FREQ=WEEKLY;BYDAY=TU
EXDATE;TZID=Europe/Amsterdam:20261103T090000
SUMMARY:Werk
BEGIN:VALARM
TRIGGER:-PT15M
ACTION:DISPLAY
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:reeks-1
RECURRENCE-ID;TZID=Europe/Amsterdam:20261110T090000
DTSTART;TZID=Europe/Amsterdam:20261110T140000
DTEND;TZID=Europe/Amsterdam:20261110T150000
SUMMARY:Werk later
END:VEVENT
END:VCALENDAR`;

const van = new Date("2026-10-19T00:00:00Z");
const tot = new Date("2026-11-30T00:00:00Z");

test("herhaling uitvouwen: zomer/wintertijd, EXDATE, los voorkomen", () => {
  const a = I.afsprakenUitIcs(REEKS, "R.ics", AGENDA, van, tot);
  assert.deepEqual(
    a.map((x) => [x.start, x.titel]),
    [
      ["2026-10-20T07:00:00.000Z", "Werk"],
      ["2026-10-27T08:00:00.000Z", "Werk"],
      ["2026-11-10T13:00:00.000Z", "Werk later"],
      ["2026-11-17T08:00:00.000Z", "Werk"],
      ["2026-11-24T08:00:00.000Z", "Werk"]
    ]
  );
  assert.equal(a[0].extern.herhaalt, true);
  assert.equal(a[0].reeksId, ID.appleAfspraakId(AGENDA.id, "R.ics"));
  assert.equal(ID.splitsAppleId(a[2].id).voorkomen, "20261110T080000Z");
  assert.equal(a[2].voorkomen, "2026-11-10");
  assert.equal(a[0].extern.kleur, "#ff2968");
});

test("hele dag, zwevende tijd, geannuleerd en afgeslagen", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:d
DTSTART;VALUE=DATE:20261121
DTEND;VALUE=DATE:20261123
SUMMARY:Weekend
END:VEVENT
END:VCALENDAR`;
  const [d] = I.afsprakenUitIcs(ics, "d.ics", AGENDA, van, tot);
  assert.equal(d.heleDag, true);
  assert.equal(d.start, "2026-11-20T23:00:00.000Z");
  assert.equal(d.eind, "2026-11-22T23:00:00.000Z");
  const z = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:z\nDTSTART:20261121T100000\nDTEND:20261121T110000\nEND:VEVENT\nEND:VCALENDAR`;
  const [zz] = I.afsprakenUitIcs(z, "z.ics", AGENDA, van, tot);
  assert.equal(zz.start, "2026-11-21T09:00:00.000Z");
  assert.equal(zz.titel, "(Geen titel)");
  const c = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:c\nSTATUS:CANCELLED\nDTSTART:20261121T100000Z\nEND:VEVENT\nEND:VCALENDAR`;
  assert.equal(I.afsprakenUitIcs(c, "c.ics", AGENDA, van, tot).length, 0);
  const g = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:g\nDTSTART:20261121T100000Z\nDTEND:20261121T110000Z\nORGANIZER;CN=Baas:mailto:baas@werk.nl\nATTENDEE;PARTSTAT=DECLINED:mailto:marith@icloud.com\nEND:VEVENT\nEND:VCALENDAR`;
  assert.equal(I.afsprakenUitIcs(g, "g.ics", AGENDA, van, tot).length, 0);
  const g2 = g.replace("DECLINED", "ACCEPTED");
  const [u] = I.afsprakenUitIcs(g2, "g.ics", AGENDA, van, tot);
  assert.equal(u.extern.organisator, "Baas");
  assert.equal(u.extern.schrijfbaar, false);
  assert.equal(u.extern.verwijderbaar, true);
  assert.equal(u.extern.gasten[0].ik, true);
});

test("buiten het bereik: niets", () => {
  assert.equal(I.afsprakenUitIcs(REEKS, "R.ics", AGENDA, new Date("2026-01-01"), new Date("2026-02-01")).length, 0);
});

test("nieuwe afspraak: Amsterdamse tijd, herhaling, terug te lezen", () => {
  const ics = I.nieuweIcs(
    { title: "Shoot", notes: "Camera mee", location: "Utrecht", starts_at: "2026-11-24T13:00:00.000Z", ends_at: "2026-11-24T15:30:00.000Z", all_day: false, herhaling: "wekelijks", herhaal_tot: "2026-12-15" },
    "uid-1",
    new Date("2026-11-21T10:00:00Z")
  );
  assert.match(ics, /DTSTART;TZID=Europe\/Amsterdam:20261124T140000/);
  assert.match(ics, /BEGIN:VTIMEZONE/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261215T225959Z/);
  assert.equal(I.uidVan(ics), "uid-1");
  const a = I.afsprakenUitIcs(ics, "n.ics", AGENDA, van, new Date("2027-01-01"));
  assert.equal(a.length, 4);
  assert.equal(a[0].titel, "Shoot");
  assert.equal(a[0].locatie, "Utrecht");
  assert.equal(a[0].start, "2026-11-24T13:00:00.000Z");
  const dag = I.nieuweIcs({ title: "Vrij", starts_at: "2026-11-20T23:00:00.000Z", ends_at: "2026-11-21T23:00:00.000Z", all_day: true }, "uid-2");
  assert.match(dag, /DTSTART;VALUE=DATE:20261121/);
  assert.match(dag, /DTEND;VALUE=DATE:20261122/);
});

test("wijzigen: eenmalig, alleen dit voorkomen, hele reeks", () => {
  const nu = new Date("2026-11-21T10:00:00Z");
  // Eenmalig
  const een = I.nieuweIcs({ title: "A", starts_at: "2026-11-24T13:00:00.000Z", ends_at: "2026-11-24T14:00:00.000Z", all_day: false }, "u");
  const een2 = I.wijzigIcs(een, {
    voorkomen: null,
    deze: false,
    rij: { title: "B", starts_at: "2026-11-25T08:00:00.000Z", ends_at: "2026-11-25T09:00:00.000Z", all_day: false },
    metTijd: true,
    huidig: { start: "2026-11-24T13:00:00.000Z", eind: "2026-11-24T14:00:00.000Z", heleDag: false },
    nu
  });
  const [b] = I.afsprakenUitIcs(een2, "e.ics", AGENDA, van, tot);
  assert.equal(b.titel, "B");
  assert.equal(b.start, "2026-11-25T08:00:00.000Z");
  assert.match(een2, /SEQUENCE:1/);

  // Alleen dit voorkomen (17 nov), alarm van de reeks blijft
  const deze = I.wijzigIcs(REEKS, {
    voorkomen: "20261117T080000Z",
    deze: true,
    rij: { title: "Werk (thuis)" },
    metTijd: false,
    huidig: { start: "2026-11-17T08:00:00.000Z", eind: "2026-11-17T09:00:00.000Z", heleDag: false },
    nu
  });
  const lijst = I.afsprakenUitIcs(deze, "R.ics", AGENDA, van, tot);
  assert.deepEqual(lijst.map((x) => x.titel), ["Werk", "Werk", "Werk later", "Werk (thuis)", "Werk"]);
  assert.equal(lijst[3].start, "2026-11-17T08:00:00.000Z");
  assert.match(deze, /BEGIN:VALARM/);

  // Hele reeks een uur later, vanaf een voorkomen
  const reeks = I.wijzigIcs(REEKS, {
    voorkomen: "20261117T080000Z",
    deze: false,
    rij: { title: "Werk", starts_at: "2026-11-17T09:00:00.000Z", ends_at: "2026-11-17T10:00:00.000Z", all_day: false },
    metTijd: true,
    huidig: { start: "2026-11-17T08:00:00.000Z", eind: "2026-11-17T09:00:00.000Z", heleDag: false },
    nu
  });
  const r = I.afsprakenUitIcs(reeks, "R.ics", AGENDA, van, tot);
  assert.equal(r[0].start, "2026-10-20T08:00:00.000Z");
  assert.equal(r[r.length - 1].start, "2026-11-24T09:00:00.000Z");
});

test("één voorkomen verwijderen (EXDATE) en een los voorkomen weghalen", () => {
  const zonder = I.zonderVoorkomen(REEKS, "20261117T080000Z");
  assert.deepEqual(I.afsprakenUitIcs(zonder, "R.ics", AGENDA, van, tot).map((x) => x.start.slice(0, 10)), ["2026-10-20", "2026-10-27", "2026-11-10", "2026-11-24"]);
  const zonder2 = I.zonderVoorkomen(REEKS, "20261110T080000Z");
  assert.doesNotMatch(zonder2, /Werk later/);
  assert.equal(I.afsprakenUitIcs(zonder2, "R.ics", AGENDA, van, tot).length, 4);
  // Hele dag
  const dag = I.nieuweIcs({ title: "D", starts_at: "2026-11-20T23:00:00.000Z", ends_at: "2026-11-21T23:00:00.000Z", all_day: true, herhaling: "dagelijks", herhaal_tot: null }, "u3");
  const dag2 = I.zonderVoorkomen(dag, "20261122");
  const d = I.afsprakenUitIcs(dag2, "d.ics", AGENDA, van, new Date("2026-11-24T22:00:00Z")).map((x) => x.voorkomen);
  assert.deepEqual(d, ["2026-11-21", "2026-11-23", "2026-11-24"]);
});

test("onleesbare data: geen crash", () => {
  assert.deepEqual(I.afsprakenUitIcs("onzin", "x.ics", AGENDA, van, tot), []);
  assert.throws(() => D.leesMultistatus("<a><b></a>"));
  assert.throws(() => I.wijzigIcs("onzin", { voorkomen: null, deze: false, rij: {}, metTijd: false, huidig: { start: "", eind: "", heleDag: false } }));
});

console.log(`${n} tests geslaagd`);
