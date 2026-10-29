// Tests voor Klanten & projecten (0022, stap 3), zonder database en zonder netwerk:
//   - lib/crm/invoer.ts: klant aanmaken/wijzigen (bedrijfsnaam verplicht, status standaard
//     lead, e-mail/telefoon gecontroleerd), notities en de ilike-escape voor prijsopgaven;
//   - bronbewaking: elke nieuwe route en pagina gaat via de centrale teamcheck, klanten
//     verwijderen kan hier niet, de rail heeft één tab "Klanten" (8 items, met Bestanden en Scratchpad) en de
//     facturen-routes zijn niet aangeraakt.
//   - lib/crm/projectstatus.ts (0023): deadlinekleur, dagen in een status, afgerond in de
//     laatste 30 dagen, sorteren op deadline, buurstatus (Alt + ←/→);
//   - bord, stappenbalk, dashboardkaart en "afgeronde klant → nieuw project" (bron);
//   - lib/crm/opvolging.ts (0025): opvolgdatum (vandaag/te laat), sorteren, zoeken,
//     belangrijkste projectstatus; volgende stap/opvolgdatum in de invoer; migratie 0025,
//     UITVOEREN_0025.sql en dat de app vóór 0025 terugvalt (bron).
// De RLS van client_notes/project_eigenaren en de omzetting van de projectstatus (0022 en
// 0023) staan in scripts/test-rls.mjs (PGlite).
//
// Gebruik:  node scripts/test-crm.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let inv, ps, ov;
try {
  inv = await import(pathToFileURL(path.join(ROOT, "lib", "crm", "invoer.ts")).href);
  ps = await import(pathToFileURL(path.join(ROOT, "lib", "crm", "projectstatus.ts")).href);
  ov = await import(pathToFileURL(path.join(ROOT, "lib", "crm", "opvolging.ts")).href);
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
// Projectstatus (0023)
// ---------------------------------------------------------------------------------
test("bord: vier statussen in volgorde, met Nederlandse labels", () => {
  assert.deepEqual(ps.BORD_STATUSSEN, ["voorbereiding", "bezig", "wachten", "afgerond"]);
  assert.equal(ps.PROJECT_STATUS_LABEL.wachten, "Wachten op goedkeuring");
  assert.equal(ps.PROJECT_STATUS_KORT.wachten, "Wachten");
});
test("deadline: te laat, binnenkort (≤ 7 dagen), later, geen", () => {
  assert.equal(ps.deadlineStand("2026-10-22", "2026-10-23", "bezig"), "telaat");
  assert.equal(ps.deadlineStand("2026-10-23", "2026-10-23", "bezig"), "binnenkort");
  assert.equal(ps.deadlineStand("2026-10-30", "2026-10-23", "wachten"), "binnenkort");
  assert.equal(ps.deadlineStand("2026-10-31", "2026-10-23", "bezig"), "later");
  assert.equal(ps.deadlineStand(null, "2026-10-23", "bezig"), null);
});
test("deadline: afgerond is nooit te laat", () => assert.equal(ps.deadlineStand("2026-01-01", "2026-10-23", "afgerond"), "later"));
test("deadline: over de wintertijd heen (25 okt) blijft het hele dagen", () => assert.equal(ps.deadlineStand("2026-10-31", "2026-10-24", "bezig"), "binnenkort"));
test("dagen in status", () => {
  const nu = new Date("2026-10-23T10:00:00Z");
  assert.equal(ps.dagenSinds("2026-10-23T09:00:00Z", nu), 0);
  assert.equal(ps.dagenSinds("2026-10-11T10:00:00Z", nu), 12);
  assert.equal(ps.dagenSinds("2026-10-30T10:00:00Z", nu), 0, "toekomst telt als vandaag");
  assert.equal(ps.dagenSinds(null, nu), null);
  assert.equal(ps.dagenSinds("geen datum", nu), null);
  assert.equal(ps.dagenTekst(0), "vandaag");
  assert.equal(ps.dagenTekst(1), "1 dag");
  assert.equal(ps.dagenTekst(12), "12 dagen");
});
test("afgerond: laatste 30 dagen; zonder status_sinds (vóór 0023) wel tonen", () => {
  const nu = new Date("2026-10-23T10:00:00Z");
  assert.equal(ps.isRecentAfgerond("2026-09-23T11:00:00Z", nu), true);
  assert.equal(ps.isRecentAfgerond("2026-09-01T10:00:00Z", nu), false);
  assert.equal(ps.isRecentAfgerond(null, nu), true);
});
test("lijst: op deadline, zonder deadline achteraan, dan op naam", () => {
  const l = [
    { naam: "Zonder", deadline: null },
    { naam: "B", deadline: "2026-11-01" },
    { naam: "A", deadline: "2026-11-01" },
    { naam: "Eerst", deadline: "2026-10-01" },
  ].sort(ps.opDeadline);
  assert.deepEqual(l.map((p) => p.naam), ["Eerst", "A", "B", "Zonder"]);
});
test("Alt + ←/→: buurstatus, niet voorbij de rand", () => {
  assert.equal(ps.buurStatus("bezig", 1), "wachten");
  assert.equal(ps.buurStatus("bezig", -1), "voorbereiding");
  assert.equal(ps.buurStatus("voorbereiding", -1), null);
  assert.equal(ps.buurStatus("afgerond", 1), null);
});

test("migratie 0023: idempotent, alleen projects, RLS niet aangeraakt", () => {
  const sql = lees("supabase/migrations/0023_projectstatus.sql");
  for (const s of [
    "check (status in ('voorbereiding', 'bezig', 'wachten', 'afgerond'))",
    "update public.projects set status = 'voorbereiding' where status = 'gepland'",
    "alter column status set default 'voorbereiding'",
    "add column if not exists status_sinds timestamptz",
    "drop trigger if exists projects_status_sinds on public.projects",
    "create index if not exists projects_status_sinds_idx",
  ])
    assert.ok(sql.includes(s), s);
  const zonderCommentaar = sql.replace(/--[^\n]*/g, "");
  assert.ok(!/policy|grant |drop table|drop column|invoices|quotes|clients/i.test(zonderCommentaar), "geen policies, grants of andere tabellen");
  assert.ok(sql.indexOf("add column if not exists status_sinds") < sql.indexOf("set status = 'voorbereiding'"), "status_sinds vóór het omzetten gevuld");
});
test("migratie 0022: laat de status van 0023 staan bij opnieuw uitvoeren", () => {
  const sql = lees("supabase/migrations/0022_team_crm.sql");
  assert.match(sql, /na0023 boolean := exists \([\s\S]*?column_name = 'status_sinds'/);
  assert.match(sql, /if not na0023 then[\s\S]*?check \(status in \('gepland', 'bezig', 'afgerond'\)\)[\s\S]*?end if;/);
});
test("UITVOEREN_0023.sql: één transactie, controle per onderdeel, actueel", () => {
  const sql = lees("supabase/UITVOEREN_0023.sql");
  const tx = sql.slice(0, sql.lastIndexOf("-- Controle:"));
  assert.equal((tx.match(/^begin;$/gm) || []).length, 1);
  assert.equal((tx.match(/^commit;$/gm) || []).length, 1);
  for (const r of ["projectstatus voorbereiding/bezig/wachten/afgerond", "kolom projects.status_sinds", "trigger status_sinds", "RLS projects ongewijzigd (teamlid)", "indexen 0023"]) assert.ok(sql.includes(`('${r}'`), r);
  for (const f of ["UITVOEREN_IN_SQL_EDITOR.sql", "UITVOEREN_0020_UITGAVEN.sql", "UITVOEREN_0021_TEAM.sql"]) {
    const delen = [...lees(`supabase/${f}`).matchAll(/^-- (\d{4}_[\w]+\.sql)$/gm)].map((m) => m[1]);
    // Na 0023 volgen alleen nog 0024 (nieuwe Drive-tabellen met teamcheck), 0025 (kolommen) en
    // 0026 (inboxen, 2FA in is_teamlid, audit-log, back-ups).
    assert.deepEqual(delen.slice(-6), ["0021_team_en_taken.sql", "0022_team_crm.sql", "0023_projectstatus.sql", "0024_drive.sql", "0025_crm_opvolging.sql", "0026_beveiliging_mailboxen_backups.sql"], f);
  }
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/genereer-sql-editor.mjs"), "--controleer"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("API: status vóór 0023 opvangen (gepland i.p.v. voorbereiding) bij maken én wijzigen", () => {
  assert.match(lees("app/api/projecten/route.ts"), /metStatusTerugval<\{ id: string \}>\(p\.waarde/);
  assert.match(lees("app/api/projecten/[id]/route.ts"), /metStatusTerugval<\{ id: string \}>\(p\.waarde/);
  const repo = lees("lib/agenda/repo.ts");
  assert.match(repo, /projects_status_check/);
  assert.match(repo, /PROJECT_KOLOMMEN_0023 = `\$\{PROJECT_KOLOMMEN\},status_sinds`/);
});
test("nieuw project bij een afgeronde klant: alleen afgerond → actief", () => {
  const src = lees("app/api/projecten/route.ts");
  assert.match(src, /\.update\(\{ status: 'actief' \}\)\s*\.eq\('id', p\.waarde\.client_id\)\s*\.eq\('status', 'afgerond'\)/);
  assert.match(lees("components/crm/KlantInhoud.tsx"), /klant\.status === 'afgerond' &&[\s\S]*?<NieuwProject[^>]*klantAfgerond/);
  assert.match(lees("app/(app)/klanten/[id]/page.tsx"), /<KlantInhoud /);
});
test("klantenoverzicht: tabs Leads/Actief/Afgerond, zoeken over alle tabs, snel toevoegen", () => {
  const src = lees("components/crm/KlantenLijst.tsx");
  assert.match(src, /const TABS: KlantStatus\[\] = \['lead', 'actief', 'afgerond'\]/);
  assert.match(src, /klanten\.filter\(\(k\) => klantPast\(k, q\)\)/, "zoeken telt over alle tabs (afgerond blijft vindbaar)");
  assert.match(src, /Wel in/, "lege zoekstaat wijst naar de andere tab");
  assert.match(src, /crmApi<\{ klant: \{ id: string \} \}>\('\/api\/klanten', 'POST', \{ naam, status \}\)/);
  assert.match(src, /e\.key === '\/'/);
  assert.match(lees("app/(app)/klanten/page.tsx"), /taakSneltoets=\{false\}/, "n = nieuwe klant, niet nieuwe taak");
  assert.ok(!fs.existsSync(path.join(ROOT, "components/crm/SnelKlant.tsx")), "geen popup meer voor een nieuwe klant");
});
test("leads: gewonnen (→ actief, optioneel project) en afgewezen (→ afgerond, ongedaan maken)", () => {
  const src = lees("components/crm/KlantActies.tsx");
  assert.match(src, /status: 'actief'/);
  assert.match(src, /agendaApi\.maakProject\(\{ naam, klantId: klant\.id/);
  assert.match(src, /status: 'afgerond', \.\.\.\(opvolging \? \{ opvolgenOp: null \} : \{\}\)/, "vóór 0025 geen opvolgdatum meesturen");
  assert.match(src, /Ongedaan maken/);
});
test("bord: slepen, keuzelijst en Alt+pijl; weergave en filter onthouden", () => {
  const src = lees("components/crm/ProjectenBord.tsx");
  for (const s of ["onDragStart", "onDrop", "aria-label={`Status van ${project.naam}`}", "e.altKey", "localStorage.setItem", "Alleen mijn projecten", "isRecentAfgerond", "id={`kolom-${status}`}"]) assert.ok(src.includes(s), s);
});
test("projectpagina: stappenbalk met sinds wanneer", () => {
  assert.match(lees("app/(app)/projecten/[id]/page.tsx"), /<ProjectInhoud /);
  assert.match(lees("components/crm/ProjectInhoud.tsx"), /<StatusStappen/);
  assert.match(lees("components/crm/StatusStappen.tsx"), /aria-current=\{i === huidig \? 'step' : undefined\}/);
  assert.ok(!/<option value="gepland">/.test(lees("components/crm/ProjectKop.tsx")), "geen oude statuskeuze meer");
});
test("dashboard: kaart Projecten via de teamcheck van het dashboard, links naar het bord", () => {
  const dash = lees("app/(app)/page.tsx");
  assert.ok(dash.indexOf("vereisTeamlidPagina(") < dash.indexOf("<ProjectenWidget lid={lid} />"));
  const w = lees("components/dashboard/ProjectenWidget.tsx");
  assert.match(w, /projectTellers\(bronVan\(lid\)/);
  assert.match(w, /href=\{`\/projecten\?weergave=bord#kolom-\$\{s\}`\}/);
  assert.ok(!/createServiceRoleClient|service_role/.test(w));
});

// ---------------------------------------------------------------------------------
// Opvolgen (0025)
// ---------------------------------------------------------------------------------
test("opvolgStand: te laat, vandaag, binnenkort, later", () => {
  assert.equal(ov.opvolgStand("2026-10-23", "2026-10-24"), "telaat");
  assert.equal(ov.opvolgStand("2026-10-24", "2026-10-24"), "vandaag");
  assert.equal(ov.opvolgStand("2026-10-31", "2026-10-24"), "binnenkort");
  assert.equal(ov.opvolgStand("2026-11-01", "2026-10-24"), "later");
  assert.equal(ov.opvolgStand(null, "2026-10-24"), null);
  // Over de wintertijd (25 okt) en de jaargrens heen: hele kalenderdagen.
  assert.equal(ov.opvolgStand("2026-10-26", "2026-10-25"), "binnenkort");
  assert.equal(ov.opvolgTekst("2027-01-02", "2026-12-31"), "over 2 dagen");
});
test("opvolgTekst: kort en Nederlands", () => {
  assert.equal(ov.opvolgTekst("2026-10-24", "2026-10-24"), "vandaag");
  assert.equal(ov.opvolgTekst("2026-10-25", "2026-10-24"), "morgen");
  assert.equal(ov.opvolgTekst("2026-10-23", "2026-10-24"), "gisteren");
  assert.equal(ov.opvolgTekst("2026-10-21", "2026-10-24"), "3 dagen te laat");
  assert.equal(ov.opvolgTekst("2026-11-12", "2026-10-24"), "12 nov");
  assert.equal(ov.opvolgTekst("2027-02-01", "2026-10-24"), "1 feb 2027");
});
test("geledenKort: laatste contact", () => {
  const nu = new Date("2026-10-24T12:00:00Z");
  assert.equal(ov.geledenKort(null, nu), "—");
  assert.equal(ov.geledenKort("2026-10-24T08:00:00Z", nu), "vandaag");
  assert.equal(ov.geledenKort("2026-10-23T08:00:00Z", nu), "gisteren");
  assert.equal(ov.geledenKort("2026-10-19T08:00:00Z", nu), "5 d");
  assert.equal(ov.geledenKort("2026-09-20T08:00:00Z", nu), "4 wk");
  assert.equal(ov.geledenKort("2026-06-01T08:00:00Z", nu), "4 mnd");
});
test("sorteren: opvolgdatum (zonder datum achteraan), omzet, laatst actief, naam", () => {
  const r = (naam, x = {}) => ({ naam, contactpersoon: "", email: "", telefoon: "", volgendeStap: "", opvolgenOp: null, omzet: 0, laatstActief: "", ...x });
  const lijst = [r("Bèta", { opvolgenOp: "2026-11-01", omzet: 5, laatstActief: "2026-10-01" }), r("Alfa"), r("Gamma", { opvolgenOp: "2026-10-20", omzet: 9, laatstActief: "2026-10-20" })];
  assert.deepEqual(ov.sorteerKlanten(lijst, "opvolgen").map((k) => k.naam), ["Gamma", "Bèta", "Alfa"]);
  assert.deepEqual(ov.sorteerKlanten(lijst, "omzet").map((k) => k.naam), ["Gamma", "Bèta", "Alfa"]);
  assert.deepEqual(ov.sorteerKlanten(lijst, "actief").map((k) => k.naam), ["Gamma", "Bèta", "Alfa"]);
  assert.deepEqual(ov.sorteerKlanten(lijst, "naam").map((k) => k.naam), ["Alfa", "Bèta", "Gamma"]);
  assert.equal(lijst[0].naam, "Bèta", "sorteren laat de invoer staan");
});
test("zoeken: naam, contact, e-mail, telefoon en volgende stap", () => {
  const k = { naam: "Atelier Mos", contactpersoon: "Mila", email: "mila@mos.nl", telefoon: "06 123", volgendeStap: "Offerte nabellen" };
  for (const z of ["atelier", "MILA", "mos.nl", "06 1", "nabellen", "  "]) assert.ok(ov.klantPast(k, z), z);
  assert.ok(!ov.klantPast(k, "bakker"));
});
test("belangrijkste projectstatus: wachten > bezig > voorbereiding", () => {
  assert.equal(ov.belangrijksteStatus(["voorbereiding", "wachten", "bezig"]), "wachten");
  assert.equal(ov.belangrijksteStatus(["voorbereiding", "bezig"]), "bezig");
  assert.equal(ov.belangrijksteStatus(["afgerond"]), null);
  assert.equal(ov.belangrijksteStatus([]), null);
});
test("dashboard Opvolgen: alleen niet-afgerond, vandaag of eerder", () => {
  assert.ok(ov.moetOpvolgen({ status: "lead", opvolgenOp: "2026-10-24" }, "2026-10-24"));
  assert.ok(ov.moetOpvolgen({ status: "actief", opvolgenOp: "2026-10-01" }, "2026-10-24"));
  assert.ok(!ov.moetOpvolgen({ status: "lead", opvolgenOp: "2026-10-25" }, "2026-10-24"));
  assert.ok(!ov.moetOpvolgen({ status: "afgerond", opvolgenOp: "2026-10-01" }, "2026-10-24"));
  assert.ok(!ov.moetOpvolgen({ status: "lead", opvolgenOp: null }, "2026-10-24"));
});
test("invoer: volgende stap (max. 200, leeg → null) en opvolgdatum (echte datum of leeg)", () => {
  assert.deepEqual(inv.parseKlant({ volgendeStap: "  Offerte   nabellen " }, false).waarde, { volgende_stap: "Offerte nabellen" });
  assert.deepEqual(inv.parseKlant({ volgendeStap: "" }, false).waarde, { volgende_stap: null });
  assert.equal(inv.parseKlant({ volgendeStap: "x".repeat(201) }, false).ok, false);
  assert.deepEqual(inv.parseKlant({ opvolgenOp: "2026-11-02" }, false).waarde, { opvolgen_op: "2026-11-02" });
  assert.deepEqual(inv.parseKlant({ opvolgenOp: null }, false).waarde, { opvolgen_op: null });
  assert.deepEqual(inv.parseKlant({ opvolgenOp: "" }, false).waarde, { opvolgen_op: null });
  for (const d of ["2026-02-30", "26-11-02", "morgen", 20261102]) assert.equal(inv.parseKlant({ opvolgenOp: d }, false).ok, false, String(d));
  assert.deepEqual([...inv.OPVOLG_KOLOMMEN], ["volgende_stap", "opvolgen_op"]);
});
test("migratie 0025: idempotent, alleen toevoegen, RLS en facturen niet aangeraakt", () => {
  const sql = lees("supabase/migrations/0025_crm_opvolging.sql");
  for (const s of [
    "add column if not exists volgende_stap text",
    "add column if not exists opvolgen_op date",
    "add column if not exists soort text not null default 'notitie'",
    "check (soort in ('notitie', 'status'))",
    "create index if not exists clients_opvolgen_idx",
  ])
    assert.ok(sql.includes(s), s);
  const zonder = sql.replace(/--[^\n]*/g, "");
  assert.ok(!/policy|grant |revoke |drop table|drop column|invoices|quotes|update public\./i.test(zonder), "geen policies, grants, facturen of datawijzigingen");
});
test("UITVOEREN_0025.sql: één transactie, controle per onderdeel, actueel", () => {
  const sql = lees("supabase/UITVOEREN_0025.sql");
  const tx = sql.slice(0, sql.lastIndexOf("-- Controle:"));
  assert.equal((tx.match(/^begin;$/gm) || []).length, 1);
  assert.equal((tx.match(/^commit;$/gm) || []).length, 1);
  for (const r of ["kolommen clients.volgende_stap en opvolgen_op", "kolom client_notes.soort", "index opvolgen", "RLS clients en client_notes ongewijzigd (teamlid)"]) assert.ok(sql.includes(`('${r}'`), r);
});
test("vóór 0025: queries vallen terug, opslaan geeft een nette melding, dashboardkaart verdwijnt", () => {
  const repo = lees("lib/crm/repo.ts");
  assert.match(repo, /metTerugval<KlantDbRij\[\]>[\s\S]*?created_at' \+ OPVOLG, 'id,company_name,contact_name,email,telefoon,status,created_at'\]/);
  assert.match(repo, /\['id,tekst,created_by,created_at,soort', 'id,tekst,created_by,created_at'\]/);
  assert.match(repo, /return \{ klanten, opvolging: k\.set === 0 \}/);
  assert.match(repo, /if \(kolomOntbreekt\(error\)\) return null;/, "opvolgLijst: null vóór 0025");
  const api = lees("app/api/klanten/[id]/route.ts");
  assert.match(api, /OPVOLG_KOLOMMEN\.some\(\(c\) => c in k\.waarde\)\) return fout\(503, OPVOLGEN_NA_0025, 'kolom_ontbreekt'\)/);
  assert.match(api, /soort: 'status'/);
  assert.match(api, /if \(e2 && !kolomOntbreekt\(e2\)\)/, "statusregel vóór 0025 overslaan");
  const w = lees("components/dashboard/OpvolgenWidget.tsx");
  assert.match(w, /if \(!lijst \|\| lijst\.length === 0\) return null;/);
  assert.ok(!/createServiceRoleClient|service_role/.test(w));
  assert.match(lees("app/(app)/page.tsx"), /<OpvolgenWidget lid=\{lid\} \/>/);
});
test("facturen alleen gelezen in klanten & projecten", () => {
  for (const f of ["lib/crm/repo.ts", "components/crm/KlantInhoud.tsx", "app/api/klanten/[id]/route.ts", "app/api/klanten/route.ts"]) {
    const src = lees(f);
    assert.ok(!/from\('(invoices|quotes)'\)\s*\.(insert|update|upsert|delete)\(/.test(src), f);
  }
});

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

test("rail: één tab Klanten (/klanten + /projecten), 8 items (met Bestanden en Scratchpad)", () => {
  const src = lees("lib/modules.ts");
  const ids = [...src.matchAll(/^\s{4}id: '([a-z]+)'/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ["dashboard", "mail", "agenda", "scratchpad", "klanten", "bestanden", "boekhouding", "social"]);
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
