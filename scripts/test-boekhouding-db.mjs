// Test van migratie 0027 (boekhouding) op een lokale Postgres (PGlite, in het geheugen), met
// hetzelfde nagebootste Supabase-fundament als scripts/test-rls.mjs (rollen anon/authenticated/
// service_role, auth.uid()/auth.jwt(), mfa_factors, storage). Er wordt niets tegen Supabase
// uitgevoerd en niets naar het netwerk gestuurd.
//
//   0001–0026 los (zoals Supabase nu) → vóór 0027: bk_instellingen ontbreekt (42P01, de app
//   kiest dan de demo-modus) → UITVOEREN_0027.sql (3x): elke controleregel "ok", seed één keer,
//   aanpassingen blijven staan →
//   - RLS: teamleden lezen/schrijven, buitenstaanders en anon niets; 2FA (aal1 met factor) niets;
//   - boekingsregels: niet te verwijderen (bewaarplicht), wel te markeren; jaar/kwartaal
//     automatisch; checks op soort/btw/privé;
//   - vergrendeling: een ingediende aangifte weigert nieuwe/gewijzigde/verwijderde regels in dat
//     kwartaal (fout 'periode_vergrendeld:'), notities mogen; intrekken alleen de eigenaar;
//     service-role (herstel) mag wel;
//   - memoriaal moet sluiten; grootboek: systeemrekeningen niet te verwijderen;
//   - rekening toevoegen (eigen 11xx-rekening) en standaardrekening wisselen;
//   - backup_tabellen() bevat alle bk-tabellen; de grote SQL-bestanden opnieuw blijven "ok";
//   - stap 2: koppelingen (factuur ↔ inkomst, bonnetje ↔ uitgave; soort moet passen; in een
//     vergrendeld kwartaal alleen bij regels zonder btw), verfijning van facturen/bonnetjes
//     alleen in een open periode, bk_importeer: in één transactie, dubbele sleutels overgeslagen
//     (2e keer 0 nieuw), alleen voor teamleden.
//
// Gebruik:  node scripts/test-boekhouding-db.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let PGlite, pgcrypto;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto"));
} catch {
  console.error("@electric-sql/pglite ontbreekt: draai eerst npm install (devDependency).");
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MIGRATIES = fs.readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

// Het nagebootste Supabase-fundament uit test-rls.mjs (één bron).
const rls = lees("scripts/test-rls.mjs");
const SUPABASE_BASIS = rls.slice(rls.indexOf("const SUPABASE_BASIS = `") + "const SUPABASE_BASIS = `".length, rls.indexOf("`;", rls.indexOf("const SUPABASE_BASIS = `")));

let goed = 0;
let fouten = 0;
function check(ok, label, detail = "") {
  if (ok) goed++;
  else {
    fouten++;
    console.log(`  FOUT  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

const U = {
  daniel: "11111111-1111-4111-8111-111111111111",
  bram: "22222222-2222-4222-8222-222222222222",
  indringer: "55555555-5555-4555-8555-555555555555",
};

async function voerUit(db, sql, label) {
  try {
    return await db.exec(sql);
  } catch (e) {
    throw new Error(`${label}: ${e.message}`);
  }
}
function controleRijen(res) {
  return res[res.length - 1]?.rows ?? [];
}
function checkControle(res, label) {
  const rijen = controleRijen(res);
  check(rijen.length > 0, `${label}: controletabel aanwezig`);
  const mis = rijen.filter((r) => !["ok", "actief", "gedeactiveerd"].includes(r.status));
  check(mis.length === 0, `${label}: elke controleregel ok`, mis.map((r) => `${r.onderdeel}=${r.status}`).join(", "));
  return rijen;
}

// Een reeks statements als een rol, in één transactie die altijd wordt teruggedraaid;
// `commit: true` laat hem staan. `immediate` controleert uitgestelde constraints vóór het einde.
async function als(db, wie, sqls, { commit = false, aal = null, immediate = false } = {}) {
  const lijst = Array.isArray(sqls) ? sqls : [sqls];
  await db.exec("begin");
  try {
    if (wie === "anon") await db.exec("set local role anon");
    else if (wie === "service") await db.exec("set local role service_role");
    else {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[wie], role: "authenticated", aal: aal ?? "aal1" })]);
      await db.exec("set local role authenticated");
    }
    let r;
    for (const s of lijst) r = typeof s === "string" ? await db.query(s) : await db.query(s[0], s[1]);
    if (immediate) await db.exec("set constraints all immediate");
    await db.exec(commit ? "commit" : "rollback");
    return { ok: true, rows: r.rows, n: r.affectedRows ?? 0 };
  } catch (e) {
    await db.exec("rollback");
    return { ok: false, code: e.code, msg: e.message };
  }
}
const geweigerd = (r) => !r.ok && r.code === "42501";
const leeg = (r) => (r.ok && r.rows.length === 0) || geweigerd(r);
const uitleg = (r) => (r.ok ? `${r.rows?.length ?? 0} rijen / ${r.n} geraakt` : `${r.code}: ${r.msg}`);
const vergrendeld = (r) => !r.ok && /periode_vergrendeld:/.test(r.msg || "");

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(SUPABASE_BASIS);
for (const f of MIGRATIES.filter((f) => f < "0021")) await voerUit(db, lees(`supabase/migrations/${f}`), f);
await db.query(
  `insert into auth.users (id, email, created_at, email_confirmed_at, last_sign_in_at) values
     ($1, 'daniel@studio-levant.nl', now() - interval '300 days', now() - interval '300 days', now()),
     ($2, 'bram@studio-levant.nl', now() - interval '10 days', now() - interval '10 days', now()),
     ($3, 'indringer@example.com', now() - interval '5 days', now(), now())`,
  [U.daniel, U.bram, U.indringer],
);
for (const f of MIGRATIES.filter((f) => f >= "0021" && f < "0027")) await voerUit(db, lees(`supabase/migrations/${f}`), f);
await db.query("insert into public.profiles (id, naam, initialen, email) values ($1, 'Bram', 'B', 'bram@studio-levant.nl') on conflict (id) do nothing", [U.bram]);
await db.query("insert into public.team_members (user_id, actief, rol) values ($1, true, 'lid') on conflict (user_id) do nothing", [U.bram]);
const rol = (await db.query("select rol from public.team_members where user_id = $1", [U.daniel])).rows[0]?.rol;
check(rol === "eigenaar", "Daniel is eigenaar (0021)", String(rol));

// ---- vóór 0027 ----
{
  const r = await als(db, "bram", "select id from public.bk_instellingen limit 1");
  check(!r.ok && r.code === "42P01", "vóór 0027: bk_instellingen ontbreekt (42P01 → demo-modus)", uitleg(r));
}

// ---- UITVOEREN_0027.sql ----
const sql27 = lees("supabase/UITVOEREN_0027.sql");
check((sql27.match(/^begin;$/gm) || []).length === 1 && (sql27.match(/^commit;$/gm) || []).length === 1, "UITVOEREN_0027.sql: één transactie");
const delen = [...sql27.matchAll(/^-- (\d{4}_[\w]+\.sql)$/gm)].map((m) => m[1]);
check(delen.join(",") === "0027_boekhouding.sql", "UITVOEREN_0027.sql bevat alleen 0027", delen.join(","));
const r1 = checkControle(await voerUit(db, sql27, "UITVOEREN_0027 (1)"), "0027 (1e keer)");
const r2 = checkControle(await voerUit(db, sql27, "UITVOEREN_0027 (2)"), "0027 (2e keer)");
check(r1.length === r2.length && r1.length >= 15, "0027: zelfde controletabel bij opnieuw uitvoeren", `${r1.length}/${r2.length}`);

{
  const gb = (await db.query("select count(*)::int as n from public.bk_grootboek")).rows[0].n;
  check(gb === 38, "seed: 38 grootboekrekeningen (één keer)", String(gb));
  const rek = (await db.query("select naam, grootboek_code, standaard from public.bk_rekeningen order by volgorde")).rows;
  check(rek.length === 2 && rek[0].naam === "RegioBank" && rek[0].standaard && rek[1].naam === "Revolut" && !rek[1].standaard, "seed: RegioBank (standaard) en Revolut", JSON.stringify(rek));
  const ven = (await db.query("select naam, winstaandeel::text as a from public.bk_vennoten order by naam")).rows;
  check(ven.map((v) => `${v.naam}:${v.a}`).join(",") === "Bram:50.00,Daniel:50.00", "seed: vennoten Daniel en Bram 50/50", JSON.stringify(ven));
  const bt = (await db.query("select t from public.backup_tabellen() t where t like 'bk\\_%'")).rows.length;
  check(bt === 13, "backup_tabellen() bevat alle 13 bk-tabellen", String(bt));
  // Gelijk aan het standaardgrootboek in lib/boekhouding/kern/constanten.ts
  const kern = lees("lib/boekhouding/kern/constanten.ts");
  const codesKern = [...kern.matchAll(/\{ code: '(\d{4})', naam: '([^']+)', soort: '(\w+)'/g)].map((m) => `${m[1]}|${m[2]}|${m[3]}`);
  const codesDb = (await db.query("select code || '|' || naam || '|' || soort as k from public.bk_grootboek order by code")).rows.map((r) => r.k);
  check(codesKern.length === 38 && codesKern.join(",") === codesDb.join(","), "grootboek in de migratie = STANDAARD_GROOTBOEK in de kern", codesKern.filter((c) => !codesDb.includes(c)).concat(codesDb.filter((c) => !codesKern.includes(c))).join(", "));
}

// ---- RLS ----
const BK = (await db.query("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'bk\\_%' order by 1")).rows.map((r) => r.relname);
check(BK.length === 13, "13 bk-tabellen", BK.join(","));
for (const t of BK) {
  for (const wie of ["indringer", "anon"]) {
    const s = await als(db, wie, `select * from public.${t}`);
    check(leeg(s), `${wie}: leest niets uit ${t}`, uitleg(s));
    const u = await als(db, wie, `update public.${t} set created_at = created_at`);
    check(!u.ok ? geweigerd(u) || /column/.test(u.msg) : u.n === 0, `${wie}: wijzigt niets in ${t}`, uitleg(u));
    const d = await als(db, wie, `delete from public.${t}`);
    check(geweigerd(d) || (d.ok && d.n === 0), `${wie}: verwijdert niets uit ${t}`, uitleg(d));
  }
  const s = await als(db, "bram", `select count(*)::int as n from public.${t}`);
  check(s.ok, `lid leest ${t}`, uitleg(s));
}
const REK = (await db.query("select id from public.bk_rekeningen where grootboek_code = '1100'")).rows[0].id;
const VEN = (await db.query("select id from public.bk_vennoten where naam = 'Bram'")).rows[0].id;
{
  const ins = await als(db, "indringer", [[`insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen) values ($1, '2026-05-01', 'x', 'uitgave', 'af', 100)`, [REK]]]);
  check(geweigerd(ins), "buitenstaander voegt geen boeking toe", uitleg(ins));
  const anon = await als(db, "anon", [[`insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen) values ($1, '2026-05-01', 'x', 'uitgave', 'af', 100)`, [REK]]]);
  check(geweigerd(anon), "anon voegt geen boeking toe", uitleg(anon));
}

// ---- boekingsregels ----
const nieuw = (datum, extra = "") =>
  `insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen, btw_code, btw_centen, grootboek_code${extra ? ", " + extra.split("=")[0] : ""})
   values ('${REK}', '${datum}', 'Adobe', 'uitgave', 'af', 7139, 'eu_dienst', 1499, '4000'${extra ? ", " + extra.split("=")[1] : ""}) returning id, jaar, kwartaal, created_by, updated_by`;
let B1;
{
  const r = await als(db, "bram", nieuw("2026-02-10"), { commit: true });
  check(r.ok && r.rows[0].jaar === 2026 && r.rows[0].kwartaal === 1 && r.rows[0].created_by === U.bram, "lid boekt een regel; jaar/kwartaal automatisch; created_by", uitleg(r) + JSON.stringify(r.rows?.[0]));
  B1 = r.rows?.[0]?.id;
  const q4 = await als(db, "bram", nieuw("2025-12-31"));
  check(q4.ok && q4.rows[0].kwartaal === 4 && q4.rows[0].jaar === 2025, "31-12 → Q4 van dat jaar", uitleg(q4));
  const del = await als(db, "bram", [[`delete from public.bk_boekingen where id = $1`, [B1]]]);
  check(del.ok && del.n === 0, "boekingsregel niet echt te verwijderen (bewaarplicht)", uitleg(del));
  const del2 = await als(db, "daniel", [[`delete from public.bk_boekingen where id = $1`, [B1]]]);
  check(del2.ok && del2.n === 0, "ook de eigenaar verwijdert niets echt", uitleg(del2));
  const zacht = await als(db, "daniel", [[`update public.bk_boekingen set verwijderd_op = now(), verwijderd_door = auth.uid(), verwijder_reden = 'dubbel' where id = $1 returning updated_by`, [B1]]]);
  check(zacht.ok && zacht.n === 1 && zacht.rows[0].updated_by === U.daniel, "markeren als verwijderd kan (met reden); updated_by", uitleg(zacht));
  const zonderReden = await als(db, "daniel", [[`update public.bk_boekingen set verwijderd_op = now() where id = $1`, [B1]]]);
  check(!zonderReden.ok && zonderReden.code === "23514", "verwijderen zonder reden geweigerd", uitleg(zonderReden));
  const prive = await als(db, "bram", `insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen, btw_code) values ('${REK}', '2026-05-01', 'Opname', 'prive', 'af', 150000, 'geen')`);
  check(!prive.ok && prive.code === "23514", "privé zonder vennoot geweigerd", uitleg(prive));
  const prive2 = await als(db, "bram", `insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen, btw_code, vennoot_id) values ('${REK}', '2026-05-01', 'Opname', 'prive', 'af', 150000, '21', '${VEN}')`);
  check(!prive2.ok && prive2.code === "23514", "privé met btw geweigerd", uitleg(prive2));
  const prive3 = await als(db, "bram", `insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen, btw_code, vennoot_id) values ('${REK}', '2026-05-01', 'Opname', 'prive', 'af', 150000, 'geen', '${VEN}')`);
  check(prive3.ok, "privé met vennoot en zonder btw kan", uitleg(prive3));
  const nul = await als(db, "bram", `insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen) values ('${REK}', '2026-05-01', 'x', 'uitgave', 'af', 0)`);
  check(!nul.ok && nul.code === "23514", "bedrag 0 geweigerd", uitleg(nul));
  const code = await als(db, "bram", `insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen, btw_code) values ('${REK}', '2026-05-01', 'x', 'uitgave', 'af', 100, '19')`);
  check(!code.ok && code.code === "23514", "onbekende btw-code geweigerd", uitleg(code));
  // Terug zetten (niet verwijderd) voor de vergrendeltest.
  await db.query("update public.bk_boekingen set verwijderd_op = null, verwijderd_door = null, verwijder_reden = null where id = $1", [B1]);
}

// ---- vergrendeling ----
{
  const ind = await als(db, "bram", "insert into public.bk_aangiften (jaar, kwartaal, te_betalen_centen) values (2026, 1, 0) returning ingediend_door", { commit: true });
  check(ind.ok && ind.rows[0].ingediend_door === U.bram, "lid dient de aangifte Q1 2026 in", uitleg(ind));
  check(vergrendeld(await als(db, "bram", nieuw("2026-03-31"))), "nieuwe regel in Q1 geweigerd (periode_vergrendeld)");
  check((await als(db, "bram", nieuw("2026-04-01"))).ok, "nieuwe regel in Q2 kan");
  check(vergrendeld(await als(db, "bram", [[`update public.bk_boekingen set bedrag_centen = 8000 where id = $1`, [B1]]])), "bedrag wijzigen in Q1 geweigerd");
  check(vergrendeld(await als(db, "bram", [[`update public.bk_boekingen set datum = '2026-04-02' where id = $1`, [B1]]])), "regel uit Q1 naar Q2 verplaatsen geweigerd");
  check(vergrendeld(await als(db, "bram", [[`update public.bk_boekingen set btw_code = '21' where id = $1`, [B1]]])), "btw wijzigen in Q1 geweigerd");
  check(vergrendeld(await als(db, "bram", [[`update public.bk_boekingen set verwijderd_op = now(), verwijder_reden = 'x' where id = $1`, [B1]]])), "verwijderen in Q1 geweigerd");
  const notitie = await als(db, "bram", [[`update public.bk_boekingen set notities = 'gecontroleerd', status = 'geboekt', omschrijving = 'Adobe CC' where id = $1`, [B1]]]);
  check(notitie.ok && notitie.n === 1, "notities/status/omschrijving in Q1 mogen", uitleg(notitie));
  const herstel = await als(db, "service", nieuw("2026-02-11"));
  check(herstel.ok, "service-role (herstel uit back-up) mag in een vergrendelde periode", uitleg(herstel));
  const intrekLid = await als(db, "bram", "delete from public.bk_aangiften where jaar = 2026 and kwartaal = 1");
  check(intrekLid.ok && intrekLid.n === 0, "lid kan de aangifte niet intrekken", uitleg(intrekLid));
  const intrek = await als(db, "daniel", "delete from public.bk_aangiften where jaar = 2026 and kwartaal = 1", { commit: true });
  check(intrek.ok && intrek.n === 1, "eigenaar trekt de aangifte in", uitleg(intrek));
  check((await als(db, "bram", nieuw("2026-03-31"))).ok, "daarna is Q1 weer open");
  // Boekjaar afgesloten
  await db.exec("insert into public.bk_boekjaren (jaar) values (2025)");
  check(vergrendeld(await als(db, "bram", nieuw("2025-07-01"))), "afgesloten boekjaar 2025: nieuwe regel geweigerd");
  const intrekJaar = await als(db, "bram", "delete from public.bk_boekjaren where jaar = 2025");
  check(intrekJaar.ok && intrekJaar.n === 0, "lid opent een afgesloten boekjaar niet", uitleg(intrekJaar));
  await db.exec("delete from public.bk_boekjaren where jaar = 2025");
}

// ---- memoriaal ----
{
  const scheef = await als(
    db,
    "bram",
    [
      "insert into public.bk_memoriaal (id, datum, omschrijving, soort) values ('aaaaaaaa-0000-4000-8000-0000000000a1', '2026-01-01', 'Beginbalans', 'beginbalans')",
      "insert into public.bk_memoriaal_regels (memoriaal_id, grootboek_code, debet_centen) values ('aaaaaaaa-0000-4000-8000-0000000000a1', '1100', 100000)",
      "insert into public.bk_memoriaal_regels (memoriaal_id, grootboek_code, credit_centen) values ('aaaaaaaa-0000-4000-8000-0000000000a1', '0900', 99999)",
    ],
    { immediate: true },
  );
  check(!scheef.ok && /memoriaal_sluit_niet/.test(scheef.msg || ""), "memoriaal dat niet sluit geweigerd", uitleg(scheef));
  const recht = await als(
    db,
    "bram",
    [
      "insert into public.bk_memoriaal (id, datum, omschrijving, soort) values ('aaaaaaaa-0000-4000-8000-0000000000a2', '2026-01-01', 'Beginbalans', 'beginbalans')",
      "insert into public.bk_memoriaal_regels (memoriaal_id, grootboek_code, debet_centen) values ('aaaaaaaa-0000-4000-8000-0000000000a2', '1100', 100000)",
      "insert into public.bk_memoriaal_regels (memoriaal_id, grootboek_code, credit_centen) values ('aaaaaaaa-0000-4000-8000-0000000000a2', '0900', 100000)",
    ],
    { immediate: true },
  );
  check(recht.ok, "sluitend memoriaal kan", uitleg(recht));
  const tweeKanten = await als(db, "bram", [
    "insert into public.bk_memoriaal (id, datum, omschrijving) values ('aaaaaaaa-0000-4000-8000-0000000000a3', '2026-01-01', 'x')",
    "insert into public.bk_memoriaal_regels (memoriaal_id, grootboek_code, debet_centen, credit_centen) values ('aaaaaaaa-0000-4000-8000-0000000000a3', '1100', 5, 5)",
  ]);
  check(!tweeKanten.ok && tweeKanten.code === "23514", "memoriaalregel met debet én credit geweigerd", uitleg(tweeKanten));
}


// ---- koppelingen, verfijning en import (stap 2) ----
{
  await db.query("insert into public.clients (id, company_name) values ('cccccccc-0000-4000-8000-000000000001', 'Hotel Zeezicht') on conflict do nothing");
  await db.query(`insert into public.invoices (id, invoice_number, year, sequence_number, client_id, client_company_name, line_items, subtotal, vat_amount, total, revenue_subtotal, issued_at)
                  values ('ffffffff-0000-4000-8000-000000000001', '2026-901', 2026, 901, 'cccccccc-0000-4000-8000-000000000001', 'Hotel Zeezicht', '[]', 3000, 630, 3630, 3000, '2026-05-10T10:00:00Z'),
                         ('ffffffff-0000-4000-8000-000000000002', '2026-902', 2026, 902, 'cccccccc-0000-4000-8000-000000000001', 'Hotel Zeezicht', '[]', 1000, 210, 1210, 1000, '2026-02-10T10:00:00Z')`);
  await db.query(`insert into public.expenses (id, expense_date, supplier, total_amount, vat_amount, vat_rate, status) values ('eeeeeeee-0000-4000-8000-000000000001', '2026-05-12', 'Coolblue', 349, 60.57, '21', 'verwerkt')`);
  const ink = await als(db, "bram", `insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen, btw_code, btw_centen, grootboek_code) values ('${REK}', '2026-05-20', 'Betaling 2026-901', 'inkomst', 'bij', 363000, '21', 63000, '8000') returning id`, { commit: true });
  const uit = await als(db, "bram", `insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen, btw_code, btw_centen, grootboek_code) values ('${REK}', '2026-05-13', 'Coolblue', 'uitgave', 'af', 34900, '21', 6057, '4010') returning id`, { commit: true });
  const INK = ink.rows?.[0]?.id;
  const UIT = uit.rows?.[0]?.id;
  check(INK && UIT, "boekingen voor de koppeltest", uitleg(ink) + uitleg(uit));
  const k1 = await als(db, "bram", `insert into public.bk_koppelingen (boeking_id, bron, bron_id, bedrag_centen) values ('${INK}', 'factuur', 'ffffffff-0000-4000-8000-000000000001', 363000) returning id`, { commit: true });
  check(k1.ok, "lid koppelt een inkomst aan een factuur", uitleg(k1));
  const fout1 = await als(db, "bram", `insert into public.bk_koppelingen (boeking_id, bron, bron_id, bedrag_centen) values ('${UIT}', 'factuur', 'ffffffff-0000-4000-8000-000000000002', 1210)`);
  check(!fout1.ok && /koppeling_ongeldig/.test(fout1.msg || ""), "factuur aan een uitgave koppelen geweigerd", uitleg(fout1));
  const k2 = await als(db, "bram", `insert into public.bk_koppelingen (boeking_id, bron, bron_id, bedrag_centen) values ('${UIT}', 'uitgave', 'eeeeeeee-0000-4000-8000-000000000001', 34900)`, { commit: true });
  check(k2.ok, "lid koppelt een uitgave aan een bonnetje", uitleg(k2));
  const dubbel = await als(db, "bram", `insert into public.bk_koppelingen (boeking_id, bron, bron_id, bedrag_centen) values ('${INK}', 'factuur', 'ffffffff-0000-4000-8000-000000000001', 1)`);
  check(!dubbel.ok && dubbel.code === "23505", "zelfde koppeling niet twee keer", uitleg(dubbel));
  const ind = await als(db, "indringer", `insert into public.bk_koppelingen (boeking_id, bron, bron_id, bedrag_centen) values ('${INK}', 'factuur', 'ffffffff-0000-4000-8000-000000000002', 1)`);
  check(geweigerd(ind), "buitenstaander koppelt niets", uitleg(ind));
  // Vergrendeld Q2: ontkoppelen van een regel met btw kan niet; van een regel zonder btw wel.
  await db.exec("insert into public.bk_aangiften (jaar, kwartaal) values (2026, 2)");
  const los = await als(db, "bram", `delete from public.bk_koppelingen where boeking_id = '${INK}'`);
  check(vergrendeld(los), "ontkoppelen in een vergrendeld kwartaal (regel met btw) geweigerd", uitleg(los));
  const zonderBtw = (await db.query(`insert into public.bk_boekingen (rekening_id, datum, omschrijving, soort, richting, bedrag_centen, btw_code, btw_centen, grootboek_code) values ('${REK}', '2026-05-21', 'Betaling 2026-902', 'inkomst', 'bij', 121000, 'geen', 0, '8000') returning id`)).rows[0].id;
  const k3 = await als(db, "bram", `insert into public.bk_koppelingen (boeking_id, bron, bron_id, bedrag_centen) values ('${zonderBtw}', 'factuur', 'ffffffff-0000-4000-8000-000000000002', 121000)`);
  check(k3.ok, "koppelen in een vergrendeld kwartaal kan bij een regel zonder eigen btw", uitleg(k3));
  const status = await als(db, "bram", `update public.bk_boekingen set status = 'geboekt' where id = '${INK}'`);
  check(status.ok && status.n === 1, "status van een gekoppelde regel in Q2 mag wijzigen", uitleg(status));
  // Verfijning: factuur uit Q2 (vergrendeld) niet, factuur uit Q1 (open) wel; notitie mag altijd.
  const ex1 = await als(db, "bram", "insert into public.bk_bron_extra (bron, bron_id, btw_code) values ('factuur', 'ffffffff-0000-4000-8000-000000000001', 'eu_dienst')");
  check(vergrendeld(ex1), "btw-rubriek van een factuur in een vergrendeld kwartaal wijzigen geweigerd", uitleg(ex1));
  const ex2 = await als(db, "bram", "insert into public.bk_bron_extra (bron, bron_id, btw_code, notitie) values ('factuur', 'ffffffff-0000-4000-8000-000000000002', 'eu_dienst', 'x')", { commit: true });
  check(ex2.ok, "verfijning van een factuur in een open kwartaal kan", uitleg(ex2));
  const ex3 = await als(db, "bram", "update public.bk_bron_extra set btw_code = '21' where bron_id = 'ffffffff-0000-4000-8000-000000000002'");
  check(ex3.ok && ex3.n === 1, "verfijning wijzigen in een open kwartaal kan", uitleg(ex3));
  await db.exec("delete from public.bk_aangiften where jaar = 2026 and kwartaal = 2");
  check((await als(db, "bram", `delete from public.bk_koppelingen where boeking_id = '${INK}'`)).ok, "na intrekken: ontkoppelen kan weer");
  // invoices/expenses zijn niet gewijzigd door de koppelingen.
  const inv = (await db.query("select string_agg(invoice_number || ':' || total::text, ',' order by invoice_number) as s from public.invoices where invoice_number like '2026-90%'")).rows[0].s;
  check(inv === "2026-901:3630.00,2026-902:1210.00", "facturen ongemoeid door koppelen en verfijnen", inv);

  // bk_importeer
  const regels = JSON.stringify([
    { datum: "2026-10-01", omschrijving: "KPN", tegenpartij: "KPN B.V.", tegenrekening: "NL13KPNB0101010101", soort: "uitgave", richting: "af", bedrag_centen: 4840, btw_code: "21", btw_centen: 840, grootboek_code: "4700", vennoot_id: "", import_sleutel: "rb:1", kenmerk: "" },
    { datum: "2026-10-02", omschrijving: "Fysio", tegenpartij: "", tegenrekening: "", soort: "inkomst", richting: "bij", bedrag_centen: 302500, btw_code: "21", btw_centen: 52500, grootboek_code: "8000", vennoot_id: "", import_sleutel: "rb:2", kenmerk: "" },
  ]);
  const imp1 = await als(db, "bram", [[`select public.bk_importeer($1, 'afschrift.csv', 'regiobank', $2::jsonb) as r`, [REK, regels]]], { commit: true });
  check(imp1.ok && imp1.rows[0].r.nieuw === 2 && imp1.rows[0].r.dubbel === 0, "import: 2 nieuwe regels", uitleg(imp1) + JSON.stringify(imp1.rows?.[0]));
  const imp2 = await als(db, "bram", [[`select public.bk_importeer($1, 'afschrift.csv', 'regiobank', $2::jsonb) as r`, [REK, regels]]], { commit: true });
  check(imp2.ok && imp2.rows[0].r.nieuw === 0 && imp2.rows[0].r.dubbel === 2, "opnieuw importeren: 0 nieuw, 2 dubbel", uitleg(imp2) + JSON.stringify(imp2.rows?.[0]));
  const st = (await db.query("select status, import_id is not null as i, created_by from public.bk_boekingen where import_sleutel in ('rb:1', 'rb:2')")).rows;
  check(st.length === 2 && st.every((r) => r.status === "te_verwerken" && r.i && r.created_by === U.bram), "geïmporteerde regels: te verwerken, met import en created_by", JSON.stringify(st));
  const im = (await db.query("select aantal_nieuw, aantal_dubbel, periode_van::text, periode_tot::text from public.bk_imports order by created_at")).rows;
  check(im.length === 2 && im[0].aantal_nieuw === 2 && im[1].aantal_dubbel === 2 && im[0].periode_van === "2026-10-01" && im[0].periode_tot === "2026-10-02", "bk_imports houdt de telling en periode bij", JSON.stringify(im));
  const impInd = await als(db, "indringer", [[`select public.bk_importeer($1, 'x', 'regiobank', $2::jsonb)`, [REK, regels]]]);
  check(!impInd.ok, "buitenstaander kan niet importeren", uitleg(impInd));
  const impAnon = await als(db, "anon", [[`select public.bk_importeer($1, 'x', 'regiobank', $2::jsonb)`, [REK, regels]]]);
  check(geweigerd(impAnon), "anon kan niet importeren", uitleg(impAnon));
  await db.exec("insert into public.bk_aangiften (jaar, kwartaal) values (2026, 4)");
  const regelsQ4 = JSON.stringify([{ datum: "2026-10-03", omschrijving: "x", soort: "uitgave", richting: "af", bedrag_centen: 100, btw_code: "geen", btw_centen: 0, import_sleutel: "rb:3" }]);
  const impSlot = await als(db, "bram", [[`select public.bk_importeer($1, 'x', 'regiobank', $2::jsonb)`, [REK, regelsQ4]]]);
  check(vergrendeld(impSlot) && (await db.query("select count(*)::int as n from public.bk_imports")).rows[0].n === 2, "import in een vergrendeld kwartaal: alles teruggedraaid", uitleg(impSlot));
  await db.exec("delete from public.bk_aangiften where jaar = 2026 and kwartaal = 4");
}

// ---- grootboek ----
{
  const sys = await als(db, "bram", "delete from public.bk_grootboek where code = '4990'");
  check(!sys.ok && /grootboek_systeem/.test(sys.msg || ""), "systeemrekening niet te verwijderen", uitleg(sys));
  const code = await als(db, "bram", "update public.bk_grootboek set code = '4991' where code = '4990'");
  check(!code.ok, "code van een systeemrekening niet te wijzigen", uitleg(code));
  const naam = await als(db, "bram", "update public.bk_grootboek set naam = 'Overig' where code = '4990'");
  check(naam.ok && naam.n === 1, "naam van een systeemrekening wel te wijzigen", uitleg(naam));
  const eigen = await als(db, "bram", ["insert into public.bk_grootboek (code, naam, soort) values ('4995', 'Abonnementen overig', 'kosten')", "delete from public.bk_grootboek where code = '4995'"]);
  check(eigen.ok && eigen.n === 1, "eigen ongebruikte rekening toevoegen en verwijderen kan", uitleg(eigen));
}

// ---- rekeningen ----
{
  const r = await als(db, "bram", "select public.bk_rekening_toevoegen('Bunq', 'NL91BUNQ0123456789', 'generiek', 12345, '2026-01-01') as id", { commit: true });
  check(r.ok && r.rows[0].id, "rekening toevoegen (functie)", uitleg(r));
  const g = (await db.query("select r.grootboek_code, g.naam from public.bk_rekeningen r join public.bk_grootboek g on g.code = r.grootboek_code where r.naam = 'Bunq'")).rows[0];
  check(g?.grootboek_code === "1120" && g?.naam === "Bank Bunq", "nieuwe rekening krijgt grootboekrekening 1120", JSON.stringify(g));
  const anon = await als(db, "anon", "select public.bk_rekening_toevoegen('X')");
  check(geweigerd(anon), "anon kan geen rekening toevoegen", uitleg(anon));
  const ind = await als(db, "indringer", "select public.bk_rekening_toevoegen('X')");
  check(!ind.ok, "buitenstaander kan geen rekening toevoegen", uitleg(ind));
  const dubbel = await als(db, "bram", "select public.bk_rekening_toevoegen('bunq')");
  check(!dubbel.ok && dubbel.code === "23505", "zelfde naam niet twee keer", uitleg(dubbel));
  const wissel = await als(db, "bram", [[`select public.bk_standaard_rekening($1)`, [r.rows[0].id]]], { commit: true });
  check(wissel.ok, "standaardrekening wisselen", uitleg(wissel));
  const std = (await db.query("select naam from public.bk_rekeningen where standaard")).rows.map((x) => x.naam);
  check(std.join() === "Bunq", "precies één standaardrekening (de nieuwe)", std.join());
  const tweede = await als(db, "bram", "update public.bk_rekeningen set standaard = true where naam = 'Revolut'");
  check(!tweede.ok && tweede.code === "23505", "twee standaardrekeningen kan niet", uitleg(tweede));
  // Aanpassingen blijven staan bij opnieuw uitvoeren.
  await db.exec("update public.bk_rekeningen set naam = 'RegioBank Zakelijk' where grootboek_code = '1100'; update public.bk_vennoten set winstaandeel = 60 where naam = 'Daniel'; update public.bk_vennoten set winstaandeel = 40 where naam = 'Bram'");
  checkControle(await voerUit(db, sql27, "UITVOEREN_0027 (3)"), "0027 (3e keer, na aanpassingen)");
  const na = (await db.query("select naam, standaard from public.bk_rekeningen order by volgorde")).rows;
  check(na.length === 3 && na.find((x) => x.naam === "Bunq")?.standaard && na.some((x) => x.naam === "RegioBank Zakelijk"), "opnieuw uitvoeren: geen extra rekeningen, standaard en naam blijven", JSON.stringify(na));
  const v = (await db.query("select winstaandeel::int as a from public.bk_vennoten where naam = 'Daniel'")).rows[0].a;
  check(v === 60, "opnieuw uitvoeren: winstaandeel blijft", String(v));
  const nb = (await db.query("select count(*)::int as n from public.bk_boekingen")).rows[0].n;
  check(nb >= 1 && (await db.query("select count(*)::int as n from public.bk_boekingen where id = $1", [B1])).rows[0].n === 1, "opnieuw uitvoeren: boekingen blijven", String(nb));
}

// ---- 2FA ----
{
  await db.query("insert into auth.mfa_factors (user_id, friendly_name, status) values ($1, 'Telefoon', 'verified')", [U.daniel]);
  const a1 = await als(db, "daniel", "select count(*)::int as n from public.bk_boekingen", { aal: "aal1" });
  check(a1.ok && a1.rows[0].n === 0, "met 2FA-factor op aal1: niets", uitleg(a1));
  const a2 = await als(db, "daniel", "select count(*)::int as n from public.bk_boekingen", { aal: "aal2" });
  check(a2.ok && a2.rows[0].n > 0, "met 2FA-factor op aal2: alles", uitleg(a2));
}

// ---- de bestaande SQL-bestanden blijven "ok" na 0027 ----
for (const f of ["UITVOEREN_0026.sql", "UITVOEREN_0021_TEAM.sql"]) {
  checkControle(await voerUit(db, lees(`supabase/${f}`), f), `${f} na 0027`);
}
check((await db.query("select count(*)::int as n from public.bk_grootboek where systeem")).rows[0].n === 38 && (await db.query("select count(*)::int as n from public.bk_rekeningen")).rows[0].n === 3, "grote bestanden raken de boekhouding niet");

await db.close();
console.log(`\n${goed} geslaagd, ${fouten} mislukt`);
if (fouten) process.exit(1);
