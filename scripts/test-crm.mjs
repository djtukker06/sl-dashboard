// Tests voor Klanten & projecten (0022, stap 3), zonder database en zonder netwerk:
//   - lib/crm/invoer.ts: klant aanmaken/wijzigen (bedrijfsnaam verplicht, status standaard
//     lead, e-mail/telefoon gecontroleerd), notities en de ilike-escape voor prijsopgaven;
//   - bronbewaking: elke nieuwe route en pagina gaat via de centrale teamcheck, klanten
//     verwijderen kan hier niet, de rail heeft één tab "Klanten" (6 items) en de
//     facturen-routes zijn niet aangeraakt.
// De RLS van client_notes/project_eigenaren en de omzetting van de projectstatus staan in
// scripts/test-rls.mjs (PGlite).
//
// Gebruik:  node scripts/test-crm.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let inv;
try {
  inv = await import(pathToFileURL(path.join(ROOT, "lib", "crm", "invoer.ts")).href);
} catch (e) {
  if (process.execArgv.includes("--experimental-strip-types")) throw e;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

let goed = 0;
let fout = 0;
function test(naam, fn) {
  try {
    fn();
    goed++;
  } catch (e) {
    fout++;
    console.log(`  FOUT  ${naam}\n        ${e.message.split("\n")[0]}`);
  }
}

// ---------------------------------------------------------------------------------
// Invoer
// ---------------------------------------------------------------------------------
test("klant: bedrijfsnaam verplicht bij nieuw", () => {
  assert.equal(inv.parseKlant({}, true).ok, false);
  assert.equal(inv.parseKlant({ naam: "   " }, true).ok, false);
});
test("klant: nieuw met alleen een naam → status lead", () => {
  assert.deepEqual(inv.parseKlant({ naam: "  Bakkerij   De Gouden Korst " }, true).waarde, {
    company_name: "Bakkerij De Gouden Korst",
    status: "lead",
  });
});
test("klant: snel toevoegen (3 velden + status)", () => {
  const r = inv.parseKlant({ naam: "Acme", contactpersoon: "Ans", email: " Ans@Acme.NL ", status: "actief" }, true);
  assert.deepEqual(r.waarde, { company_name: "Acme", contact_name: "Ans", email: "ans@acme.nl", status: "actief" });
});
test("klant: lege contactpersoon/adres/postcode → null (zoals de facturen)", () => {
  const r = inv.parseKlant({ contactpersoon: "", adres: " ", postcode: "" }, false);
  assert.deepEqual(r.waarde, { contact_name: null, address: null, postal_code: null });
});
test("klant: postcode in hoofdletters", () => assert.equal(inv.parseKlant({ postcode: "1234 ab" }, false).waarde.postal_code, "1234 AB"));
test("klant: ongeldig e-mailadres", () => assert.equal(inv.parseKlant({ email: "geen-mail" }, false).ok, false));
test("klant: e-mail leegmaken mag", () => assert.equal(inv.parseKlant({ email: "" }, false).waarde.email, ""));
test("klant: telefoon alleen cijfers en + ( ) -", () => {
  assert.equal(inv.parseKlant({ telefoon: "+31 (0)6-12 34 56 78" }, false).ok, true);
  assert.equal(inv.parseKlant({ telefoon: "bel me" }, false).ok, false);
  assert.equal(inv.parseKlant({ telefoon: "1".repeat(41) }, false).ok, false);
});
test("klant: status alleen lead/actief/afgerond", () => {
  for (const s of ["lead", "actief", "afgerond"]) assert.equal(inv.parseKlant({ status: s }, false).waarde.status, s);
  assert.equal(inv.parseKlant({ status: "kans" }, false).ok, false);
});
test("klant: te lange naam", () => assert.equal(inv.parseKlant({ naam: "x".repeat(201) }, false).ok, false));
test("klant: geen tekst in plaats van string", () => assert.equal(inv.parseKlant({ naam: 5 }, false).ok, false));
test("klant: lege wijziging geweigerd", () => assert.equal(inv.parseKlant({}, false).ok, false));
test("klant: onbekende velden genegeerd (geen created_by/id van buiten)", () => {
  const r = inv.parseKlant({ naam: "A", created_by: "x", id: "y", company_name_normalized: "z" }, true);
  assert.deepEqual(Object.keys(r.waarde).sort(), ["company_name", "status"]);
});
test("notitie: leeg geweigerd", () => {
  assert.equal(inv.parseNotitie("  ").ok, false);
  assert.equal(inv.parseNotitie(undefined).ok, false);
});
test("notitie: regels blijven, rand weg", () => assert.equal(inv.parseNotitie("  regel 1\r\nregel 2 ").waarde, "regel 1\nregel 2"));
test("notitie: maximaal 2000 tekens", () => {
  assert.equal(inv.parseNotitie("x".repeat(2000)).ok, true);
  assert.equal(inv.parseNotitie("x".repeat(2001)).ok, false);
});
test("ilike: % _ en \\ letterlijk", () => assert.equal(inv.likeLetterlijk("50%_a\\b"), "50\\%\\_a\\\\b"));

// ---------------------------------------------------------------------------------
// Bronbewaking
// ---------------------------------------------------------------------------------
const ROUTES = [
  "app/api/klanten/route.ts",
  "app/api/klanten/[id]/route.ts",
  "app/api/klanten/[id]/notities/route.ts",
  "app/api/klanten/[id]/notities/[notitieId]/route.ts",
  "app/api/projecten/route.ts",
  "app/api/projecten/[id]/route.ts",
];
for (const f of ROUTES) {
  test(`${f}: elke handler begint met de teamcheck (metSessie)`, () => {
    const src = lees(f);
    const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g) ?? [];
    assert.ok(handlers.length > 0);
    const checks = src.match(/const s = await metSessie\(request\);\s*if \('antwoord' in s\) return s\.antwoord;/g) ?? [];
    assert.equal(checks.length, handlers.length);
    assert.ok(!/createServiceClient|service_role|SERVICE_ROLE/.test(src), "geen service-role");
  });
}
test("klanten verwijderen kan niet via de nieuwe API", () => {
  for (const f of ROUTES.filter((r) => r.includes("klanten"))) {
    const src = lees(f);
    assert.ok(!/from\('clients'\)\s*\.delete\(/.test(src), f);
  }
});
test("notitie verwijderen: alleen je eigen (ook in de query, naast de RLS)", () => {
  assert.match(lees("app/api/klanten/[id]/notities/[notitieId]/route.ts"), /\.eq\('created_by', s\.bron\.userId\)/);
});

const PAGINAS = ["app/(app)/klanten/page.tsx", "app/(app)/klanten/[id]/page.tsx", "app/(app)/projecten/page.tsx", "app/(app)/projecten/[id]/page.tsx", "app/(app)/agenda/projecten/page.tsx"];
for (const f of PAGINAS) {
  test(`${f}: teamcheck vóór de data`, () => {
    const src = lees(f);
    const i = src.indexOf("vereisTeamlidPagina(");
    assert.ok(i > 0);
    const data = src.search(/klantenLijst\(|klantPagina\(|projectenLijst\(|projectPagina\(|redirect\('\/projecten'\)/);
    assert.ok(data > i, "data pas na de teamcheck");
  });
}
test("/agenda/projecten stuurt door naar /projecten", () => assert.match(lees("app/(app)/agenda/projecten/page.tsx"), /redirect\('\/projecten'\)/));
test("geen oude doorverwijzing /klanten → /facturen/klanten meer", () => assert.ok(!/source: '\/klanten/.test(lees("next.config.ts"))));
test("oude ProjectenApp is weg", () => assert.ok(!fs.existsSync(path.join(ROOT, "components/taken/ProjectenApp.tsx"))));
test("pagina's tonen 'nog niet ingericht' zonder 0022", () => {
  for (const f of PAGINAS.slice(0, 4)) assert.match(lees(f), /CrmNietIngericht/, f);
});

test("rail: één tab Klanten (/klanten + /projecten), 6 items", () => {
  const src = lees("lib/modules.ts");
  const ids = [...src.matchAll(/^\s{4}id: '([a-z]+)'/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ["dashboard", "mail", "agenda", "klanten", "boekhouding", "social"]);
  assert.match(src, /paden: \['\/klanten', '\/projecten'\]/);
  assert.match(lees("lib/shell/iconen.ts"), /klanten:/);
});

test("migratie 0022: klanten & projecten alleen toevoegend", () => {
  const sql = lees("supabase/migrations/0022_team_crm.sql");
  for (const s of [
    "add column if not exists email",
    "add column if not exists telefoon",
    "add column if not exists status text not null default 'actief'",
    "create table if not exists public.client_notes",
    "add column if not exists deadline date",
    "create table if not exists public.project_eigenaren",
    "check (status in ('gepland', 'bezig', 'afgerond'))",
  ])
    assert.ok(sql.includes(s), s);
  assert.ok(!/drop table|drop column|alter table public\.(invoices|quotes|invoice_counters)/i.test(sql), "raakt facturen niet");
});

test("facturen-klantpagina: alleen een link naar de klantpagina erbij", () => {
  const src = lees("app/(app)/facturen/klanten/[clientId]/page.tsx");
  assert.match(src, /href=\{`\/klanten\/\$\{klant\.id\}`\}/);
  assert.match(src, /ClientEditForm/);
});

console.log(`\ntest-crm: ${goed} geslaagd${fout ? `, ${fout} mislukt` : ""}`);
if (fout) process.exit(1);
