// Tests voor terugkerende facturen (migratie 0036), zonder database en zonder netwerk:
//   - lib/invoice/terugkerend-kern.ts: planning (eerste datum, opschuiven, inhalen), periodes,
//     placeholders, de controle van het formulier en wanneer een sjabloon aan de beurt is;
//   - bron: de cron roept het aan, de routes gaan via de teamcheck, de tabel heeft RLS zonder
//     policies en invoices een unieke index per sjabloon en periode.
//   node --experimental-strip-types scripts/test-terugkerend.mjs
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
const K = await import("../lib/invoice/terugkerend-kern.ts");

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

test("eerste datum: deze maand als de dag nog komt, anders volgende maand", () => {
  assert.equal(K.eersteDatum("2026-11-14", 1), "2026-12-01");
  assert.equal(K.eersteDatum("2026-11-14", 14), "2026-11-14");
  assert.equal(K.eersteDatum("2026-11-14", 28), "2026-11-28");
  assert.equal(K.eersteDatum("2026-12-15", 1), "2027-01-01");
});
test("opschuiven per maand, kwartaal en jaar, over de jaarwisseling", () => {
  assert.equal(K.schuifOp("2026-12-01", "maand", 1), "2027-01-01");
  assert.equal(K.schuifOp("2026-11-01", "kwartaal", 1), "2027-02-01");
  assert.equal(K.schuifOp("2026-11-28", "jaar", 28), "2027-11-28");
  assert.equal(K.schuifOp("2026-01-15", "maand", 15, 13), "2027-02-15");
});
test("inhalen bij hervatten: eerstvolgende in hetzelfde ritme", () => {
  assert.equal(K.inhalen("2026-08-01", "maand", 1, "2026-11-14"), "2026-12-01");
  assert.equal(K.inhalen("2026-02-01", "kwartaal", 1, "2026-11-14"), "2027-02-01");
  assert.equal(K.inhalen("2026-12-01", "maand", 1, "2026-11-14"), "2026-12-01");
  assert.equal(K.inhalen("2026-11-14", "maand", 14, "2026-11-14"), "2026-11-14");
});
test("periode en placeholders", () => {
  assert.equal(K.periodeLabel("2026-11-01", "maand"), "november 2026");
  assert.equal(K.periodeLabel("2026-11-01", "kwartaal"), "Q4 2026");
  assert.equal(K.periodeLabel("2026-03-01", "jaar"), "2026");
  const p = { datum: "2027-01-01", interval: "maand", factuurnummer: "27-001", bedrag: "€ 60,50", klant: "Kapsalon X" };
  assert.equal(K.vulIn("Onderhoud {periodenaam} ({maand} {jaar}, {kwartaal})", p), "Onderhoud januari 2027 (januari 2027, Q1)");
  assert.equal(K.vulIn("{periode}", p), "1/1/2027 t/m 31/1/2027");
  assert.equal(K.vulIn(K.STANDAARD_ONDERWERP, p), "Factuur 27-001 – januari 2027");
  assert.ok(K.vulIn(K.STANDAARD_BERICHT, p).startsWith("Beste Kapsalon X,"));
  assert.equal(K.vulIn("{factuurnummer} {onbekend}", { datum: "2027-01-01", interval: "maand" }), "{factuurnummer} {onbekend}");
});
test("periode als datumbereik (middelste kolom)", () => {
  assert.equal(K.periodeBereik("2026-12-01", "maand", 1), "1/12/2026 t/m 31/12/2026");
  assert.equal(K.periodeBereik("2027-02-01", "maand", 1), "1/2/2027 t/m 28/2/2027");
  assert.equal(K.periodeBereik("2028-02-01", "maand", 1), "1/2/2028 t/m 29/2/2028");
  assert.equal(K.periodeBereik("2026-11-15", "maand", 15), "15/11/2026 t/m 14/12/2026");
  assert.equal(K.periodeBereik("2026-10-01", "kwartaal", 1), "1/10/2026 t/m 31/12/2026");
  assert.equal(K.periodeBereik("2026-01-01", "jaar", 1), "1/1/2026 t/m 31/12/2026");
  assert.equal(K.vulIn("{periode}", { datum: "2026-11-15", interval: "maand", dag: 15 }), "15/11/2026 t/m 14/12/2026");
});
test("aan de beurt en na uitvoeren (einddatum)", () => {
  const s = { actief: true, volgende_datum: "2026-12-01", eind_datum: null, interval: "maand", dag: 1 };
  assert.equal(K.isAanDeBeurt(s, "2026-11-30"), false);
  assert.equal(K.isAanDeBeurt(s, "2026-12-01"), true);
  assert.equal(K.isAanDeBeurt(s, "2026-12-03"), true, "cron een dag gemist: alsnog");
  assert.equal(K.isAanDeBeurt({ ...s, actief: false }, "2026-12-01"), false);
  assert.equal(K.isAanDeBeurt({ ...s, eind_datum: "2026-11-30" }, "2026-12-01"), false);
  assert.deepEqual(K.naUitvoeren(s), { volgende: "2027-01-01", klaar: false });
  assert.deepEqual(K.naUitvoeren({ ...s, eind_datum: "2026-12-31" }), { volgende: "2027-01-01", klaar: true });
});

const goed = {
  klant: { bedrijfsnaam: " 't Trefpunt ", tav: "Jan", adres: "", postcode: "" },
  naam: " Onderhoudspakket ",
  regels: [{ beschrijving: "Onderhoud website", midden: "{periode}", totaal: "50,00" }, { beschrijving: "", totaal: "9" }],
  interval: "maand",
  dag: 1,
  volgendeDatum: "2026-12-01",
  versturen: true,
  emailAan: "klant@voorbeeld.nl; boekhouding@voorbeeld.nl",
  mailboxId: "env"
};
const opties = { vandaag: "2026-11-14" };
test("formulier: geldige invoer, lege regels weg, standaardteksten", () => {
  const r = K.parseTerugkerend(goed, opties);
  assert.equal(r.ok, true, r.fout);
  assert.deepEqual(r.waarde.klant, { bedrijfsnaam: "'t Trefpunt", tav: "Jan", adres: "", postcode: "" });
  r.waarde = r.waarde.sjabloon;
  assert.equal(r.waarde.naam, "Onderhoudspakket");
  assert.equal(r.waarde.regels.length, 1);
  assert.equal(r.waarde.regels[0].totaal, 50);
  assert.equal(r.waarde.email_aan, "klant@voorbeeld.nl, boekhouding@voorbeeld.nl");
  assert.equal(r.waarde.onderwerp, K.STANDAARD_ONDERWERP);
  assert.equal(r.waarde.actief, true);
  assert.equal(r.waarde.btw_verlegd_reden, "");
});
test("formulier: wat geweigerd wordt", () => {
  const fout = (w, veld) => {
    const r = K.parseTerugkerend({ ...goed, ...w }, opties);
    assert.equal(r.ok, false, JSON.stringify(w));
    if (veld) assert.equal(r.veld, veld);
  };
  fout({ klant: { bedrijfsnaam: " " } }, "klant");
  fout({ klant: undefined }, "klant");
  fout({ naam: "" }, "naam");
  fout({ regels: [{ beschrijving: "", totaal: "1" }] }, "regels");
  fout({ interval: "week" }, "interval");
  fout({ dag: 31 }, "dag");
  fout({ volgendeDatum: "2026-11-01" }, "volgendeDatum");
  fout({ volgendeDatum: "2026-12-02" }, "volgendeDatum");
  fout({ volgendeDatum: "2026-02-30" }, "volgendeDatum");
  fout({ eindDatum: "2026-11-30" }, "eindDatum");
  fout({ emailAan: "" }, "emailAan");
  fout({ emailAan: "geen-adres" }, "emailAan");
  fout({ mailboxId: "" }, "mailboxId");
});
test("formulier: zonder versturen geen adres nodig; bestaande datum in het verleden mag blijven", () => {
  assert.equal(K.parseTerugkerend({ ...goed, versturen: false, emailAan: "", mailboxId: "" }, opties).ok, true);
  assert.equal(K.parseTerugkerend({ ...goed, volgendeDatum: "2026-11-01" }, { ...opties, huidigeDatum: "2026-11-01" }).ok, true);
});

test("factuurnummer in de naam: eigen titel, hoofdletters maken niet uit", () => {
  const p = { datum: "2026-12-01", interval: "maand", dag: 1, factuurnummer: "26-031", klant: "Trefpunt" };
  assert.equal(K.factuurNaam("Factuur {factuurnummer}", p), "Factuur 26-031");
  assert.equal(K.factuurNaam("Factuur {Factuurnummer} – {periodenaam}", p), "Factuur 26-031 – december 2026");
  assert.equal(K.factuurNaam("Onderhoudspakket", p), "Factuur 26-031 · Onderhoudspakket", "zonder placeholder: nummer ervoor, zoals altijd");
  assert.equal(K.vulIn("{FACTUURNUMMER} {Periodenaam}", p), "26-031 december 2026");
  assert.ok(K.metFactuurnummer("Factuur {FactuurNummer}"));
  assert.ok(/factuurNaam\(s\.naam, p\)/.test(lees("lib/invoice/terugkerend.ts")), "cron en voorbeeld gebruiken dezelfde naam");
});
test("akkoord vooraf: wanneer gevraagd, goedgekeurd of niet nodig", () => {
  const t = { actief: true, versturen: true, akkoord_vereist: true, akkoord_periode: null, volgende_datum: "2026-12-01" };
  assert.equal(K.dagenTussen("2026-11-24", "2026-12-01"), 7);
  assert.equal(K.dagenTussen("2026-12-02", "2026-12-01"), -1);
  assert.equal(K.akkoordStand(t, "2026-11-23"), "later");
  assert.equal(K.akkoordStand(t, "2026-11-24"), "gevraagd", "precies een week van tevoren");
  assert.equal(K.akkoordStand(t, "2026-12-03"), "gevraagd", "al voorbij en nog geen akkoord");
  assert.equal(K.akkoordStand({ ...t, akkoord_periode: "2026-12-01" }, "2026-11-30"), "akkoord");
  assert.equal(K.akkoordStand({ ...t, akkoord_periode: "2026-11-01" }, "2026-11-30"), "gevraagd", "akkoord van vorige maand telt niet");
  assert.equal(K.akkoordStand({ ...t, akkoord_vereist: false }, "2026-11-30"), "niet_nodig");
  assert.equal(K.akkoordStand({ ...t, akkoord_vereist: undefined }, "2026-11-30"), "niet_nodig", "vóór 0038");
  assert.equal(K.akkoordStand({ ...t, versturen: false }, "2026-11-30"), "niet_nodig");
  assert.equal(K.akkoordStand({ ...t, actief: false }, "2026-11-30"), "niet_nodig");
  assert.equal(K.parseTerugkerend(goed, opties).waarde.sjabloon.akkoord_vereist, true, "standaard aan");
  assert.equal(K.parseTerugkerend({ ...goed, akkoordVereist: false }, opties).waarde.sjabloon.akkoord_vereist, false);
});
test("akkoord vooraf: bron (cron houdt vast, wijzigen wist akkoord, migratie 0038)", () => {
  const t = lees("lib/invoice/terugkerend.ts");
  assert.ok(/!nu && s\.akkoord_vereist === true && s\.akkoord_periode !== periode/.test(t));
  assert.ok(/wacht_op_akkoord: true/.test(t) && /wacht_op_akkoord: false/.test(t));
  assert.ok(/akkoord_periode: null/.test(lees("app/api/terugkerend/[id]/route.ts")));
  const m = lees("supabase/migrations/0038_terugkerend_akkoord.sql");
  assert.equal(m, lees("supabase/UITVOEREN_0038.sql"));
  assert.ok(/akkoord_vereist boolean not null default true/.test(m) && /wacht_op_akkoord boolean not null default false/.test(m));
  assert.ok(/controleerRoute\(request\)/.test(lees("app/api/terugkerend/akkoord/route.ts")));
  assert.ok(/controleerRoute\(request\)/.test(lees("app/api/terugkerend/[id]/voorbeeld/route.ts")));
});
test("bron: cron, routes, migratie", () => {
  const cron = lees("app/api/cron/dagelijks/route.ts");
  assert.ok(/verwerkTerugkerend\(service, vandaagNL\(\)\)/.test(cron));
  for (const p of ["app/api/terugkerend/route.ts", "app/api/terugkerend/[id]/route.ts", "app/api/terugkerend/[id]/nu/route.ts", "app/api/terugkerend/[id]/versturen/route.ts"]) {
    assert.ok(/controleerRoute\(request\)/.test(lees(p)), p);
  }
  for (const p of ["app/(app)/facturen/terugkerend/page.tsx", "app/(app)/facturen/nieuwe-factuur/page.tsx", "app/(app)/facturen/terugkerend/[id]/page.tsx"]) {
    assert.ok(/vereisTeamlidPagina\(/.test(lees(p)), p);
  }
  const m = lees("supabase/migrations/0036_terugkerende_facturen.sql");
  assert.ok(/enable row level security/.test(m) && /revoke all on public\.terugkerende_facturen from anon, authenticated/.test(m));
  assert.ok(!/create policy[^;]*terugkerende_facturen/.test(m), "geen policies op terugkerende_facturen");
  assert.ok(/create unique index if not exists invoices_terugkerend_periode_uniek/.test(m));
  const t = lees("lib/invoice/terugkerend.ts");
  assert.ok(/\.eq\('volgende_datum', periode\)/.test(t), "claimen op de oude datum");
});

console.log(`${geslaagd} geslaagd, ${mislukt} mislukt`);
if (mislukt) process.exit(1);
