// Tests voor lib/google-agenda/kern.ts (Google Agenda-koppeling, zonder netwerk) en de
// Google-afspraken in de agenda-link (lib/agenda/ics.ts):
//   node --experimental-strip-types scripts/test-google-agenda.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
// Relatieve imports zonder extensie (./datum, ../agenda/herhaling) naar .ts laten wijzen.
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (/^\\.\\.?\\//.test(spec) && !/\\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.endsWith('.ts')) return next(spec + '.ts', ctx);
  return next(spec, ctx);
}`),
  import.meta.url
);
const K = await import("../lib/google-agenda/kern.ts");
const { parseAfspraak } = await import("../lib/agenda/invoer.ts");
const { maakIcs } = await import("../lib/agenda/ics.ts");

let n = 0;
const test = (naam, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
};

const AG = "6f1c2b3a-1111-4222-8333-944455556666";
const agenda = { id: AG, naam: "Werk", kleur: "#039be5", toegang: "owner" };

test("id heen en terug, ongeldige id's geweigerd", () => {
  const id = K.googleAfspraakId(AG, "abc123_20261106T090000Z");
  assert.equal(id, `g.${AG}.abc123_20261106T090000Z`);
  assert.deepEqual(K.splitsGoogleId(id), { agendaId: AG, eventId: "abc123_20261106T090000Z" });
  assert.equal(K.splitsGoogleId(`g.${AG}.`), null);
  assert.equal(K.splitsGoogleId(`g.niet-een-uuid.abc`), null);
  assert.equal(K.splitsGoogleId(`g.${AG}.a/b`), null);
  assert.equal(K.splitsGoogleId(`g.${AG}.a b`), null);
  assert.equal(K.splitsGoogleId(AG), null);
  assert.equal(K.isGoogleAfspraakId(id), true);
});

test("afspraak met tijd, Meet-link, gasten en eigen kleur", () => {
  const a = K.naarAfspraak(
    {
      id: "ev1",
      summary: " Kick-off  ",
      description: 'Agenda:<br><b>1.</b> Intro<br><a href="https://studio-levant.nl/plan">het plan</a> &amp; meer',
      location: "Stationsstraat 11, Almelo",
      start: { dateTime: "2026-11-06T10:00:00+01:00", timeZone: "Europe/Amsterdam" },
      end: { dateTime: "2026-11-06T11:30:00+01:00" },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }], conferenceSolution: { name: "Google Meet" } },
      htmlLink: "https://www.google.com/calendar/event?eid=xyz",
      colorId: "11",
      organizer: { email: "bram@gmail.com", self: true },
      attendees: [
        { email: "bram@gmail.com", self: true, responseStatus: "accepted" },
        { email: "klant@voorbeeld.nl", displayName: "Klant", responseStatus: "tentative" },
        { email: "zaal@resource.calendar.google.com", resource: true, responseStatus: "accepted" }
      ]
    },
    agenda
  );
  assert.equal(a.id, `g.${AG}.ev1`);
  assert.equal(a.titel, "Kick-off");
  assert.equal(a.start, "2026-11-06T09:00:00.000Z");
  assert.equal(a.eind, "2026-11-06T10:30:00.000Z");
  assert.equal(a.heleDag, false);
  assert.equal(a.notitie, "Agenda:\n1. Intro\nhet plan (https://studio-levant.nl/plan) & meer");
  assert.equal(a.google.meetLink, "https://meet.google.com/abc-defg-hij");
  assert.equal(a.google.vergaderDienst, "Google Meet");
  assert.equal(a.google.kleur, "#d50000", "colorId 11 = tomaat");
  assert.equal(a.google.schrijfbaar, true);
  assert.equal(a.google.organisator, null);
  assert.equal(a.google.gasten.length, 2, "geen vergaderruimte");
  assert.deepEqual(a.google.gasten[1], { email: "klant@voorbeeld.nl", naam: "Klant", status: "tentative", ik: false });
  assert.equal(a.reeksId, null);
  assert.equal(a.google.herhaalt, false);
});

test("hele dag (meerdaags): 00:00 Amsterdam t/m 00:00 na de laatste dag", () => {
  const a = K.naarAfspraak({ id: "d1", summary: "Beurs", start: { date: "2026-11-10" }, end: { date: "2026-11-12" } }, agenda);
  assert.equal(a.heleDag, true);
  assert.equal(a.start, "2026-11-09T23:00:00.000Z");
  assert.equal(a.eind, "2026-11-11T23:00:00.000Z");
  // Zomertijd
  const z = K.naarAfspraak({ id: "d2", start: { date: "2026-07-01" }, end: { date: "2026-07-02" } }, agenda);
  assert.equal(z.start, "2026-06-30T22:00:00.000Z");
  assert.equal(z.titel, "(Geen titel)");
});

test("niet tonen: geannuleerd, afgeslagen, werklocatie, zonder tijd", () => {
  const basis = { start: { dateTime: "2026-11-06T10:00:00Z" }, end: { dateTime: "2026-11-06T11:00:00Z" } };
  assert.equal(K.naarAfspraak({ id: "x", status: "cancelled", ...basis }, agenda), null);
  assert.equal(K.naarAfspraak({ id: "x", attendees: [{ email: "a@b.nl", self: true, responseStatus: "declined" }], ...basis }, agenda), null);
  assert.equal(K.naarAfspraak({ id: "x", eventType: "workingLocation", ...basis }, agenda), null);
  assert.equal(K.naarAfspraak({ id: "x" }, agenda), null);
  assert.ok(K.naarAfspraak({ id: "x", ...basis }, agenda));
});

test("voorkomen van een reeks: reeks-id en oorspronkelijke datum", () => {
  const a = K.naarAfspraak(
    {
      id: "reeks1_20261109T090000Z",
      recurringEventId: "reeks1",
      originalStartTime: { dateTime: "2026-11-09T10:00:00+01:00" },
      start: { dateTime: "2026-11-10T10:00:00+01:00" },
      end: { dateTime: "2026-11-10T11:00:00+01:00" }
    },
    agenda
  );
  assert.equal(a.reeksId, "reeks1");
  assert.equal(a.voorkomen, "2026-11-09", "verplaatst voorkomen houdt zijn oorspronkelijke datum");
  assert.equal(a.google.herhaalt, true);
  assert.equal(a.google.eventId, "reeks1_20261109T090000Z");
});

test("rechten: alleen-lezen agenda, gast, gasten mogen wijzigen", () => {
  const basis = { id: "r", start: { dateTime: "2026-11-06T10:00:00Z" }, end: { dateTime: "2026-11-06T11:00:00Z" } };
  const lezen = K.naarAfspraak(basis, { ...agenda, toegang: "reader" });
  assert.equal(lezen.google.schrijfbaar, false);
  assert.equal(lezen.google.verwijderbaar, false);
  const gast = K.naarAfspraak({ ...basis, organizer: { email: "ander@bedrijf.nl", displayName: "Ander" } }, agenda);
  assert.equal(gast.google.schrijfbaar, false);
  assert.equal(gast.google.verwijderbaar, true, "als gast mag je hem uit je eigen agenda halen");
  assert.equal(gast.google.organisator, "Ander");
  const mag = K.naarAfspraak({ ...basis, organizer: { email: "ander@bedrijf.nl" }, guestsCanModify: true }, agenda);
  assert.equal(mag.google.schrijfbaar, true);
});

test("alleen http(s)-links (Meet, Google-link)", () => {
  const a = K.naarAfspraak(
    {
      id: "l",
      start: { dateTime: "2026-11-06T10:00:00Z" },
      end: { dateTime: "2026-11-06T11:00:00Z" },
      hangoutLink: "javascript:alert(1)",
      htmlLink: "data:text/html,x"
    },
    agenda
  );
  assert.equal(a.google.meetLink, null);
  assert.equal(a.google.link, null);
});

test("HTML-beschrijving → platte tekst", () => {
  assert.equal(K.htmlNaarTekst("Gewoon tekst\nmet regels"), "Gewoon tekst\nmet regels");
  assert.equal(K.htmlNaarTekst("<ul><li>Een</li><li>Twee</li></ul>"), "• Een\n• Twee");
  assert.equal(K.htmlNaarTekst("<p>A</p><p>B</p>"), "A\nB");
  assert.equal(K.htmlNaarTekst('<a href="mailto:x@y.nl">x@y.nl</a> &lt;3 &#39;hoi&#39;'), "x@y.nl <3 'hoi'");
  assert.equal(K.htmlNaarTekst(""), "");
});

test("invoer → Google-body: tijd in Amsterdam, hele dag exclusief eind, herhaling, Meet", () => {
  const p = parseAfspraak({ titel: "Overleg", datum: "2026-11-06", start: "10:00", eind: "11:30", notitie: "x", locatie: "Studio" }, null);
  assert.ok(p.ok);
  const b = K.googleBody(p.waarde, { metTijd: true, meet: true, requestId: "r1" });
  assert.equal(b.summary, "Overleg");
  assert.deepEqual(b.start, { dateTime: "2026-11-06T09:00:00.000Z", timeZone: "Europe/Amsterdam" });
  assert.deepEqual(b.end, { dateTime: "2026-11-06T10:30:00.000Z", timeZone: "Europe/Amsterdam" });
  assert.deepEqual(b.conferenceData, { createRequest: { requestId: "r1", conferenceSolutionKey: { type: "hangoutsMeet" } } });

  const h = parseAfspraak({ titel: "Beurs", datum: "2026-11-10", eindDatum: "2026-11-11", heleDag: true }, null);
  const hb = K.googleBody(h.waarde, { metTijd: true });
  assert.deepEqual(hb.start, { date: "2026-11-10" });
  assert.deepEqual(hb.end, { date: "2026-11-12" }, "Google: einddatum is de dag ná de laatste");

  const r = parseAfspraak({ titel: "Standup", datum: "2026-11-09", start: "09:00", herhaling: "werkdagen", herhaalTot: "2026-12-18" }, null);
  const rb = K.googleBody(r.waarde, { metTijd: true });
  assert.deepEqual(rb.recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261218T225959Z"]);
  const rh = parseAfspraak({ titel: "Vrij", datum: "2026-11-09", heleDag: true, herhaling: "jaarlijks" }, null);
  assert.deepEqual(K.googleBody(rh.waarde, { metTijd: true }).recurrence, ["RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=9"]);

  // Alleen de titel: geen tijden of herhaling meesturen.
  assert.deepEqual(K.googleBody({ title: "Nieuw" }, { metTijd: false }), { summary: "Nieuw" });
});

test("hele reeks verschuiven zoals het voorkomen", () => {
  // Reeks begint ma 2 nov 10:00–11:00; het voorkomen van ma 9 nov gaat naar di 10 nov 14:00–15:30.
  const t = K.reeksTijden(
    { start: "2026-11-02T09:00:00.000Z", eind: "2026-11-02T10:00:00.000Z", heleDag: false },
    { start: "2026-11-09T09:00:00.000Z", heleDag: false },
    { start: "2026-11-10T13:00:00.000Z", eind: "2026-11-10T14:30:00.000Z", heleDag: false }
  );
  assert.deepEqual(t, { start: "2026-11-03T13:00:00.000Z", eind: "2026-11-03T14:30:00.000Z" });
  // Over de zomertijdwissel heen blijft de wandkloktijd gelijk.
  const z = K.reeksTijden(
    { start: "2026-10-19T08:00:00.000Z", eind: "2026-10-19T09:00:00.000Z", heleDag: false },
    { start: "2026-11-02T09:00:00.000Z", heleDag: false },
    { start: "2026-11-02T10:00:00.000Z", eind: "2026-11-02T11:00:00.000Z", heleDag: false }
  );
  assert.deepEqual(z, { start: "2026-10-19T09:00:00.000Z", eind: "2026-10-19T10:00:00.000Z" }, "11:00 zomertijd = 09:00Z");
});

test("standaard bij koppelen: eigen agenda's aan, de rest uit; geïmporteerde links nooit", () => {
  assert.deepEqual(K.standaardInstellingen({ id: "bram@gmail.com", primary: true, accessRole: "owner" }, false), { zichtbaar: true, inFeed: true });
  assert.deepEqual(K.standaardInstellingen({ id: "bram@gmail.com", primary: true, accessRole: "owner" }, true), { zichtbaar: true, inFeed: false });
  assert.deepEqual(K.standaardInstellingen({ id: "nl.dutch#holiday@group.v.calendar.google.com", accessRole: "reader" }, false), { zichtbaar: false, inFeed: false });
  assert.deepEqual(K.standaardInstellingen({ id: "abc@group.calendar.google.com", accessRole: "owner" }, false), { zichtbaar: true, inFeed: true });
  assert.deepEqual(K.standaardInstellingen({ id: "x@import.calendar.google.com", accessRole: "owner" }, false), { zichtbaar: false, inFeed: false });
  assert.deepEqual(K.standaardInstellingen({ id: "collega@gmail.com", accessRole: "writer" }, false), { zichtbaar: false, inFeed: false });
  assert.equal(K.isImportAgenda("abc@import.calendar.google.com"), true);
});

test("kleuren en scopes", () => {
  assert.equal(K.normKleur("#9FE1E7"), "#9fe1e7");
  assert.equal(K.normKleur("rood"), K.STANDAARD_KLEUR);
  assert.equal(K.isKleur("#c8a97e"), true);
  assert.equal(K.isKleur("#C8A97E"), false);
  assert.ok(K.KLEUREN.every((k) => K.isKleur(k.kleur)));
  assert.equal(K.heeftScopes(`openid ${K.SCOPE_LIJST} ${K.SCOPE_EVENTS}`), true);
  assert.equal(K.heeftScopes(K.SCOPE_EVENTS), false);
  const u = new URL(K.autorisatieUrl({ clientId: "c", redirectUri: "https://x.nl/api/google-agenda/callback", state: "s" }));
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.match(u.searchParams.get("scope"), /calendar\.events/);
  assert.match(u.searchParams.get("prompt"), /consent/);
});

test("agenda-link: Google-afspraak met eigen UID, agendanaam en Google-link", () => {
  const ics = maakIcs({
    naam: "Bram",
    link: "https://backoffice.studio-levant.nl/agenda",
    nu: new Date("2026-11-06T10:00:00Z"),
    taken: [],
    afspraken: [
      {
        id: `g.${AG}.ev1`,
        uid: `google-${AG}-ev1`,
        titel: "Kick-off",
        notitie: "Google Meet: https://meet.google.com/abc",
        locatie: "https://meet.google.com/abc",
        start: "2026-11-06T09:00:00.000Z",
        eind: "2026-11-06T10:00:00.000Z",
        heleDag: false,
        categorie: "Werk",
        link: "https://www.google.com/calendar/event?eid=xyz"
      }
    ]
  });
  const plat = ics.replace(/\r\n /g, "");
  assert.match(plat, new RegExp(`UID:google-${AG}-ev1@studio-levant.nl`));
  assert.match(plat, /CATEGORIES:Werk/);
  assert.match(plat, /Openen in Google Agenda: https:\/\/www.google.com\/calendar\/event\?eid=xyz/);
  assert.doesNotMatch(plat, /Afspraak in Studio Levant/);
});

console.log(`\n${n} tests geslaagd`);
