// Test van de RLS-migratie (0021) op een lokale Postgres (PGlite, in het geheugen), met
// nagebootste Supabase-onderdelen: de rollen anon/authenticated/service_role, auth.users +
// auth.uid() (uit request.jwt.claim.sub, zoals PostgREST) en storage.buckets/objects.
// Er wordt niets tegen Supabase uitgevoerd en niets naar het netwerk gestuurd.
//
// Scenario A  0001–0020 → data → 0021 (los, zoals nu in Supabase) → Mark + oude projecten
//             → UITVOEREN_0022.sql (2x) → (vóór 0023: 'gepland' en de foutmelding van de
//               statuscheck die de app herkent) → UITVOEREN_0023.sql (2x)
//             → UITVOEREN_0021_TEAM.sql (2x) → UITVOEREN_IN_SQL_EDITOR.sql
//             → UITVOEREN_0020_UITGAVEN.sql: elke controleregel "ok", niets heropend (ook de
//               open leesregels voor taken van 0021 komen niet terug).
//             → 0022_team_crm.sql (2x): welkom_klaar_op gezet voor de eigenaar, niet voor
//               een lid; alleen je eigen welkom-vlag te zetten.
//             → 0022 klanten & projecten: oude projectstatussen omgezet (actief→bezig,
//               gearchiveerd→afgerond), eigenaren gevuld (maker of team-eigenaar), klanten
//               standaard 'actief'; notities alleen door de schrijver te verwijderen;
//               project_eigenaren alleen actieve teamleden.
//             → 0022 wie-ziet-welke-taak: een taak die Daniel alleen voor Mark maakt, ziet
//               Mark wel en een derde niet; een losse taak van Mark bestaat voor Daniel
//               niet (tasks, task_assignees, task_subtasks); projecttaken zijn voor het
//               team leesbaar; afspraken alleen voor maker en deelnemers.
//             → 0022 snelheid: taak_tellingen / project_taak_tellingen tellen precies wat de
//               lijsten tonen, niets van een ander, niets voor niet-teamleden of anon.
//             → 0023 projectstatus: gepland→voorbereiding, standaard voorbereiding, wachten
//               mag, oude waarden niet; status_sinds behoudt de laatste wijziging en de
//               trigger zet hem alleen bij een statuswijziging; opnieuw uitvoeren van 0022
//               of 0023 laat statussen en status_sinds staan; RLS ongewijzigd.
//             → UITVOEREN_0025.sql (2x): opvolgen (volgende stap, opvolgdatum, soort van een
//               klantnotitie); vóór 0025 geeft de kolom 42703; RLS ongewijzigd.
//             → UITVOEREN_0024.sql (2x): Google Drive. drive_koppeling (refresh token) is voor
//               niemand behalve de service-role te lezen of te schrijven; drive_mappen en
//               drive_kopieen lezen teamleden, alleen de server schrijft; drive_bestanden
//               alleen teamleden; een verwijderde klant laat de uploadregistratie staan.
//             → 0026_beveiliging_mailboxen_backups.sql (2x), deel mailboxen: bestaande
//               user_mailboxes worden één keer overgezet (zelfde ciphertext, label, profielkleur,
//               privé); opnieuw uitvoeren zet niets dubbel of terug; anon/authenticated lezen
//               of schrijven niets (ook geen gedeelde inbox), alleen de service-role.
//             → 0026 deel 2 (beveiliging): wie een geverifieerde 2FA-factor heeft, leest
//               op aal1 niets en op aal2 alles; zonder factor niet buitengesloten (tenzij
//               streng); de noodstop werkt en blijft staan bij opnieuw uitvoeren;
//               toegang_status/is_eigenaar; audit_log alleen leesbaar voor de eigenaar
//               (aal2), door niemand te wijzigen of te verwijderen (trigger, ook truncate),
//               opruimen alleen via audit_opruimen(); inlog_pogingen alleen service-role.
//             Daarna de toegangsmatrix:
//               - niet-teamleden (ingelogd zonder lidmaatschap, onbevestigd, gedeactiveerd,
//                 en anon zonder sessie): op ELKE tabel in public en in ELKE bucket niets
//                 lezen, invoegen, wijzigen of verwijderen; RPC's geweigerd;
//               - teamleden: gedeelde data lezen/schrijven, facturen alleen lezen,
//                 taken/afspraken alleen lezen en wijzigen als betrokkene (0022), eigen profiel, geen
//                 user_mailboxes, privé-buckets alleen via de service-role.
// Scenario B  0001–0019 → UITVOEREN_0021_TEAM.sql (0020 ontbreekt nog) → daarna
//             UITVOEREN_0020_UITGAVEN.sql: alles "ok", ook uitgaven alleen voor teamleden.
//
// Gebruik:  node scripts/test-rls.mjs        (vereist de devDependency @electric-sql/pglite)
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

let goed = 0;
let fouten = 0;
function check(ok, label, detail = "") {
  if (ok) goed++;
  else {
    fouten++;
    console.log(`  FOUT  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

// ---------------------------------------------------------------------------------
// Nagebootst Supabase-fundament
// ---------------------------------------------------------------------------------
const SUPABASE_BASIS = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create schema storage;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  is_anonymous boolean not null default false
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  ), '')::uuid
$$;

-- Zoals Supabase: auth.jwt() uit de claims van PostgREST, en de MFA-factoren (2FA).
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type text not null default 'totp',
  status text not null default 'unverified',
  created_at timestamptz not null default now()
);

create table storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- Zoals Supabase: alles in public standaard voor de API-rollen (RLS beslist).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const U = {
  daniel: "11111111-1111-4111-8111-111111111111",
  mark: "22222222-2222-4222-8222-222222222222",
  onbevestigd: "33333333-3333-4333-8333-333333333333",
  anoniem: "44444444-4444-4444-8444-444444444444",
  indringer: "55555555-5555-4555-8555-555555555555",
  oudlid: "66666666-6666-4666-8666-666666666666",
};

async function nieuweDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_BASIS);
  return db;
}

async function voerUit(db, sql, label) {
  try {
    const r = await db.exec(sql);
    return r;
  } catch (e) {
    throw new Error(`${label}: ${e.message}`);
  }
}

// De controle-select onderaan een UITVOEREN_*.sql-bestand: alle rijen "ok"/"actief"?
function controleRijen(resultaten) {
  const laatste = resultaten[resultaten.length - 1];
  return laatste?.rows ?? [];
}
function checkControle(resultaten, label) {
  const rijen = controleRijen(resultaten);
  check(rijen.length > 0, `${label}: controletabel aanwezig`);
  const mis = rijen.filter((r) => !["ok", "actief", "gedeactiveerd"].includes(r.status));
  check(mis.length === 0, `${label}: elke controleregel ok`, mis.map((r) => `${r.onderdeel}=${r.status}`).join(", "));
  return rijen;
}

// Voer een query uit als een rol (met of zonder ingelogde gebruiker); altijd rollback.
async function als(db, wie, sql, params = []) {
  await db.exec("begin");
  try {
    if (wie === "anon") {
      await db.exec("set local role anon");
    } else if (wie === "service") {
      await db.exec("set local role service_role");
    } else {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [U[wie]]);
      await db.exec("set local role authenticated");
    }
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows, n: r.affectedRows ?? 0 };
  } catch (e) {
    return { ok: false, code: e.code, msg: e.message };
  } finally {
    await db.exec("rollback");
  }
}
// Zoals als(), maar met een JWT-claim aal ('aal1' = alleen wachtwoord, 'aal2' = na de 2FA-code).
async function alsMetAal(db, wie, aal, sql, params = []) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[wie], role: "authenticated", aal })]);
    await db.exec("set local role authenticated");
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows, n: r.affectedRows ?? 0 };
  } catch (e) {
    return { ok: false, code: e.code, msg: e.message };
  } finally {
    await db.exec("rollback");
  }
}
const geweigerd = (r) => !r.ok && r.code === "42501";
const leeg = (r) => (r.ok && r.rows.length === 0) || geweigerd(r);
const nietsGeraakt = (r) => (r.ok && r.n === 0) || geweigerd(r);
const uitleg = (r) => (r.ok ? `${r.rows?.length ?? 0} rijen / ${r.n} geraakt` : `${r.code}: ${r.msg}`);

// ---------------------------------------------------------------------------------
// Testdata (als superuser, vóór 0021): zoals de echte situatie (alleen Daniel), plus
// randgevallen die NIET in het team mogen komen.
// ---------------------------------------------------------------------------------
async function zaaiGebruikersVoor0021(db) {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data, created_at, email_confirmed_at, last_sign_in_at, is_anonymous) values
      ($1, 'daniel@studio-levant.nl', '{"naam":"Daniel Tukker"}', now() - interval '300 days', now() - interval '300 days', now(), false),
      ($2, 'mark@studio-levant.nl', '{}', now() - interval '10 days', now() - interval '10 days', null, false),
      ($3, 'onbevestigd@example.com', '{}', now() - interval '5 days', null, null, false),
      ($4, null, '{}', now() - interval '4 days', null, now(), true)`,
    [U.daniel, U.mark, U.onbevestigd, U.anoniem],
  );
}

async function zaaiData(db, metUitgaven) {
  await db.exec(`
    insert into public.clients (id, company_name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Klant BV');
    insert into public.invoices (invoice_number, year, sequence_number, client_id, client_company_name, line_items, subtotal, revenue_subtotal, vat_amount, total, created_by)
      values ('26-008', 2026, 8, 'aaaaaaaa-0000-4000-8000-000000000001', 'Klant BV', '[]', 100, 100, 21, 121, '${U.daniel}');
    insert into public.quotes (line_items, subtotal, vat_amount, total) values ('[]', 50, 10.5, 60.5);
    insert into public.social_projects (id, name) values ('post-1', 'Post 1');
    insert into public.social_slides (project_id, file, html) values ('post-1', 'slide-1.html', '<p>x</p>');
    insert into public.social_versions (project_id, reason) values ('post-1', 'test');
    insert into public.social_brand (id) values (1) on conflict do nothing;
    insert into public.tasks (id, title, created_by) values
      ('bbbbbbbb-0000-4000-8000-000000000001', 'Taak van Daniel', '${U.daniel}'),
      ('bbbbbbbb-0000-4000-8000-000000000002', 'Taak zonder maker', null);
    insert into public.tasks (id, title, created_by, completed_at) values
      ('bbbbbbbb-0000-4000-8000-000000000003', 'Afgeronde taak', '${U.daniel}', now());
    insert into public.calendar_events (title, starts_at, ends_at, created_by) values
      ('Afspraak', now(), now() + interval '1 hour', '${U.daniel}');
    insert into storage.objects (bucket_id, name) values
      ('invoices', '2026/26-008.pdf'), ('social-assets', 'post-1/foto.png'), ('mail-tmp', '${U.daniel}/x/bijlage.pdf');
  `);
  if (metUitgaven) {
    await db.exec(`
      insert into public.expenses (id, supplier, created_by) values ('cccccccc-0000-4000-8000-000000000001', 'Albert Heijn', '${U.daniel}');
      insert into public.expense_files (expense_id, storage_path, file_name, mime_type)
        values ('cccccccc-0000-4000-8000-000000000001', '${U.daniel}/bon.pdf', 'bon.pdf', 'application/pdf');
      insert into storage.objects (bucket_id, name) values ('uitgaven', '${U.daniel}/bon.pdf'), ('uitgaven-export', 'export.zip');
    `);
  }
}

async function zaaiNa0021(db) {
  // Een account dat (bv. via een open aanmeldknop) is aangemaakt NA 0021: geen lid.
  // En een gedeactiveerd oud-teamlid.
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values
       ($1, 'indringer@example.com', now(), now()), ($2, 'oud@studio-levant.nl', now(), now())`,
    [U.indringer, U.oudlid],
  );
  await db.query(
    `insert into public.profiles (id, naam, initialen, email) values ($1, 'Oud Lid', 'OL', 'oud@studio-levant.nl');
     `,
    [U.oudlid],
  );
  await db.query(`insert into public.team_members (user_id, actief, rol, gedeactiveerd_op) values ($1, false, 'lid', now())`, [U.oudlid]);
  // Rijen in de nieuwe tabellen, zodat "niets lezen" ook iets betekent.
  await db.exec(`
    insert into public.projects (id, naam, client_id, created_by) values ('dddddddd-0000-4000-8000-000000000001', 'Website', 'aaaaaaaa-0000-4000-8000-000000000001', '${U.daniel}');
    insert into public.task_subtasks (task_id, titel) values ('bbbbbbbb-0000-4000-8000-000000000001', 'Stap 1');
    insert into public.user_mailboxes (user_id, email, wachtwoord_enc) values ('${U.daniel}', 'daniel@studio-levant.nl', 'v1:aaa.bbb.ccc');
  `);
  if ((await db.query("select to_regclass('public.client_notes') as t")).rows[0].t) {
    await db.exec(`
      insert into public.client_notes (id, client_id, tekst, created_by)
        values ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Gebeld', '${U.mark}');
      insert into public.project_eigenaren (project_id, user_id) values ('dddddddd-0000-4000-8000-000000000001', '${U.daniel}');
    `);
  }
}

// ---------------------------------------------------------------------------------
// Scenario A
// ---------------------------------------------------------------------------------
async function scenarioA() {
  const db = await nieuweDb();
  for (const f of MIGRATIES.filter((f) => f < "0021")) await voerUit(db, lees(`supabase/migrations/${f}`), f);
  await zaaiGebruikersVoor0021(db);
  await zaaiData(db, true);

  // Sanity: vóór 0021 vindt de controle de open policies wél (de regex werkt op echte pg_policies).
  const open = await db.query(
    `select count(*)::int as n from pg_policies where (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'auth\\.uid\\(\\)( AS uid\\))? IS NOT NULL'`,
  );
  check(open.rows[0].n > 10, "vóór 0021: controle herkent de open policies", `${open.rows[0].n}`);

  // Zoals in Supabase nu: 0021 is (los) uitgevoerd, 0022 nog niet.
  await voerUit(db, lees("supabase/migrations/0021_team_en_taken.sql"), "0021_team_en_taken.sql");
  const team = lees("supabase/UITVOEREN_0021_TEAM.sql");

  // Zaaien: alleen de oudste bevestigde, niet-anonieme gebruiker (eigenaar). Andere
  // bestaande accounts (mogelijk zelf geregistreerd door een buitenstaander) NIET.
  const leden = (await db.query("select user_id, rol, actief from public.team_members order by toegevoegd_op, user_id")).rows;
  const rolVan = Object.fromEntries(leden.map((l) => [l.user_id, l.rol]));
  check(rolVan[U.daniel] === "eigenaar", "zaaien: Daniel (oudste) is eigenaar");
  check(!(U.mark in rolVan), "zaaien: bevestigde tweede gebruiker wordt NIET automatisch lid");
  check(leden.length === 1, "zaaien: precies één lid (de oudste)", `${leden.length}`);
  check(!(U.onbevestigd in rolVan), "zaaien: onbevestigd account is geen lid");
  check(!(U.anoniem in rolVan), "zaaien: anoniem account is geen lid");
  const prof = (await db.query("select naam, initialen from public.profiles where id = $1", [U.daniel])).rows[0];
  check(prof?.naam === "Daniel Tukker" && prof?.initialen === "DT", "zaaien: profiel uit metadata", JSON.stringify(prof));
  const toew = (await db.query("select task_id, user_id from public.task_assignees order by task_id")).rows;
  check(toew.length === 3 && toew.every((t) => t.user_id === U.daniel), "bestaande taken (ook zonder maker) bij Daniel", JSON.stringify(toew));
  const afg = (await db.query("select completed_by from public.tasks where completed_at is not null")).rows;
  check(afg.every((t) => t.completed_by === U.daniel), "afgeronde taak: completed_by gezet");
  const deeln = (await db.query("select count(*)::int as n from public.event_attendees where user_id = $1", [U.daniel])).rows[0].n;
  check(deeln === 1, "bestaande afspraak: Daniel deelnemer");
  const soort = (await db.query("select soort from public.expenses")).rows[0]?.soort;
  check(soort === "inkoopfactuur", "bestaande upload (PDF) krijgt soort inkoopfactuur", soort);

  // Mark komt er (zoals in het echt) bij via het teamlid-script: profiel + lidmaatschap,
  // vóór 0022 (Bram wordt mogelijk al uitgenodigd voordat 0022 is uitgevoerd).
  await db.query("insert into public.profiles (id, naam, initialen, email) values ($1, 'Mark', 'M', 'mark@studio-levant.nl')", [U.mark]);
  await db.query("insert into public.team_members (user_id, actief, rol) values ($1, true, 'lid')", [U.mark]);

  // Projecten van vóór 0022 (oude statussen), om de omzetting te testen.
  await db.query(
    `insert into public.projects (id, naam, status, created_by) values
       ('dddddddd-0000-4000-8000-0000000000a1', 'Oud actief', 'actief', $1),
       ('dddddddd-0000-4000-8000-0000000000a2', 'Oud archief', 'gearchiveerd', null)`,
    [U.mark],
  );

  // supabase/UITVOEREN_0022.sql: twee keer achter elkaar, controle telkens "ok".
  const sql0022 = lees("supabase/UITVOEREN_0022.sql");
  checkControle(await voerUit(db, sql0022, "UITVOEREN_0022.sql"), "A: UITVOEREN_0022 (1e keer)");
  checkControle(await voerUit(db, sql0022, "UITVOEREN_0022.sql (2x)"), "A: UITVOEREN_0022 (2e keer)");
  const def22 = (await db.query("select column_default from information_schema.columns where table_name = 'projects' and column_name = 'status'")).rows[0].column_default;
  check(/bezig/.test(def22 ?? ""), "0022: nieuwe projecten standaard 'bezig'", def22);

  // Vóór 0023 (zo staat Supabase nu): een gepland project van vijf dagen oud. 'wachten'
  // bestaat nog niet; de app herkent die weigering aan de naam van de check.
  await db.query(
    `insert into public.projects (id, naam, status, created_by, updated_at) values
       ('dddddddd-0000-4000-8000-0000000000a3', 'Oud gepland', 'gepland', $1, now() - interval '5 days')`,
    [U.mark],
  );
  let r23 = await als(db, "mark", "update public.projects set status = 'wachten' where id = 'dddddddd-0000-4000-8000-0000000000a3'");
  check(!r23.ok && r23.code === "23514" && /projects_status_check/.test(r23.msg), "vóór 0023: 'wachten' geweigerd door projects_status_check (de app vangt dat op)", uitleg(r23));
  r23 = await als(db, "mark", "update public.projects set status = 'voorbereiding' where id = 'dddddddd-0000-4000-8000-0000000000a3'");
  check(!r23.ok && /projects_status_check/.test(r23.msg ?? ""), "vóór 0023: 'voorbereiding' geweigerd (de app schrijft dan 'gepland')", uitleg(r23));

  // supabase/UITVOEREN_0023.sql: twee keer achter elkaar, controle telkens "ok".
  const sql0023 = lees("supabase/UITVOEREN_0023.sql");
  checkControle(await voerUit(db, sql0023, "UITVOEREN_0023.sql"), "A: UITVOEREN_0023 (1e keer)");
  checkControle(await voerUit(db, sql0023, "UITVOEREN_0023.sql (2x)"), "A: UITVOEREN_0023 (2e keer)");

  // Vóór 0025 (zo staat Supabase nu): een notitie met 'soort' of een opvolgdatum geeft
  // 42703 (onbekende kolom); de app herkent dat (kolomOntbreekt) en verbergt het opvolgen.
  await db.exec(
    "insert into public.clients (id, company_name) values ('aaaaaaaa-0000-4000-8000-0000000000f5', 'Opvolg BV');" +
      "insert into public.client_notes (client_id, tekst, created_by) values ('aaaaaaaa-0000-4000-8000-0000000000f5', 'Oude notitie', '" + U.daniel + "')",
  );
  let r25 = await als(db, "mark", "insert into public.client_notes (client_id, tekst, soort) values ('aaaaaaaa-0000-4000-8000-0000000000f5', 'Lead → Actief', 'status')");
  check(!r25.ok && r25.code === "42703", "vóór 0025: kolom client_notes.soort bestaat nog niet (42703)", uitleg(r25));
  r25 = await als(db, "mark", "update public.clients set opvolgen_op = current_date");
  check(!r25.ok && r25.code === "42703", "vóór 0025: kolom clients.opvolgen_op bestaat nog niet (42703)", uitleg(r25));

  // Opnieuw de oudere/grote bestanden: mogen de open policies van 0014–0020 én de open
  // leesregels voor taken van 0021 niet terugzetten (ze eindigen met 0021 + 0022).
  checkControle(await voerUit(db, team, "UITVOEREN_0021_TEAM.sql"), "A: 0021_TEAM opnieuw");
  checkControle(await voerUit(db, team, "UITVOEREN_0021_TEAM.sql (2x)"), "A: 0021_TEAM opnieuw (2x)");
  checkControle(await voerUit(db, lees("supabase/UITVOEREN_IN_SQL_EDITOR.sql"), "UITVOEREN_IN_SQL_EDITOR.sql"), "A: IN_SQL_EDITOR opnieuw");
  checkControle(await voerUit(db, lees("supabase/UITVOEREN_0020_UITGAVEN.sql"), "UITVOEREN_0020_UITGAVEN.sql"), "A: 0020_UITGAVEN opnieuw");
  const nLeden = (await db.query("select count(*)::int as n from public.team_members")).rows[0].n;
  check(nLeden === 2, "opnieuw uitvoeren zaait geen extra leden", `${nLeden}`);
  const open0021 = (await db.query("select count(*)::int as n from pg_policies where policyname like 'teamleden lezen %' and tablename in ('tasks', 'task_assignees', 'task_subtasks', 'calendar_events', 'event_attendees')")).rows[0].n;
  check(open0021 === 0, "oudere bestanden opnieuw: open leesregels voor taken blijven weg", `${open0021}`);

  await welkom0022(db);

  await zaaiNa0021(db);
  await crm0022(db);
  await projectstatus0023(db);
  await drive0024(db);
  await opvolging0025(db);
  await mailboxen0026(db);
  await beveiliging0026(db);
  await backups0026(db);
  await zichtbaarheid0022(db);
  await matrix(db);

  // De controletabel slaat alarm bij een lek (bv. later met de hand toegevoegde policy).
  const controleSql = team.slice(team.lastIndexOf("-- Controle:"));
  await db.exec(`create policy "lek" on public.invoices for select to authenticated using (true);
                 update storage.buckets set public = true where id = 'uitgaven';`);
  const rijen = controleRijen(await db.exec(controleSql));
  const status = Object.fromEntries(rijen.map((r) => [r.onderdeel, r.status]));
  check(status["elke policy vereist teamlid"] === "ONTBREEKT", "controle ziet een policy zonder teamcheck", status["elke policy vereist teamlid"]);
  check(status["geen openbare buckets"] === "ONTBREEKT", "controle ziet een openbare bucket", status["geen openbare buckets"]);
  await db.close();
}

// ---------------------------------------------------------------------------------
// De toegangsmatrix
// ---------------------------------------------------------------------------------
async function matrix(db) {
  const tabellen = (
    await db.query(
      `select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1`,
    )
  ).rows.map((r) => r.relname);
  check(tabellen.length >= 19, "alle tabellen gevonden", tabellen.join(","));

  const kolommen = {};
  const voorbeeld = {};
  for (const t of tabellen) {
    kolommen[t] = (
      await db.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' and identity_generation is null
         order by ordinal_position`,
        [t],
      )
    ).rows.map((r) => r.column_name);
    const r = await db.query(`select to_jsonb(x) as j from public.${t} x limit 1`);
    voorbeeld[t] = r.rows[0]?.j;
    check(voorbeeld[t] !== undefined, `testdata aanwezig in ${t}`);
  }

  const buitenstaanders = ["indringer", "onbevestigd", "anoniem", "oudlid", "anon"];
  for (const wie of buitenstaanders) {
    for (const t of tabellen) {
      const sel = await als(db, wie, `select * from public.${t}`);
      if (t === "team_members" && wie === "oudlid") {
        // Bewust: een gedeactiveerd lid ziet alleen zijn eigen (inactieve) regel, voor de
        // "geen toegang"-melding. Niets van anderen.
        check(sel.ok && sel.rows.length === 1 && sel.rows[0].user_id === U.oudlid && !sel.rows[0].actief, `${wie}: alleen eigen inactieve lidmaatschap`, uitleg(sel));
      } else {
        check(leeg(sel), `${wie}: leest niets uit ${t}`, uitleg(sel));
      }
      const cols = kolommen[t].map((c) => `"${c}"`).join(", ");
      const ins = await als(db, wie, `insert into public.${t} (${cols}) select ${cols} from jsonb_populate_record(null::public.${t}, $1::jsonb)`, [
        JSON.stringify(voorbeeld[t]),
      ]);
      check(geweigerd(ins), `${wie}: kan niet invoegen in ${t}`, uitleg(ins));
      const eerste = kolommen[t][0];
      const upd = await als(db, wie, `update public.${t} set "${eerste}" = "${eerste}"`);
      check(nietsGeraakt(upd), `${wie}: wijzigt niets in ${t}`, uitleg(upd));
      const del = await als(db, wie, `delete from public.${t}`);
      check(nietsGeraakt(del), `${wie}: verwijdert niets uit ${t}`, uitleg(del));
    }

    const buckets = (await db.query("select id from storage.buckets order by id")).rows.map((r) => r.id);
    check(buckets.length === 5, "vijf buckets", buckets.join(","));
    for (const b of buckets) {
      const sel = await als(db, wie, "select * from storage.objects where bucket_id = $1", [b]);
      check(leeg(sel), `${wie}: ziet geen bestanden in ${b}`, uitleg(sel));
      const ins = await als(db, wie, "insert into storage.objects (bucket_id, name) values ($1, 'nieuw.pdf')", [b]);
      check(geweigerd(ins), `${wie}: kan niet uploaden naar ${b}`, uitleg(ins));
      const upd = await als(db, wie, "update storage.objects set name = name || '-x' where bucket_id = $1", [b]);
      check(nietsGeraakt(upd), `${wie}: wijzigt niets in ${b}`, uitleg(upd));
      const del = await als(db, wie, "delete from storage.objects where bucket_id = $1", [b]);
      check(nietsGeraakt(del), `${wie}: verwijdert niets in ${b}`, uitleg(del));
    }

    const rpc = await als(db, wie, "select public.taak_aanmaken($1::jsonb)", [JSON.stringify({ titel: "x", voorWie: [U[wie] ?? U.daniel] })]);
    check(!rpc.ok, `${wie}: taak_aanmaken geweigerd`, uitleg(rpc));
    const fac = await als(
      db,
      wie,
      "select p.oid::regprocedure::text as f, has_function_privilege(current_user, p.oid, 'execute') as mag from pg_proc p where p.proname in ('create_invoice','update_invoice','social_restore_latest','team_eigenaar','audit_opruimen','backup_tabellen')",
    );
    check(fac.ok && fac.rows.length >= 6 && fac.rows.every((r) => !r.mag), `${wie}: factuur-/beheerfuncties niet uitvoerbaar`, JSON.stringify(fac.rows ?? fac.msg));
    if (wie !== "anon") {
      const lid = await als(db, wie, "select public.is_teamlid() as lid, public.is_actief_teamlid($1) as ander", [U.daniel]);
      check(lid.ok && lid.rows[0].lid === false && lid.rows[0].ander === false, `${wie}: is_teamlid() = false en verraadt niets`, uitleg(lid));
    } else {
      const lid = await als(db, wie, "select public.is_teamlid()");
      check(geweigerd(lid), "anon: is_teamlid() niet uitvoerbaar", uitleg(lid));
    }
  }

  // ---- Teamleden ----
  // Taken en afspraken (0022): alleen als betrokkene; al het andere: alles.
  const ZICHTBAAR = {
    tasks: `select count(*)::int as n from public.tasks t where ${taakZichtbaarSql("t")}`,
    task_assignees: `select count(*)::int as n from public.task_assignees x join public.tasks t on t.id = x.task_id
                     where x.user_id = $1 or ${taakZichtbaarSql("t")}`,
    task_subtasks: `select count(*)::int as n from public.task_subtasks x join public.tasks t on t.id = x.task_id where ${taakZichtbaarSql("t")}`,
    calendar_events: `select count(*)::int as n from public.calendar_events e where ${afspraakZichtbaarSql("e")}`,
    event_attendees: `select count(*)::int as n from public.event_attendees x join public.calendar_events e on e.id = x.event_id
                      where x.user_id = $1 or ${afspraakZichtbaarSql("e")}`,
  };
  for (const wie of ["daniel", "mark"]) {
    for (const t of tabellen) {
      const sel = await als(db, wie, `select count(*)::int as n from public.${t}`);
      if (t === "user_mailboxes" || t === "drive_koppeling" || t === "mailboxen" || t === "inlog_pogingen" || t === "backup_bestanden") {
        check(geweigerd(sel), `${wie}: ${t} niet leesbaar (alleen server)`, uitleg(sel));
      } else if ((t === "audit_log" || t === "backup_runs" || t === "heartbeat") && wie !== "daniel") {
        check(sel.ok && sel.rows[0].n === 0, `${wie}: ${t} niet leesbaar (alleen eigenaar)`, uitleg(sel));
      } else if (ZICHTBAAR[t]) {
        const echt = (await db.query(ZICHTBAAR[t], [U[wie]])).rows[0].n;
        check(sel.ok && sel.rows[0].n === echt, `${wie}: leest alleen eigen/betrokken rijen uit ${t}`, `${uitleg(sel)} verwacht ${echt}`);
      } else {
        const echt = (await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n;
        check(sel.ok && sel.rows[0].n === echt, `${wie}: leest alles uit ${t}`, uitleg(sel));
      }
    }
  }
  // Gedeelde data schrijven.
  let r = await als(db, "mark", "insert into public.clients (company_name) values ('Nieuwe klant') returning created_by");
  check(r.ok && r.rows[0].created_by === U.mark, "lid: klant aanmaken (created_by = zichzelf)", uitleg(r));
  r = await als(db, "mark", "update public.expenses set supplier = 'Jumbo'");
  check(r.ok && r.n === 1, "lid: bonnetje wijzigen", uitleg(r));
  r = await als(db, "mark", "insert into public.projects (naam) values ('Huisstijl') returning id");
  check(r.ok, "lid: project aanmaken", uitleg(r));
  // Facturen: alleen lezen.
  r = await als(db, "daniel", "update public.invoices set total = total");
  check(nietsGeraakt(r), "eigenaar: facturen niet direct wijzigbaar (alleen via server)", uitleg(r));
  r = await als(db, "daniel", "select public.create_invoice(2026, 9, now(), null, 'x', null, null, null, null, '[]', 0, 0, 21, 0, 0)");
  check(geweigerd(r), "eigenaar: create_invoice niet met de gebruikersrol", uitleg(r));
  // Storage.
  r = await als(db, "mark", "select name from storage.objects where bucket_id = 'invoices'");
  check(r.ok && r.rows.length === 1, "lid: factuur-pdf leesbaar", uitleg(r));
  r = await als(db, "mark", "insert into storage.objects (bucket_id, name) values ('invoices', 'nep.pdf')");
  check(geweigerd(r), "lid: kan geen factuur-pdf uploaden", uitleg(r));
  r = await als(db, "mark", "insert into storage.objects (bucket_id, name) values ('social-assets', 'post-1/nieuw.png')");
  check(r.ok, "lid: social-bestand uploaden", uitleg(r));
  r = await als(db, "mark", "delete from storage.objects where bucket_id = 'social-assets'");
  check(r.ok && r.n === 1, "lid: social-bestand verwijderen", uitleg(r));
  for (const b of ["uitgaven", "uitgaven-export", "mail-tmp"]) {
    r = await als(db, "daniel", "select * from storage.objects where bucket_id = $1", [b]);
    check(leeg(r), `eigenaar: ${b} alleen via de service-role`, uitleg(r));
  }
  r = await als(db, "service", "select (select count(*)::int from storage.objects where bucket_id = 'uitgaven') as b, (select count(*)::int from public.user_mailboxes) as m");
  check(r.ok && r.rows[0].b === 1 && r.rows[0].m === 1, "service-role: leest privé-bucket en user_mailboxes", uitleg(r));

  // Taken op naam.
  r = await als(db, "daniel", "select public.taak_aanmaken($1::jsonb) as id", [
    JSON.stringify({ titel: "Voor Mark", voorWie: [U.mark], subtaken: ["a", "b"], projectId: "dddddddd-0000-4000-8000-000000000001" }),
  ]);
  check(r.ok && r.rows[0].id, "eigenaar: taak voor Mark aanmaken (rpc)", uitleg(r));
  await db.exec("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [U.daniel]);
  await db.exec("set local role authenticated");
  const nieuw = (await db.query("select public.taak_aanmaken($1::jsonb) as id", [JSON.stringify({ titel: "Voor Mark", voorWie: [U.mark], subtaken: ["a"] })])).rows[0].id;
  await db.exec("commit");
  await db.exec("reset role");
  const tk = (await db.query("select created_by, client_id from public.tasks where id = $1", [nieuw])).rows[0];
  check(tk.created_by === U.daniel, "rpc: maker = ingelogde gebruiker");
  r = await als(db, "mark", "update public.tasks set title = 'Aangepast' where id = $1", [nieuw]);
  check(r.ok && r.n === 1, "toegewezene: kan taak wijzigen", uitleg(r));
  r = await als(db, "mark", "update public.tasks set created_by = $2 where id = $1 returning created_by", [nieuw, U.mark]);
  check(r.ok && r.rows[0]?.created_by === U.daniel, "maker blijft behouden (trigger)", uitleg(r));
  r = await als(db, "mark", "update public.tasks set title = 'Gekaapt' where id = 'bbbbbbbb-0000-4000-8000-000000000001'");
  check(nietsGeraakt(r), "niet-betrokken lid: kan taak van een ander niet wijzigen", uitleg(r));
  r = await als(db, "mark", "delete from public.tasks where id = 'bbbbbbbb-0000-4000-8000-000000000001'");
  check(nietsGeraakt(r), "niet-betrokken lid: kan taak van een ander niet verwijderen", uitleg(r));
  r = await als(db, "mark", "insert into public.task_assignees (task_id, user_id) values ('bbbbbbbb-0000-4000-8000-000000000001', $1)", [U.mark]);
  check(geweigerd(r), "niet-betrokken lid: kan zich niet aan andermans taak toevoegen", uitleg(r));
  r = await als(db, "mark", "update public.task_subtasks set klaar_op = now() where task_id = 'bbbbbbbb-0000-4000-8000-000000000001'");
  check(nietsGeraakt(r), "niet-betrokken lid: kan subtaak van een ander niet afvinken", uitleg(r));
  r = await als(db, "mark", "update public.task_subtasks set klaar_op = now(), klaar_door = $2 where task_id = $1", [nieuw, U.mark]);
  check(r.ok && r.n === 1, "toegewezene: subtaak afvinken", uitleg(r));
  r = await als(db, "daniel", "insert into public.task_assignees (task_id, user_id) values ($1, $2)", [nieuw, U.indringer]);
  check(geweigerd(r), "toewijzen aan niet-teamlid geweigerd", uitleg(r));
  r = await als(db, "daniel", "insert into public.task_assignees (task_id, user_id) values ($1, $2)", [nieuw, U.oudlid]);
  check(geweigerd(r), "toewijzen aan gedeactiveerd lid geweigerd", uitleg(r));
  r = await als(db, "mark", "insert into public.tasks (title, created_by) values ('Namens Daniel', $1)", [U.daniel]);
  check(geweigerd(r), "taak aanmaken namens een ander geweigerd", uitleg(r));
  r = await als(db, "mark", "insert into public.calendar_events (title, starts_at, ends_at, created_by) values ('x', now(), now() + interval '1 hour', $1)", [U.daniel]);
  check(geweigerd(r), "afspraak aanmaken namens een ander geweigerd", uitleg(r));
  r = await als(db, "mark", "update public.calendar_events set title = 'Gekaapt'");
  check(nietsGeraakt(r), "niet-deelnemer: kan afspraak van een ander niet wijzigen", uitleg(r));
  r = await als(db, "daniel", "select public.taak_aanmaken($1::jsonb)", [
    JSON.stringify({ titel: "Fout project", voorWie: [U.daniel], klantId: "aaaaaaaa-0000-4000-8000-000000000001", projectId: "00000000-0000-4000-8000-000000000999" }),
  ]);
  check(!r.ok && r.code === "23503", "rpc: onbekend project geweigerd", uitleg(r));
  r = await als(db, "daniel", "select public.taak_aanmaken($1::jsonb)", [JSON.stringify({ titel: "Niemand", voorWie: [] })]);
  check(!r.ok && r.code === "23514", "rpc: zonder toegewezene geweigerd", uitleg(r));

  // Profielen en lidmaatschap.
  r = await als(db, "mark", "update public.profiles set naam = 'Mark de Vries', initialen = 'MV' where id = $1", [U.mark]);
  check(r.ok && r.n === 1, "lid: eigen profiel aanpassen", uitleg(r));
  r = await als(db, "mark", "update public.profiles set naam = 'Gekaapt' where id = $1", [U.daniel]);
  check(nietsGeraakt(r), "lid: profiel van een ander niet aan te passen", uitleg(r));
  r = await als(db, "mark", "update public.profiles set email = 'x@y.nl' where id = $1", [U.mark]);
  check(geweigerd(r), "lid: e-mailadres in profiel niet aan te passen", uitleg(r));
  r = await als(db, "mark", "update public.team_members set rol = 'eigenaar' where user_id = $1", [U.mark]);
  check(geweigerd(r), "lid: kan eigen rol niet veranderen", uitleg(r));
  r = await als(db, "oudlid", "update public.team_members set actief = true where user_id = $1", [U.oudlid]);
  check(geweigerd(r), "oud-lid: kan zichzelf niet heractiveren", uitleg(r));
  r = await als(db, "mark", "insert into public.user_mailboxes (user_id, email, wachtwoord_enc) values ($1, 'm@x.nl', 'v1:a')", [U.mark]);
  check(geweigerd(r), "lid: user_mailboxes niet direct te schrijven", uitleg(r));

  // Deactiveren sluit direct buiten.
  await db.query("update public.team_members set actief = false where user_id = $1", [U.mark]);
  r = await als(db, "mark", "select * from public.invoices");
  check(leeg(r), "na deactiveren: geen facturen meer", uitleg(r));
  r = await als(db, "mark", "select * from storage.objects where bucket_id = 'invoices'");
  check(leeg(r), "na deactiveren: geen factuur-pdf's meer", uitleg(r));
  r = await als(db, "mark", "update public.tasks set title = 'x' where id = $1", [nieuw]);
  check(nietsGeraakt(r), "na deactiveren: eigen taak niet meer te wijzigen", uitleg(r));
  await db.query("update public.team_members set actief = true where user_id = $1", [U.mark]);

  // Verwijderen van een gebruiker: toewijzingen weg, facturen blijven (maker leeg).
  await db.query("delete from auth.users where id = $1", [U.daniel]);
  const inv = (await db.query("select count(*)::int as n, count(created_by)::int as m from public.invoices")).rows[0];
  check(inv.n === 1 && inv.m === 0, "gebruiker verwijderen: factuur blijft, maker wordt leeg", JSON.stringify(inv));
}

// ---------------------------------------------------------------------------------
// 0022: welkomstflow (stap 1)
// ---------------------------------------------------------------------------------
async function welkom0022(db) {
  const sql = lees("supabase/migrations/0022_team_crm.sql");
  await voerUit(db, sql, "0022_team_crm.sql");
  await voerUit(db, sql, "0022_team_crm.sql (2x)");
  const vlag = Object.fromEntries(
    (await db.query("select id, welkom_klaar_op is not null as klaar from public.profiles")).rows.map((r) => [r.id, r.klaar]),
  );
  check(vlag[U.daniel] === true, "0022: eigenaar (Daniel) slaat de welkomstflow over");
  check(vlag[U.mark] === false, "0022: lid (al uitgenodigd vóór 0022) krijgt de welkomstflow");
  let r = await als(db, "mark", "update public.profiles set welkom_klaar_op = now() where id = $1", [U.mark]);
  check(r.ok && r.n === 1, "0022: lid zet zijn eigen welkom-vlag", uitleg(r));
  r = await als(db, "mark", "update public.profiles set welkom_klaar_op = null where id = $1", [U.daniel]);
  check(nietsGeraakt(r), "0022: welkom-vlag van een ander niet te wijzigen", uitleg(r));
  r = await als(db, "mark", "update public.profiles set email = 'x@y.nl', welkom_klaar_op = now() where id = $1", [U.mark]);
  check(geweigerd(r), "0022: andere kolommen (e-mail) blijven dicht", uitleg(r));
  r = await als(db, "indringer", "update public.profiles set welkom_klaar_op = now()");
  check(nietsGeraakt(r), "0022: niet-teamlid zet geen enkele welkom-vlag", uitleg(r));
  r = await als(db, "anon", "update public.profiles set welkom_klaar_op = now()");
  check(nietsGeraakt(r), "0022: anon zet geen enkele welkom-vlag", uitleg(r));
  // Tweede keer uitvoeren zet een lid niet alsnog op klaar (en laat bestaande waarden staan).
  await voerUit(db, sql, "0022_team_crm.sql (3x)");
  const mark = (await db.query("select welkom_klaar_op from public.profiles where id = $1", [U.mark])).rows[0];
  check(mark.welkom_klaar_op === null, "0022: opnieuw uitvoeren raakt de vlag van een lid niet");
}

// ---------------------------------------------------------------------------------
// 0022: wie ziet welke taak en afspraak (stap 2)
// ---------------------------------------------------------------------------------
// Dezelfde regel als de policy, als superuser-SQL (voor verwachte aantallen). $1 = user-id.
function taakZichtbaarSql(t) {
  return `(${t}.created_by = $1 or ${t}.project_id is not null
           or exists (select 1 from public.task_assignees a where a.task_id = ${t}.id and a.user_id = $1))`;
}
function afspraakZichtbaarSql(e) {
  return `(${e}.created_by = $1
           or exists (select 1 from public.event_attendees a where a.event_id = ${e}.id and a.user_id = $1))`;
}

// Alles in één transactie (rollback aan het eind): wisselen van gebruiker met set_config.
async function zichtbaarheid0022(db) {
  const policies = (
    await db.query(
      `select tablename, policyname, qual from pg_policies
       where schemaname = 'public' and cmd = 'SELECT'
         and tablename in ('tasks', 'task_assignees', 'task_subtasks', 'calendar_events', 'event_attendees')`,
    )
  ).rows;
  check(policies.length === 5, "0022: één leesregel per taak-/afspraaktabel", policies.map((p) => `${p.tablename}:${p.policyname}`).join(", "));
  check(policies.every((p) => /is_teamlid\(/.test(p.qual)), "0022: elke leesregel vereist teamlid");
  check(!policies.some((p) => /^teamleden lezen/.test(p.policyname)), "0022: de open leesregels van 0021 zijn weg");

  await db.exec("begin");
  const fouten0 = fouten;
  try {
    await db.exec("set local role authenticated");
    const alsWie = async (wie, sql, params = []) => {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [U[wie]]);
      await db.exec("savepoint s");
      try {
        const r = await db.query(sql, params);
        await db.exec("release savepoint s");
        return { ok: true, rows: r.rows, n: r.affectedRows ?? 0 };
      } catch (e) {
        await db.exec("rollback to savepoint s");
        return { ok: false, code: e.code, msg: e.message };
      }
    };
    const maak = async (wie, taak) => {
      const r = await alsWie(wie, "select public.taak_aanmaken($1::jsonb) as id", [JSON.stringify(taak)]);
      check(r.ok, `0022: ${wie} maakt '${taak.titel}'`, uitleg(r));
      return r.rows?.[0]?.id;
    };
    const ziet = async (wie, id) => {
      const r = await alsWie(
        wie,
        `select (select count(*)::int from public.tasks where id = $1) as t,
                (select count(*)::int from public.task_assignees where task_id = $1) as a,
                (select count(*)::int from public.task_subtasks where task_id = $1) as s`,
        [id],
      );
      return r.ok ? r.rows[0] : { t: -1, a: -1, s: -1, fout: r.msg };
    };
    const lijstVan = async (wie) =>
      (
        await alsWie(
          wie,
          `select t.id from public.tasks t join public.task_assignees a on a.task_id = t.id and a.user_id = $1`,
          [U[wie]],
        )
      ).rows.map((r) => r.id);
    // "Uitgezet": gemaakt door mij, ik sta er niet op (zoals de app-query, met anti-join).
    const uitgezetVan = async (wie) =>
      (
        await alsWie(
          wie,
          `select t.id from public.tasks t where t.created_by = $1
             and not exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = $1)`,
          [U[wie]],
        )
      ).rows.map((r) => r.id);

    const voorMark = await maak("daniel", { titel: "Alleen voor Mark", voorWie: [U.mark], subtaken: ["stap"] });
    const samen = await maak("daniel", { titel: "Voor allebei", voorWie: [U.daniel, U.mark] });
    const vanMark = await maak("mark", { titel: "Privé van Mark", voorWie: [U.mark], subtaken: ["geheim"] });
    const project = await maak("mark", {
      titel: "Projecttaak van Mark",
      voorWie: [U.mark],
      projectId: "dddddddd-0000-4000-8000-000000000001",
    });

    // Daniel → Mark: Mark ziet hem in zijn lijst; Daniel niet in de zijne, wel onder Uitgezet.
    let z = await ziet("mark", voorMark);
    check(z.t === 1 && z.a === 1 && z.s === 1, "0022: Mark ziet de taak die Daniel voor hem maakte (met subtaak)", JSON.stringify(z));
    check((await lijstVan("mark")).includes(voorMark), "0022: staat in Marks eigen lijst");
    check(!(await lijstVan("daniel")).includes(voorMark), "0022: staat NIET in Daniels eigen lijst");
    check((await uitgezetVan("daniel")).includes(voorMark), "0022: staat onder Daniels Uitgezet");
    z = await ziet("daniel", voorMark);
    check(z.t === 1, "0022: Daniel (maker) kan hem openen om op te volgen", JSON.stringify(z));

    // Voor allebei: bij ieder in de lijst, niet onder Uitgezet.
    check((await lijstVan("daniel")).includes(samen) && (await lijstVan("mark")).includes(samen), "0022: taak voor twee staat bij beiden");
    check(!(await uitgezetVan("daniel")).includes(samen), "0022: taak voor twee staat niet onder Uitgezet");

    // Privé van Mark: bestaat voor Daniel niet, ook niet via toewijzingen of subtaken.
    z = await ziet("daniel", vanMark);
    check(z.t === 0 && z.a === 0 && z.s === 0, "0022: Daniel ziet een losse taak van Mark niet (tasks/assignees/subtasks)", JSON.stringify(z));
    let r = await alsWie("daniel", "update public.tasks set title = 'x' where id = $1", [vanMark]);
    check(r.ok && r.n === 0, "0022: … en kan hem niet wijzigen", uitleg(r));
    r = await alsWie("daniel", "select public.taak_zichtbaar($1) as z, public.taak_betrokken($1) as b", [vanMark]);
    check(r.ok && r.rows[0].z === false && r.rows[0].b === false, "0022: taak_zichtbaar/taak_betrokken = false voor Daniel", uitleg(r));

    // Projecttaak: leesbaar voor het team, maar niet in Daniels lijst en niet te wijzigen.
    z = await ziet("daniel", project);
    check(z.t === 1 && z.a === 1, "0022: projecttaak voor het team leesbaar", JSON.stringify(z));
    check(!(await lijstVan("daniel")).includes(project), "0022: projecttaak staat niet in Daniels lijst");
    r = await alsWie("daniel", "update public.tasks set title = 'x' where id = $1", [project]);
    check(r.ok && r.n === 0, "0022: projecttaak van een ander niet te wijzigen", uitleg(r));

    // Mark geeft "Voor allebei" alleen aan Daniel: hij kan het nog (eerst toevoegen, dan
    // zichzelf weghalen) en ziet de taak daarna niet meer (niet de maker, geen project).
    r = await alsWie("mark", "delete from public.task_assignees where task_id = $1 and user_id = $2", [samen, U.mark]);
    check(r.ok && r.n === 1, "0022: Mark haalt zichzelf van een gedeelde taak", uitleg(r));
    z = await ziet("mark", samen);
    check(z.t === 0, "0022: daarna ziet Mark hem niet meer", JSON.stringify(z));
    check((await lijstVan("daniel")).includes(samen), "0022: Daniel houdt hem in zijn lijst");

    // Niet-teamleden zien niets, ook geen projecttaak.
    for (const wie of ["indringer", "oudlid"]) {
      z = await ziet(wie, project);
      check(z.t === 0 && z.a === 0 && z.s === 0, `0022: ${wie} ziet geen projecttaak`, JSON.stringify(z));
    }

    // Afspraken: maker en deelnemers; een ander teamlid niet.
    r = await alsWie("mark", "insert into public.calendar_events (title, starts_at, ends_at) values ('Tandarts', now(), now() + interval '1 hour') returning id");
    check(r.ok, "0022: Mark maakt een afspraak", uitleg(r));
    const afspraak = r.rows?.[0]?.id;
    r = await alsWie("mark", "insert into public.event_attendees (event_id, user_id) values ($1, $2)", [afspraak, U.mark]);
    check(r.ok, "0022: Mark is deelnemer", uitleg(r));
    r = await alsWie("daniel", "select (select count(*)::int from public.calendar_events where id = $1) as e, (select count(*)::int from public.event_attendees where event_id = $1) as a", [afspraak]);
    check(r.ok && r.rows[0].e === 0 && r.rows[0].a === 0, "0022: Daniel ziet Marks afspraak niet", uitleg(r));
    r = await alsWie("mark", "insert into public.event_attendees (event_id, user_id) values ($1, $2)", [afspraak, U.daniel]);
    check(r.ok, "0022: Mark nodigt Daniel uit", uitleg(r));
    r = await alsWie("daniel", "select (select count(*)::int from public.calendar_events where id = $1) as e, (select count(*)::int from public.event_attendees where event_id = $1) as a", [afspraak]);
    check(r.ok && r.rows[0].e === 1 && r.rows[0].a === 2, "0022: als deelnemer ziet Daniel de afspraak en wie er komt", uitleg(r));

    // Stap 4: tellingen in één query. Moeten exact gelijk zijn aan de lijsten (zelfde regels),
    // en tellen niets wat je niet mag zien (Marks privétaak telt niet bij Daniel).
    for (const wie of ["daniel", "mark"]) {
      const rpc = await alsWie(wie, "select * from public.taak_tellingen(current_date)");
      const los = await alsWie(
        wie,
        `select
           (select count(*)::int from public.tasks t join public.task_assignees a on a.task_id = t.id and a.user_id = $1 where t.completed_at is null and t.due_date <= current_date) as vandaag,
           (select count(*)::int from public.tasks t join public.task_assignees a on a.task_id = t.id and a.user_id = $1 where t.completed_at is null and t.due_date < current_date) as telaat,
           (select count(*)::int from public.tasks t join public.task_assignees a on a.task_id = t.id and a.user_id = $1 where t.completed_at is null and t.due_date > current_date) as gepland,
           (select count(*)::int from public.tasks t join public.task_assignees a on a.task_id = t.id and a.user_id = $1 where t.completed_at is null and t.due_date is null) as ooit,
           (select count(*)::int from public.tasks t where t.created_by = $1 and t.completed_at is null
              and not exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = $1)) as uitgezet`,
        [U[wie]],
      );
      check(rpc.ok && los.ok && JSON.stringify(rpc.rows[0]) === JSON.stringify(los.rows[0]), `0022: taak_tellingen voor ${wie} = de losse tellingen`, `${JSON.stringify(rpc.rows?.[0] ?? rpc.msg)} vs ${JSON.stringify(los.rows?.[0] ?? los.msg)}`);
    }
    const dTel = (await alsWie("daniel", "select * from public.taak_tellingen(current_date)")).rows[0];
    check(dTel.uitgezet >= 1, "0022: Daniels taak voor Mark telt als uitgezet", JSON.stringify(dTel));
    const mOoit = (await alsWie("mark", "select ooit from public.taak_tellingen(current_date)")).rows[0].ooit;
    const dZonder = (await alsWie("daniel", "select count(*)::int as n from public.tasks where id = $1", [vanMark])).rows[0].n;
    check(mOoit >= 1 && dZonder === 0, "0022: Marks privétaak telt bij Mark, bestaat niet voor Daniel", `${mOoit}/${dZonder}`);
    let pt = await alsWie("daniel", "select * from public.project_taak_tellingen(array['dddddddd-0000-4000-8000-000000000001']::uuid[])");
    const ptLos = await alsWie("daniel", "select count(*)::int as totaal, (count(*) filter (where completed_at is null))::int as open from public.tasks where project_id = 'dddddddd-0000-4000-8000-000000000001'");
    check(pt.ok && pt.rows.length === 1 && pt.rows[0].totaal === ptLos.rows[0].totaal && pt.rows[0].open === ptLos.rows[0].open && pt.rows[0].totaal >= 1,
      "0022: project_taak_tellingen = de projecttaken die het team ziet", `${JSON.stringify(pt.rows ?? pt.msg)} vs ${JSON.stringify(ptLos.rows)}`);
    pt = await alsWie("daniel", "select * from public.project_taak_tellingen()");
    check(pt.ok && pt.rows.some((r) => r.project_id === "dddddddd-0000-4000-8000-000000000001"), "0022: project_taak_tellingen zonder lijst = alle projecten", uitleg(pt));
    for (const wie of ["indringer", "oudlid"]) {
      const t = await alsWie(wie, "select * from public.taak_tellingen(current_date)");
      check(t.ok && Object.values(t.rows[0]).every((n) => n === 0), `0022: ${wie} telt niets`, JSON.stringify(t.rows?.[0] ?? t.msg));
      const p2 = await alsWie(wie, "select * from public.project_taak_tellingen()");
      check(p2.ok && p2.rows.length === 0, `0022: ${wie} ziet geen projectvoortgang`, uitleg(p2));
    }

    const idx = await alsWie("daniel", "select to_regclass('public.tasks_maker_open_idx') is not null as er");
    check(idx.ok && idx.rows[0].er, "0022: index voor Uitgezet aanwezig", uitleg(idx));
  } finally {
    await db.exec("rollback");
  }
  for (const f of ["taak_tellingen(current_date)", "project_taak_tellingen()"]) {
    const r = await als(db, "anon", `select * from public.${f}`);
    check(geweigerd(r), `0022: anon mag ${f.split("(")[0]} niet aanroepen`, uitleg(r));
  }
  if (fouten === fouten0) console.log("  0022 zichtbaarheid: ok");
}

// ---------------------------------------------------------------------------------
// 0022: klanten & projecten (stap 3)
// ---------------------------------------------------------------------------------
async function crm0022(db) {
  const fouten0 = fouten;
  // Omzetting van de projectstatus en eigenaren voor bestaande projecten (eenmalig).
  const oud = Object.fromEntries(
    (await db.query("select naam, status from public.projects where naam like 'Oud %'")).rows.map((r) => [r.naam, r.status]),
  );
  check(oud["Oud actief"] === "bezig" && oud["Oud archief"] === "afgerond", "0022: projectstatus omgezet (actief→bezig, gearchiveerd→afgerond)", JSON.stringify(oud));
  const eig = Object.fromEntries(
    (await db.query("select p.naam, e.user_id from public.project_eigenaren e join public.projects p on p.id = e.project_id where p.naam like 'Oud %'")).rows.map((r) => [r.naam, r.user_id]),
  );
  check(eig["Oud actief"] === U.mark, "0022: bestaand project krijgt de maker als eigenaar", JSON.stringify(eig));
  check(eig["Oud archief"] === U.daniel, "0022: project zonder maker krijgt de team-eigenaar", JSON.stringify(eig));

  // Opnieuw uitvoeren: een weggehaalde eigenaar komt niet terug, statussen blijven.
  await db.query("delete from public.project_eigenaren where project_id = 'dddddddd-0000-4000-8000-0000000000a1'");
  await voerUit(db, lees("supabase/migrations/0022_team_crm.sql"), "0022_team_crm.sql (na zaaien)");
  const terug = (await db.query("select count(*)::int as n from public.project_eigenaren where project_id = 'dddddddd-0000-4000-8000-0000000000a1'")).rows[0].n;
  check(terug === 0, "0022: opnieuw uitvoeren vult geen eigenaren opnieuw", `${terug}`);
  const nogSteeds = (await db.query("select status from public.projects where naam = 'Oud actief'")).rows[0].status;
  check(nogSteeds === "bezig", "0022: opnieuw uitvoeren laat de status staan", nogSteeds);

  // Klanten: bestaande en nieuwe (zoals via een factuur, zonder de nieuwe kolommen) zijn 'actief'.
  const kl = (await db.query("select status, email, telefoon from public.clients where id = 'aaaaaaaa-0000-4000-8000-000000000001'")).rows[0];
  check(kl.status === "actief" && kl.email === "" && kl.telefoon === "", "0022: bestaande klant: status actief, lege contactvelden", JSON.stringify(kl));
  let r = await als(db, "mark", "insert into public.clients (company_name) values ('Via factuur') returning status");
  check(r.ok && r.rows[0].status === "actief", "0022: klant zonder status (facturen) wordt 'actief'", uitleg(r));
  r = await als(db, "mark", "insert into public.clients (company_name, email, status) values ('Nieuwe lead', 'a@b.nl', 'lead') returning status");
  check(r.ok && r.rows[0].status === "lead", "0022: teamlid maakt een lead", uitleg(r));
  // Lead + factuur → actief (trigger), ook als de factuur de status niet meestuurt.
  // Facturen ontstaan via de RPC (security definer, eigenaar postgres); hier als superuser.
  const leadId = "aaaaaaaa-0000-4000-8000-0000000000c1";
  await db.query("insert into public.clients (id, company_name, status) values ($1, 'Lead met factuur', 'lead')", [leadId]);
  await db.query("insert into public.invoices (invoice_number, year, sequence_number, client_id, client_company_name, line_items, subtotal, revenue_subtotal, vat_amount, total, created_by) values ('26-901', 2026, 901, $1, 'Lead met factuur', '[]'::jsonb, 0, 0, 0, 0, null)", [leadId]);
  const naFactuur = (await db.query("select status from public.clients where id = $1", [leadId])).rows[0].status;
  check(naFactuur === "actief", "0022: lead met een factuur wordt 'actief'", naFactuur);
  await db.query("update public.clients set status = 'lead' where id = $1", [leadId]);
  await voerUit(db, lees("supabase/migrations/0022_team_crm.sql"), "0022_team_crm.sql (lead met factuur)");
  const naHerhaal = (await db.query("select status from public.clients where id = $1", [leadId])).rows[0].status;
  check(naHerhaal === "actief", "0022: bestaande lead met factuur wordt bij uitvoeren 'actief'", naHerhaal);
  // Opruimen: latere tests rekenen op precies één factuur.
  await db.query("delete from public.invoices where invoice_number = '26-901'");
  await db.query("delete from public.clients where id = $1", [leadId]);
  r = await als(db, "mark", "insert into public.clients (company_name, status) values ('Lead zonder factuur', 'lead') returning status");
  check(r.ok && r.rows[0].status === "lead", "0022: lead zonder factuur blijft lead", uitleg(r));
  r = await als(db, "mark", "update public.clients set status = 'kans' where id = 'aaaaaaaa-0000-4000-8000-000000000001'");
  check(!r.ok && r.code === "23514", "0022: onbekende klantstatus geweigerd", uitleg(r));
  r = await als(db, "mark", "update public.projects set status = 'actief' where id = 'dddddddd-0000-4000-8000-000000000001'");
  check(!r.ok && r.code === "23514", "0022: oude projectstatus niet meer te schrijven", uitleg(r));
  r = await als(db, "mark", "update public.projects set status = 'voorbereiding', deadline = '2026-12-01', notitie = repeat('x', 5000) where id = 'dddddddd-0000-4000-8000-000000000001'");
  check(r.ok && r.n === 1, "0022: status, deadline en notitie (5000) wijzigen", uitleg(r));
  r = await als(db, "mark", "update public.projects set notitie = repeat('x', 5001) where id = 'dddddddd-0000-4000-8000-000000000001'");
  check(!r.ok && r.code === "23514", "0022: notitie langer dan 5000 geweigerd", uitleg(r));

  // Klantnotities.
  r = await als(db, "daniel", "insert into public.client_notes (client_id, tekst) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Offerte gestuurd') returning created_by");
  check(r.ok && r.rows[0].created_by === U.daniel, "0022: notitie toevoegen (schrijver = jij)", uitleg(r));
  r = await als(db, "daniel", "insert into public.client_notes (client_id, tekst, created_by) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Namens Mark', $1)", [U.mark]);
  check(geweigerd(r), "0022: notitie namens een ander geweigerd", uitleg(r));
  r = await als(db, "daniel", "insert into public.client_notes (client_id, tekst) values ('aaaaaaaa-0000-4000-8000-000000000001', '   ')");
  check(!r.ok && r.code === "23514", "0022: lege notitie geweigerd", uitleg(r));
  r = await als(db, "daniel", "select count(*)::int as n from public.client_notes where client_id <> 'aaaaaaaa-0000-4000-8000-0000000000f5'");
  check(r.ok && r.rows[0].n === 1, "0022: teamlid leest de notities van het team", uitleg(r));
  r = await als(db, "daniel", "delete from public.client_notes where id = 'eeeeeeee-0000-4000-8000-000000000001'");
  check(nietsGeraakt(r), "0022: notitie van een ander niet te verwijderen", uitleg(r));
  r = await als(db, "mark", "delete from public.client_notes where id = 'eeeeeeee-0000-4000-8000-000000000001'");
  check(r.ok && r.n === 1, "0022: eigen notitie verwijderen", uitleg(r));
  r = await als(db, "mark", "update public.client_notes set tekst = 'Aangepast'");
  check(geweigerd(r), "0022: notities zijn niet te wijzigen", uitleg(r));
  r = await als(db, "service", "select count(*)::int as n from public.client_notes where client_id <> 'aaaaaaaa-0000-4000-8000-0000000000f5'");
  check(r.ok && r.rows[0].n === 1, "0022: service-role leest notities", uitleg(r));

  // Projecteigenaren: alleen actieve teamleden.
  const P = "dddddddd-0000-4000-8000-000000000001";
  r = await als(db, "daniel", "insert into public.project_eigenaren (project_id, user_id) values ($1, $2)", [P, U.mark]);
  check(r.ok && r.n === 1, "0022: teamlid als eigenaar toevoegen", uitleg(r));
  r = await als(db, "daniel", "insert into public.project_eigenaren (project_id, user_id) values ($1, $2)", [P, U.indringer]);
  check(geweigerd(r), "0022: niet-teamlid kan geen eigenaar zijn", uitleg(r));
  r = await als(db, "daniel", "insert into public.project_eigenaren (project_id, user_id) values ($1, $2)", [P, U.oudlid]);
  check(geweigerd(r), "0022: gedeactiveerd lid kan geen eigenaar zijn", uitleg(r));
  r = await als(db, "mark", "delete from public.project_eigenaren where project_id = $1", [P]);
  check(r.ok && r.n === 1, "0022: teamlid haalt een eigenaar weg", uitleg(r));
  r = await als(db, "mark", "update public.project_eigenaren set user_id = $1", [U.mark]);
  check(geweigerd(r), "0022: eigenaren niet te wijzigen (alleen toevoegen/weghalen)", uitleg(r));
  for (const wie of ["indringer", "oudlid", "anon"]) {
    for (const t of ["clients", "client_notes", "project_eigenaren", "projects"]) {
      r = await als(db, wie, `select * from public.${t}`);
      check(leeg(r), `0022: ${wie} ziet niets in ${t}`, uitleg(r));
    }
    r = await als(db, wie, "insert into public.client_notes (client_id, tekst) values ('aaaaaaaa-0000-4000-8000-000000000001', 'x')");
    check(geweigerd(r), `0022: ${wie} kan geen notitie schrijven`, uitleg(r));
  }

  // Policies vereisen een teamlid (de controle uit UITVOEREN_0021_TEAM.sql).
  const pol = (await db.query("select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as q from pg_policies where tablename in ('client_notes', 'project_eigenaren')")).rows;
  check(pol.length === 6 && pol.every((p) => /is_teamlid\(/.test(p.q)), "0022: elke nieuwe policy vereist teamlid", JSON.stringify(pol.map((p) => p.policyname)));
  const idx = (await db.query(
    "select count(*)::int as n from pg_class where relname in ('clients_status_idx', 'client_notes_klant_idx', 'project_eigenaren_user_idx', 'projects_status_idx', 'tasks_client_idx')",
  )).rows[0].n;
  check(idx === 5, "0022: indexen voor klanten & projecten aanwezig", `${idx}`);
  if (fouten === fouten0) console.log("  0022 klanten & projecten: ok");
}

// ---------------------------------------------------------------------------------
// 0023: projectstatus voor het bord
// ---------------------------------------------------------------------------------
async function projectstatus0023(db) {
  const fouten0 = fouten;
  const status = async () =>
    Object.fromEntries((await db.query("select naam, status from public.projects where naam like 'Oud %'")).rows.map((r) => [r.naam, r.status]));
  let st = await status();
  check(st["Oud gepland"] === "voorbereiding" && st["Oud actief"] === "bezig" && st["Oud archief"] === "afgerond", "0023: gepland→voorbereiding, rest blijft", JSON.stringify(st));
  const n = (await db.query("select count(*)::int as n from public.projects where status not in ('voorbereiding', 'bezig', 'wachten', 'afgerond')")).rows[0].n;
  check(n === 0, "0023: alleen nog de vier statussen", `${n}`);
  const def = (await db.query("select column_default from information_schema.columns where table_name = 'projects' and column_name = 'status'")).rows[0].column_default;
  check(/voorbereiding/.test(def ?? ""), "0023: nieuwe projecten standaard 'voorbereiding'", def);

  // status_sinds: bestaande projecten houden hun laatste wijziging (niet het omzetten).
  const G = "dddddddd-0000-4000-8000-0000000000a3";
  const sinds = async (id) => (await db.query("select status_sinds, extract(epoch from now() - status_sinds)::int as s from public.projects where id = $1", [id])).rows[0];
  const s0 = await sinds(G);
  check(s0.s > 4 * 86400, "0023: status_sinds = laatste wijziging vóór het omzetten (5 dagen)", `${s0.s}s`);

  // Als teamlid (RLS): nieuw project, status wijzigen, alleen naam wijzigen.
  let r = await als(db, "mark", "insert into public.projects (naam) values ('Nieuw bord') returning status, extract(epoch from now() - status_sinds)::int as s");
  check(r.ok && r.rows[0].status === "voorbereiding" && r.rows[0].s <= 5, "0023: nieuw project in voorbereiding, sinds nu", uitleg(r));
  r = await als(db, "mark", `update public.projects set status = 'wachten' where id = '${G}' returning extract(epoch from now() - status_sinds)::int as s`);
  check(r.ok && r.n === 1 && r.rows[0].s <= 5, "0023: wachten op goedkeuring kiezen zet status_sinds op nu", uitleg(r));
  r = await als(db, "mark", `update public.projects set naam = 'Oud gepland (hernoemd)' where id = '${G}' returning extract(epoch from now() - status_sinds)::int as s`);
  check(r.ok && r.rows[0].s > 4 * 86400, "0023: andere wijziging laat status_sinds staan", uitleg(r));
  r = await als(db, "mark", `update public.projects set status_sinds = now() - interval '400 days' where id = '${G}' returning extract(epoch from now() - status_sinds)::int as s`);
  check(r.ok && r.rows[0].s < 6 * 86400, "0023: status_sinds is niet met de hand te verzetten", uitleg(r));
  for (const oud of ["gepland", "actief", "gearchiveerd", "klaar"]) {
    r = await als(db, "mark", `update public.projects set status = '${oud}' where id = '${G}'`);
    check(!r.ok && r.code === "23514", `0023: status '${oud}' geweigerd`, uitleg(r));
  }
  for (const wie of ["indringer", "oudlid", "anon"]) {
    r = await als(db, wie, `update public.projects set status = 'afgerond' where id = '${G}'`);
    check(nietsGeraakt(r), `0023: ${wie} wijzigt geen projectstatus`, uitleg(r));
    r = await als(db, wie, "select status_sinds from public.projects");
    check(leeg(r), `0023: ${wie} leest geen status_sinds`, uitleg(r));
  }
  const pol = (await db.query("select coalesce(qual, '') || ' ' || coalesce(with_check, '') as q from pg_policies where tablename = 'projects'")).rows;
  check(pol.length > 0 && pol.every((p) => /is_teamlid\(/.test(p.q)), "0023: policies op projects vereisen nog steeds teamlid", `${pol.length}`);

  // Echt wachten (blijvend) en dan opnieuw uitvoeren: 0022 (los en als bestand) en 0023
  // laten statussen, check en status_sinds staan.
  await db.query(`update public.projects set status = 'wachten' where id = '${G}'`);
  const voor = (await sinds(G)).status_sinds;
  await voerUit(db, lees("supabase/migrations/0022_team_crm.sql"), "0022_team_crm.sql (na 0023)");
  checkControle(await voerUit(db, lees("supabase/UITVOEREN_0022.sql"), "UITVOEREN_0022.sql (na 0023)"), "A: UITVOEREN_0022 na 0023");
  checkControle(await voerUit(db, lees("supabase/UITVOEREN_0023.sql"), "UITVOEREN_0023.sql (3x)"), "A: UITVOEREN_0023 (3e keer)");
  st = await status();
  check(st["Oud gepland"] === "wachten", "0023: opnieuw uitvoeren van 0022/0023 laat 'wachten' staan", JSON.stringify(st));
  const na = (await sinds(G)).status_sinds;
  check(String(na) === String(voor), "0023: opnieuw uitvoeren laat status_sinds staan", `${voor} / ${na}`);
  const def2 = (await db.query("select column_default from information_schema.columns where table_name = 'projects' and column_name = 'status'")).rows[0].column_default;
  check(/voorbereiding/.test(def2 ?? ""), "0023: na opnieuw 0022 blijft de standaard 'voorbereiding'", def2);
  const chk = (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.projects'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'")).rows;
  check(chk.length === 1 && /wachten/.test(chk[0].d), "0023: precies één statuscheck (met wachten)", JSON.stringify(chk));
  const idx = (await db.query("select count(*)::int as n from pg_class where relname in ('projects_status_sinds_idx', 'projects_deadline_idx')")).rows[0].n;
  check(idx === 2, "0023: indexen aanwezig", `${idx}`);
  if (fouten === fouten0) console.log("  0023 projectstatus: ok");
}

// ---------------------------------------------------------------------------------
// 0024: Google Drive
// ---------------------------------------------------------------------------------
async function drive0024(db) {
  const fouten0 = fouten;
  const sql0024 = lees("supabase/UITVOEREN_0024.sql");
  checkControle(await voerUit(db, sql0024, "UITVOEREN_0024.sql"), "A: UITVOEREN_0024 (1e keer)");
  checkControle(await voerUit(db, sql0024, "UITVOEREN_0024.sql (2x)"), "A: UITVOEREN_0024 (2e keer)");
  await voerUit(db, lees("supabase/migrations/0024_drive.sql"), "0024_drive.sql (los, 3x)");

  // Testdata (als superuser = zoals de server met de service-role).
  await db.query(
    `insert into public.drive_koppeling (id, google_email, refresh_token_enc, root_id, gekoppeld_door)
       values (1, 'studio@gmail.com', 'v1:aaa.bbb.ccc', 'root0001', $1)
     on conflict (id) do nothing`,
    [U.daniel],
  );
  await db.exec(`
    insert into public.drive_mappen (root_id, soort, sleutel, drive_id, naam) values
      ('root0001', 'pad', 'Boekhouding/Facturen/2026', 'map00001', '2026'),
      ('root0001', 'klant', 'aaaaaaaa-0000-4000-8000-000000000001', 'map00002', 'Bakkerij')
    on conflict do nothing;
    insert into public.drive_bestanden (drive_file_id, naam, geupload_door, client_id, project_id) values
      ('file00001', 'logo.png', '${U.mark}', 'aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001')
    on conflict do nothing;
    insert into public.drive_kopieen (root_id, bron, bron_id, bron_pad, drive_file_id) values
      ('root0001', 'factuur', '${"cccccccc-0000-4000-8000-000000000001"}', 'x/2026-001.pdf', 'file00002')
    on conflict do nothing;
  `);

  // Het refresh token: voor niemand behalve de service-role.
  for (const wie of ["daniel", "mark", "indringer", "anon"]) {
    let r = await als(db, wie, "select * from public.drive_koppeling");
    check(geweigerd(r), `0024: ${wie} leest drive_koppeling niet`, uitleg(r));
    r = await als(db, wie, "update public.drive_koppeling set root_id = 'gekaapt'");
    check(geweigerd(r), `0024: ${wie} wijzigt drive_koppeling niet`, uitleg(r));
    r = await als(db, wie, "insert into public.drive_koppeling (id, refresh_token_enc, root_id) values (1, 'v1:x', 'x') on conflict (id) do update set root_id = 'x'");
    check(geweigerd(r), `0024: ${wie} schrijft geen eigen koppeling`, uitleg(r));
    r = await als(db, wie, "delete from public.drive_koppeling");
    check(geweigerd(r), `0024: ${wie} verwijdert de koppeling niet`, uitleg(r));
  }
  let r = await als(db, "service", "select refresh_token_enc from public.drive_koppeling");
  check(r.ok && r.rows.length === 1, "0024: service-role leest de koppeling", uitleg(r));

  // Mappen-cache en kopieën: teamleden lezen, alleen de server schrijft.
  r = await als(db, "mark", "select drive_id from public.drive_mappen");
  check(r.ok && r.rows.length === 2, "0024: lid leest de mappen-cache", uitleg(r));
  r = await als(db, "mark", "insert into public.drive_mappen (root_id, soort, sleutel, drive_id) values ('root0001', 'pad', 'Buiten', 'anderedrive')");
  check(geweigerd(r), "0024: lid kan geen map-id als 'binnen de root' laten gelden", uitleg(r));
  r = await als(db, "mark", "update public.drive_mappen set drive_id = 'anderedrive'");
  check(geweigerd(r), "0024: lid wijzigt de mappen-cache niet", uitleg(r));
  r = await als(db, "mark", "select * from public.drive_kopieen");
  check(r.ok && r.rows.length === 1, "0024: lid ziet welke kopieën er zijn", uitleg(r));
  r = await als(db, "mark", "delete from public.drive_kopieen");
  check(geweigerd(r), "0024: lid wist de kopie-administratie niet", uitleg(r));
  // Uploadregistratie: teamleden.
  r = await als(db, "mark", "insert into public.drive_bestanden (drive_file_id, naam) values ('file00003', 'brief.pdf') returning geupload_door");
  check(r.ok && r.rows[0].geupload_door === U.mark, "0024: lid registreert een upload (door = zichzelf)", uitleg(r));
  r = await als(db, "indringer", "insert into public.drive_bestanden (drive_file_id, naam) values ('file00004', 'x')");
  check(geweigerd(r), "0024: niet-teamlid registreert niets", uitleg(r));
  r = await als(db, "mark", "insert into public.drive_mappen (root_id, soort, sleutel, drive_id) values ('root0001', 'onzin', 'x', 'y')");
  check(!r.ok, "0024: onbekende soort geweigerd", uitleg(r));
  // Klant weg: de registratie blijft (klant leeg), het bestand in Drive blijft staan.
  await db.exec("begin");
  await db.exec(`
    insert into public.clients (id, company_name) values ('aaaaaaaa-0000-4000-8000-0000000000ff', 'Weg BV');
    insert into public.drive_bestanden (drive_file_id, naam, client_id) values ('file00099', 'x', 'aaaaaaaa-0000-4000-8000-0000000000ff');
    delete from public.clients where id = 'aaaaaaaa-0000-4000-8000-0000000000ff';
  `);
  const na = (await db.query("select client_id from public.drive_bestanden where drive_file_id = 'file00099'")).rows[0];
  await db.exec("rollback");
  check(na && na.client_id === null, "0024: klant verwijderen laat de uploadregistratie staan", JSON.stringify(na));
  // Policies: alleen teamleden; drive_koppeling zonder policies.
  const pol = (await db.query("select tablename, qual, with_check from pg_policies where tablename like 'drive_%'")).rows;
  check(pol.length === 3 && pol.every((p) => /is_teamlid\(/.test(`${p.qual} ${p.with_check}`)), "0024: drive-policies vereisen teamlid", JSON.stringify(pol.map((p) => p.tablename)));
  check(!pol.some((p) => p.tablename === "drive_koppeling"), "0024: drive_koppeling zonder policies");
  // De drive-tabellen raken geen buckets en geen factuurtabellen.
  const m24 = lees("supabase/migrations/0024_drive.sql").replace(/--[^\n]*/g, "");
  check(!/storage\.|invoices|quotes|expenses/.test(m24), "0024: geen buckets of facturen/uitgaven aangeraakt");
  if (fouten === fouten0) console.log("  0024 drive: ok");
}

// ---------------------------------------------------------------------------------
// 0025: opvolgen van leads en klanten
// ---------------------------------------------------------------------------------
async function opvolging0025(db) {
  const fouten0 = fouten;
  const sql0025 = lees("supabase/UITVOEREN_0025.sql");
  checkControle(await voerUit(db, sql0025, "UITVOEREN_0025.sql"), "A: UITVOEREN_0025 (1e keer)");
  checkControle(await voerUit(db, sql0025, "UITVOEREN_0025.sql (2x)"), "A: UITVOEREN_0025 (2e keer)");
  await voerUit(db, lees("supabase/migrations/0025_crm_opvolging.sql"), "0025_crm_opvolging.sql (los, 3x)");

  const K = "aaaaaaaa-0000-4000-8000-0000000000f5";
  // Bestaande notities worden 'notitie'.
  const oud = (await db.query("select soort from public.client_notes where tekst = 'Oude notitie'")).rows[0];
  check(oud?.soort === "notitie", "0025: bestaande notitie krijgt soort 'notitie'", JSON.stringify(oud));
  const anders = (await db.query("select count(*)::int as n from public.client_notes where soort <> 'notitie'")).rows[0].n;
  check(anders === 0, "0025: geen bestaande notitie als 'status' gemarkeerd", `${anders}`);

  // Teamlid: volgende stap + opvolgdatum zetten, statusregel schrijven.
  let r = await als(db, "mark", `update public.clients set volgende_stap = 'Offerte nabellen', opvolgen_op = current_date + 3 where id = '${K}' returning volgende_stap, opvolgen_op`);
  check(r.ok && r.n === 1 && r.rows[0].volgende_stap === "Offerte nabellen", "0025: teamlid zet volgende stap en opvolgdatum", uitleg(r));
  r = await als(db, "mark", `update public.clients set volgende_stap = repeat('x', 201) where id = '${K}'`);
  check(!r.ok && r.code === "23514", "0025: volgende stap langer dan 200 tekens geweigerd", uitleg(r));
  r = await als(db, "mark", `insert into public.client_notes (client_id, tekst, soort) values ('${K}', 'Lead → Actief', 'status') returning created_by, soort`);
  check(r.ok && r.rows[0].created_by === U.mark && r.rows[0].soort === "status", "0025: teamlid schrijft een statusregel (door = zichzelf)", uitleg(r));
  r = await als(db, "mark", `insert into public.client_notes (client_id, tekst, soort) values ('${K}', 'x', 'onzin')`);
  check(!r.ok && r.code === "23514", "0025: onbekende notitiesoort geweigerd", uitleg(r));
  r = await als(db, "mark", `insert into public.client_notes (client_id, tekst, soort, created_by) values ('${K}', 'x', 'status', '${U.daniel}')`);
  check(geweigerd(r), "0025: statusregel op naam van een ander geweigerd (RLS ongewijzigd)", uitleg(r));
  r = await als(db, "mark", "update public.client_notes set soort = 'status'");
  check(geweigerd(r) || nietsGeraakt(r), "0025: notities blijven onwijzigbaar", uitleg(r));

  // Niet-teamleden: niets lezen of wijzigen.
  for (const wie of ["indringer", "anon"]) {
    r = await als(db, wie, "select volgende_stap, opvolgen_op from public.clients");
    check(leeg(r), `0025: ${wie} leest geen opvolging`, uitleg(r));
    r = await als(db, wie, "update public.clients set opvolgen_op = current_date");
    check(nietsGeraakt(r), `0025: ${wie} wijzigt geen opvolgdatum`, uitleg(r));
    r = await als(db, wie, `insert into public.client_notes (client_id, tekst, soort) values ('${K}', 'x', 'status')`);
    check(geweigerd(r) || (!r.ok), `0025: ${wie} schrijft geen statusregel`, uitleg(r));
  }

  // Opnieuw 0022 (los) na 0025: kolommen en waarden blijven staan.
  await db.query(`update public.clients set volgende_stap = 'Blijft', opvolgen_op = '2026-11-02' where id = '${K}'`);
  await voerUit(db, lees("supabase/migrations/0022_team_crm.sql"), "0022_team_crm.sql (na 0025)");
  checkControle(await voerUit(db, sql0025, "UITVOEREN_0025.sql (3x)"), "A: UITVOEREN_0025 (3e keer)");
  const na = (await db.query(`select volgende_stap, opvolgen_op::text as d from public.clients where id = '${K}'`)).rows[0];
  check(na.volgende_stap === "Blijft" && na.d === "2026-11-02", "0025: opnieuw uitvoeren laat opvolging staan", JSON.stringify(na));
  const pol = (await db.query("select qual, with_check from pg_policies where tablename in ('clients', 'client_notes')")).rows;
  check(pol.length > 0 && pol.every((p) => /is_teamlid\(/.test(`${p.qual} ${p.with_check}`)), "0025: policies op clients/client_notes vereisen nog steeds teamlid", `${pol.length}`);
  const m25 = lees("supabase/migrations/0025_crm_opvolging.sql").replace(/--[^\n]*/g, "");
  check(!/policy|grant |drop table|drop column|invoices|quotes|storage\./i.test(m25), "0025: geen policies, grants, facturen of buckets aangeraakt");
  if (fouten === fouten0) console.log("  0025 opvolgen: ok");
}

// ---------------------------------------------------------------------------------
// 0026 deel 1: meerdere mailboxen
// ---------------------------------------------------------------------------------
async function mailboxen0026(db) {
  const fouten0 = fouten;
  const m26 = lees("supabase/migrations/0026_beveiliging_mailboxen_backups.sql");
  check((await db.query("select to_regclass('public.mailboxen') as t")).rows[0].t === null, "vóór 0026: tabel mailboxen bestaat nog niet");
  await voerUit(db, m26, "0026 (1e keer)");
  await voerUit(db, m26, "0026 (2e keer)");

  let rijen = (await db.query("select eigenaar_id, email, label, kleur, zichtbaarheid, wachtwoord_enc from public.mailboxen")).rows;
  check(rijen.length === 1, "0026: bestaande koppeling één keer overgezet (ook na 2x uitvoeren)", `${rijen.length}`);
  const oud = (await db.query("select wachtwoord_enc from public.user_mailboxes where user_id = $1", [U.daniel])).rows[0];
  check(
    rijen[0]?.eigenaar_id === U.daniel && rijen[0]?.wachtwoord_enc === oud?.wachtwoord_enc && rijen[0]?.zichtbaarheid === "prive",
    "0026: zelfde eigenaar en ciphertext (AAD = eigenaar_id blijft geldig), standaard privé",
    JSON.stringify(rijen[0])
  );
  check(rijen[0]?.label === "Daniel" && /^#[0-9a-f]{6}$/.test(rijen[0]?.kleur ?? ""), "0026: label uit het adres en een geldige kleur", JSON.stringify(rijen[0]));

  // Een tweede (gedeelde) inbox voor Daniel en een privé-inbox voor Mark.
  await db.exec(`
    insert into public.mailboxen (eigenaar_id, email, label, kleur, zichtbaarheid, wachtwoord_enc)
      values ('${U.daniel}', 'info@studio-levant.nl', 'Info', '#d39a7a', 'team', 'v1:aaa.bbb.ccc'),
             ('${U.mark}', 'mark@studio-levant.nl', 'Mark', '#a9b38f', 'prive', 'v1:ddd.eee.fff');
  `);
  // Ontkoppeld in de app (rij weg) en daarna 0026 opnieuw: niet terug zolang user_mailboxes
  // ook weg is (zo ruimt de app op); dubbel hetzelfde adres kan niet.
  await db.exec(`delete from public.mailboxen where eigenaar_id = '${U.daniel}' and lower(email) = 'daniel@studio-levant.nl';
                 delete from public.user_mailboxes where user_id = '${U.daniel}';`);
  await voerUit(db, m26, "0026 (3e keer)");
  rijen = (await db.query("select email from public.mailboxen order by email")).rows;
  check(rijen.map((r) => r.email).join(",") === "info@studio-levant.nl,mark@studio-levant.nl", "0026: opnieuw uitvoeren zet een ontkoppelde inbox niet terug", rijen.map((r) => r.email).join(","));
  let r = await db.query(`insert into public.mailboxen (eigenaar_id, email, label, wachtwoord_enc) values ('${U.daniel}', 'INFO@studio-levant.nl', 'X', 'v1:a') on conflict do nothing returning id`);
  check(r.rows.length === 0, "0026: hetzelfde adres (andere hoofdletters) niet twee keer per eigenaar");
  for (const [kolom, waarde] of [["kleur", "'rood'"], ["zichtbaarheid", "'iedereen'"], ["label", "''"], ["wachtwoord_enc", "'geheim'"]]) {
    r = await als(db, "service", `update public.mailboxen set ${kolom} = ${waarde} where email = 'info@studio-levant.nl'`);
    check(!r.ok && r.code === "23514", `0026: ongeldige ${kolom} geweigerd`, uitleg(r));
  }

  // Niemand behalve de service-role: ook een gedeelde inbox is via de API onleesbaar (de
  // server filtert en geeft geen wachtwoorden door).
  for (const wie of ["daniel", "mark", "indringer", "anon"]) {
    r = await als(db, wie, "select * from public.mailboxen");
    check(geweigerd(r), `0026: ${wie} leest mailboxen niet`, uitleg(r));
    r = await als(db, wie, `insert into public.mailboxen (eigenaar_id, email, label, wachtwoord_enc) values ('${U[wie] ?? U.daniel}', 'x@x.nl', 'X', 'v1:a')`);
    check(geweigerd(r), `0026: ${wie} schrijft geen mailbox`, uitleg(r));
    r = await als(db, wie, "update public.mailboxen set zichtbaarheid = 'team'");
    check(geweigerd(r), `0026: ${wie} wijzigt geen mailbox`, uitleg(r));
    r = await als(db, wie, "delete from public.mailboxen");
    check(geweigerd(r), `0026: ${wie} verwijdert geen mailbox`, uitleg(r));
  }
  r = await als(db, "service", "select count(*)::int as n from public.mailboxen");
  check(r.ok && r.rows[0].n === 2, "0026: service-role leest mailboxen", uitleg(r));
  const pol = (await db.query("select count(*)::int as n from pg_policies where tablename = 'mailboxen'")).rows[0].n;
  check(pol === 0, "0026: mailboxen zonder policies", `${pol}`);
  const rls = (await db.query("select relrowsecurity as r from pg_class where oid = 'public.mailboxen'::regclass")).rows[0].r;
  check(rls === true, "0026: RLS aan op mailboxen");

  // Een gebruiker verwijderen ruimt zijn inboxen op (on delete cascade).
  const n0 = (await db.query(`select count(*)::int as n from public.mailboxen where eigenaar_id = '${U.mark}'`)).rows[0].n;
  check(n0 === 1, "0026: Mark heeft één inbox");
  // Voor de toegangsmatrix hierna: de oude rij weer terug (code vóór 0026 blijft werken).
  await db.query("insert into public.user_mailboxes (user_id, email, wachtwoord_enc) values ($1, 'daniel@studio-levant.nl', $2)", [U.daniel, oud.wachtwoord_enc]);
  if (fouten === fouten0) console.log("  0026 mailboxen: ok");
}

// ---------------------------------------------------------------------------------
// 0026 deel 3: back-ups en keep-alive
// ---------------------------------------------------------------------------------
async function backups0026(db) {
  const fouten0 = fouten;
  const m26 = lees("supabase/migrations/0026_beveiliging_mailboxen_backups.sql");
  // Service-role schrijft (zoals de cron en de knop).
  let r = await als(db, "service", "insert into public.heartbeat (bron) values ('cron'), ('github') returning id");
  check(r.ok && r.rows.length === 2, "heartbeat: service-role schrijft", uitleg(r));
  r = await als(db, "service", "insert into public.heartbeat (bron) values ('iemand')");
  check(!r.ok && r.code === "23514", "heartbeat: alleen bekende bronnen", uitleg(r));
  r = await als(
    db,
    "service",
    "insert into public.backup_runs (soort, bron, status, bestand, grootte, sha256, sleutel_id, tellingen) values ('db', 'cron', 'ok', '2026-10-24.slbak', 1234, repeat('a', 64), '0123456789abcdef', '{\"tabellen\":{\"clients\":2}}') returning id",
  );
  check(r.ok, "backup_runs: service-role schrijft", uitleg(r));
  r = await als(db, "service", "insert into public.backup_runs (soort, status) values ('db', 'half')");
  check(!r.ok && r.code === "23514", "backup_runs: onbekende status geweigerd", uitleg(r));
  r = await als(db, "service", "insert into public.backup_runs (soort, sha256) values ('db', 'geen-hash')");
  check(!r.ok && r.code === "23514", "backup_runs: sha256 moet hex zijn", uitleg(r));
  r = await als(db, "service", "insert into public.backup_bestanden (bucket, pad, grootte, etag, drive_id) values ('invoices', '2026/F-001.pdf', 1000, 'e1', 'drive123')");
  check(r.ok, "backup_bestanden: service-role schrijft", uitleg(r));
  // als() draait in een transactie die wordt teruggedraaid: nu echte testdata (ook voor de matrix).
  await db.exec(`insert into public.heartbeat (bron) values ('cron'), ('github');
    insert into public.backup_runs (soort, bron, status, bestand, grootte) values ('db', 'cron', 'ok', '2026-10-24.slbak', 1234);
    insert into public.backup_bestanden (bucket, pad, grootte, etag, drive_id) values ('invoices', '2026/F-001.pdf', 1000, 'e1', 'drive123');`);

  // Lezen: alleen de eigenaar (met 2FA-sessie als hij een factor heeft); backup_bestanden niemand.
  for (const t of ["backup_runs", "heartbeat"]) {
    r = await alsMetAal(db, "daniel", "aal2", `select count(*)::int as n from public.${t}`);
    check(r.ok && r.rows[0].n > 0, `${t}: eigenaar leest`, uitleg(r));
    r = await als(db, "mark", `select count(*)::int as n from public.${t}`);
    check(r.ok && r.rows[0].n === 0, `${t}: lid leest niets`, uitleg(r));
    for (const wie of ["daniel", "mark", "indringer"]) {
      r = await als(db, wie, `insert into public.${t} (${t === "heartbeat" ? "bron" : "soort"}) values ('${t === "heartbeat" ? "cron" : "db"}')`);
      check(geweigerd(r), `${t}: ${wie} schrijft niets via de API`, uitleg(r));
      r = await als(db, wie, `delete from public.${t}`);
      check(geweigerd(r) || nietsGeraakt(r), `${t}: ${wie} verwijdert niets`, uitleg(r));
    }
    r = await als(db, "anon", `select * from public.${t}`);
    check(geweigerd(r), `${t}: anon leest niets`, uitleg(r));
  }
  await db.query("insert into auth.mfa_factors (user_id, friendly_name, status) values ($1, 'Telefoon', 'verified')", [U.daniel]);
  r = await alsMetAal(db, "daniel", "aal1", "select count(*)::int as n from public.backup_runs");
  check(r.ok && r.rows[0].n === 0, "backup_runs: eigenaar met factor op aal1 leest niets", uitleg(r));
  r = await alsMetAal(db, "daniel", "aal1", "select count(*)::int as n from public.heartbeat");
  check(r.ok && r.rows[0].n === 0, "heartbeat: eigenaar met factor op aal1 leest niets", uitleg(r));
  await db.query("delete from auth.mfa_factors where user_id = $1", [U.daniel]);
  for (const wie of ["daniel", "mark", "indringer", "anon"]) {
    r = await als(db, wie, "select * from public.backup_bestanden");
    check(geweigerd(r), `backup_bestanden: ${wie} leest niets`, uitleg(r));
  }
  const pol = (await db.query("select count(*)::int as n from pg_policies where tablename = 'backup_bestanden'")).rows[0].n;
  check(pol === 0, "backup_bestanden: geen policies", `${pol}`);

  // backup_tabellen(): alleen de service-role; geeft de public-tabellen.
  r = await als(db, "service", "select public.backup_tabellen() as t");
  const namen = r.ok ? r.rows.map((x) => x.t) : [];
  check(namen.includes("clients") && namen.includes("backup_runs") && namen.includes("inlog_pogingen"), "backup_tabellen: service-role krijgt de tabellen", uitleg(r));
  for (const wie of ["daniel", "mark", "anon"]) {
    r = await als(db, wie, "select public.backup_tabellen()");
    check(geweigerd(r), `backup_tabellen: niet voor ${wie}`, uitleg(r));
  }
  // De vaste exportlijst dekt alle tabellen (behalve inlog_pogingen).
  const kern = lees("lib/backup/formaat-kern.ts");
  const ontbreekt = namen.filter((n) => n !== "inlog_pogingen" && !kern.includes(`naam: '${n}'`));
  check(ontbreekt.length === 0, "exportlijst (lib/backup/formaat-kern.ts) bevat elke tabel", ontbreekt.join(","));

  // Twee keer uitvoeren: gegevens blijven, niets dubbel.
  const voor = (await db.query("select (select count(*) from public.backup_runs) + (select count(*) from public.heartbeat) + (select count(*) from public.backup_bestanden) as n")).rows[0].n;
  await voerUit(db, m26, "0026 (7e keer, met back-ups)");
  const na = (await db.query("select (select count(*) from public.backup_runs) + (select count(*) from public.heartbeat) + (select count(*) from public.backup_bestanden) as n")).rows[0].n;
  check(String(voor) === String(na), "0026 opnieuw: back-upgegevens ongemoeid", `${voor} → ${na}`);
  if (fouten === fouten0) console.log("  0026 back-ups en heartbeat: ok");
}

// ---------------------------------------------------------------------------------
// 0026 deel 2: 2FA in RLS, toegang_status, audit-log, inlogpogingen
// ---------------------------------------------------------------------------------
async function beveiliging0026(db) {
  const fouten0 = fouten;
  const m26 = lees("supabase/migrations/0026_beveiliging_mailboxen_backups.sql");
  const telKlanten = (r) => (r.ok ? r.rows[0].n : -1);
  const KLANTEN = "select count(*)::int as n from public.clients";
  const totaal = (await db.query(KLANTEN)).rows[0].n;
  check(totaal > 0, "2FA: er zijn klanten om mee te testen");

  // Zonder factor: gewoon toegang (niemand buitengesloten), op aal1 en zonder aal-claim.
  let r = await alsMetAal(db, "daniel", "aal1", KLANTEN);
  check(telKlanten(r) === totaal, "2FA: zonder factor ziet een teamlid alles (aal1)", uitleg(r));
  r = await als(db, "mark", KLANTEN);
  check(r.ok && r.rows[0].n === totaal, "2FA: zonder factor en zonder aal-claim ook", uitleg(r));

  // Een onbevestigde factor telt niet.
  await db.query("insert into auth.mfa_factors (user_id, friendly_name, status) values ($1, 'Half', 'unverified')", [U.daniel]);
  r = await alsMetAal(db, "daniel", "aal1", KLANTEN);
  check(telKlanten(r) === totaal, "2FA: onbevestigde factor telt niet mee", uitleg(r));

  // Wel een factor: op aal1 (alleen wachtwoord) NIETS, op aal2 alles.
  await db.query("insert into auth.mfa_factors (user_id, friendly_name, status) values ($1, 'Telefoon', 'verified')", [U.daniel]);
  r = await alsMetAal(db, "daniel", "aal1", KLANTEN);
  check(telKlanten(r) === 0, "2FA: met factor op aal1 leest RLS niets (gestolen wachtwoord geeft niets)", uitleg(r));
  r = await als(db, "daniel", KLANTEN);
  check(r.ok && r.rows[0].n === 0, "2FA: met factor en zonder aal-claim ook niets", uitleg(r));
  r = await alsMetAal(db, "daniel", "aal1", "select count(*)::int as n from public.invoices");
  check(r.ok && r.rows[0].n === 0, "2FA: met factor op aal1 geen facturen", uitleg(r));
  r = await alsMetAal(db, "daniel", "aal1", "select count(*)::int as n from storage.objects where bucket_id = 'invoices'");
  check(r.ok && r.rows[0].n === 0, "2FA: met factor op aal1 geen factuur-pdf's", uitleg(r));
  r = await alsMetAal(db, "daniel", "aal1", "insert into public.clients (company_name) values ('Via gestolen wachtwoord')");
  check(!r.ok, "2FA: met factor op aal1 niets schrijven", uitleg(r));
  r = await alsMetAal(db, "daniel", "aal2", KLANTEN);
  check(telKlanten(r) === totaal, "2FA: met factor op aal2 alles", uitleg(r));
  // Eigen lidmaatschap blijft leesbaar (de app ziet "lid, eerst de code").
  r = await alsMetAal(db, "daniel", "aal1", "select user_id from public.team_members where user_id = $1", [U.daniel]);
  check(r.ok && r.rows.length === 1, "2FA: op aal1 eigen lidmaatschap nog leesbaar", uitleg(r));

  // toegang_status: lidmaatschap + aal + factor in één keer.
  r = await alsMetAal(db, "daniel", "aal1", "select public.toegang_status() as s");
  let st = r.ok ? r.rows[0].s : null;
  check(st && st.lid === true && st.rol === "eigenaar" && st.aal === "aal1" && st.heeft_factor === true && st.tfa_rls === true && st.versie === 26, "toegang_status: eigenaar op aal1 met factor", JSON.stringify(st ?? r));
  r = await alsMetAal(db, "mark", "aal1", "select public.toegang_status() as s");
  st = r.ok ? r.rows[0].s : null;
  check(st && st.lid === true && st.rol === "lid" && st.heeft_factor === false, "toegang_status: lid zonder factor", JSON.stringify(st ?? r));
  r = await als(db, "indringer", "select public.toegang_status() as s");
  check(r.ok && r.rows[0].s.lid === false && r.rows[0].s.rol === null, "toegang_status: niet-lid krijgt lid=false", uitleg(r));
  r = await als(db, "oudlid", "select public.toegang_status() as s");
  check(r.ok && r.rows[0].s.lid === false, "toegang_status: gedeactiveerd lid krijgt lid=false", uitleg(r));
  r = await als(db, "anon", "select public.toegang_status()");
  check(geweigerd(r), "toegang_status: niet uitvoerbaar voor anon", uitleg(r));
  r = await als(db, "indringer", "select count(*)::int as n from auth.mfa_factors");
  check(geweigerd(r), "auth.mfa_factors niet direct leesbaar voor authenticated", uitleg(r));

  // is_eigenaar
  r = await alsMetAal(db, "daniel", "aal2", "select public.is_eigenaar() as e");
  check(r.ok && r.rows[0].e === true, "is_eigenaar: eigenaar op aal2", uitleg(r));
  r = await alsMetAal(db, "daniel", "aal1", "select public.is_eigenaar() as e");
  check(r.ok && r.rows[0].e === false, "is_eigenaar: eigenaar met factor op aal1 niet", uitleg(r));
  r = await als(db, "mark", "select public.is_eigenaar() as e");
  check(r.ok && r.rows[0].e === false, "is_eigenaar: lid niet", uitleg(r));

  // Streng: wie geen factor heeft, ziet ook niets. Daarna weer uit.
  await db.exec("update public.app_instellingen set tfa_rls_streng = true where id = 1");
  r = await als(db, "mark", KLANTEN);
  check(r.ok && r.rows[0].n === 0, "streng: lid zonder factor ziet niets", uitleg(r));
  r = await alsMetAal(db, "daniel", "aal2", KLANTEN);
  check(telKlanten(r) === totaal, "streng: lid met factor op aal2 ziet alles", uitleg(r));
  await db.exec("update public.app_instellingen set tfa_rls_streng = false where id = 1");

  // Noodstop: 2FA telt even niet mee. Opnieuw 0026 uitvoeren zet hem NIET terug.
  await db.exec("update public.app_instellingen set tfa_rls = false where id = 1");
  r = await alsMetAal(db, "daniel", "aal1", KLANTEN);
  check(telKlanten(r) === totaal, "noodstop: met factor op aal1 weer toegang", uitleg(r));
  await voerUit(db, m26, "0026 (4e keer, met noodstop)");
  const inst = (await db.query("select tfa_rls, tfa_rls_streng from public.app_instellingen")).rows;
  check(inst.length === 1 && inst[0].tfa_rls === false, "0026 opnieuw: schakelaars blijven staan (één rij)", JSON.stringify(inst));
  await db.exec("update public.app_instellingen set tfa_rls = true where id = 1");
  r = await alsMetAal(db, "daniel", "aal1", KLANTEN);
  check(telKlanten(r) === 0, "noodstop uit: met factor op aal1 weer niets", uitleg(r));

  // Zonder rij app_instellingen: veilige standaard (2FA telt, niet streng).
  await db.exec("delete from public.app_instellingen");
  r = await alsMetAal(db, "daniel", "aal1", KLANTEN);
  check(telKlanten(r) === 0, "zonder instellingen: 2FA telt (standaard)", uitleg(r));
  r = await als(db, "mark", KLANTEN);
  check(r.ok && r.rows[0].n === totaal, "zonder instellingen: zonder factor niet buitengesloten", uitleg(r));
  await voerUit(db, m26, "0026 (5e keer)");
  check((await db.query("select count(*)::int as n from public.app_instellingen")).rows[0].n === 1, "0026 opnieuw: instellingen-rij terug");

  // app_instellingen: teamleden lezen, niemand schrijft (behalve de service-role).
  r = await als(db, "mark", "select tfa_rls from public.app_instellingen");
  check(r.ok && r.rows.length === 1, "app_instellingen: teamlid leest", uitleg(r));
  r = await als(db, "mark", "update public.app_instellingen set tfa_rls = false");
  check(nietsGeraakt(r), "app_instellingen: teamlid zet de noodstop niet", uitleg(r));
  r = await alsMetAal(db, "daniel", "aal2", "update public.app_instellingen set tfa_rls = false");
  check(nietsGeraakt(r), "app_instellingen: ook de eigenaar niet via de API", uitleg(r));
  r = await als(db, "service", "update public.app_instellingen set tfa_rls = true returning tfa_rls");
  check(r.ok && r.n === 1, "app_instellingen: service-role schrijft", uitleg(r));

  // ---- audit_log ----
  r = await als(db, "service", "insert into public.audit_log (user_id, actie, doel, details, ip_hash, ua) values ($1, 'inloggen', null, '{\"methode\":\"wachtwoord\"}', 'abcd', 'test') returning id", [U.daniel]);
  check(r.ok, "audit: service-role voegt toe", uitleg(r));
  await db.exec(`insert into public.audit_log (user_id, actie, details) values ('${U.daniel}', 'inloggen', '{"methode":"wachtwoord"}')`);
  await db.exec(`insert into public.audit_log (op, user_id, actie) values (now() - interval '500 days', '${U.mark}', 'inloggen'),
                                                                         (now() - interval '10 days', '${U.mark}', 'uitloggen')`);
  r = await als(db, "service", "insert into public.audit_log (actie) values ('Ongeldig!')");
  check(!r.ok && r.code === "23514", "audit: ongeldige actie geweigerd", uitleg(r));
  r = await als(db, "service", "insert into public.audit_log (actie, details) values ('x_y', '[1,2]')");
  check(!r.ok && r.code === "23514", "audit: details moet een object zijn", uitleg(r));
  r = await alsMetAal(db, "daniel", "aal2", "select count(*)::int as n from public.audit_log");
  check(r.ok && r.rows[0].n === 3, "audit: eigenaar (aal2) leest", uitleg(r));
  r = await alsMetAal(db, "daniel", "aal1", "select count(*)::int as n from public.audit_log");
  check(r.ok && r.rows[0].n === 0, "audit: eigenaar met factor op aal1 leest niets", uitleg(r));
  for (const wie of ["mark", "indringer", "oudlid"]) {
    r = await als(db, wie, "select count(*)::int as n from public.audit_log");
    check(r.ok && r.rows[0].n === 0, `audit: ${wie} leest niets`, uitleg(r));
    r = await als(db, wie, "insert into public.audit_log (actie) values ('nep')");
    check(geweigerd(r), `audit: ${wie} schrijft niets`, uitleg(r));
  }
  r = await als(db, "anon", "select * from public.audit_log");
  check(geweigerd(r), "audit: anon leest niets", uitleg(r));
  for (const wie of ["daniel", "service"]) {
    r = wie === "daniel" ? await alsMetAal(db, wie, "aal2", "update public.audit_log set actie = 'gewist'") : await als(db, wie, "update public.audit_log set actie = 'gewist'");
    check(geweigerd(r) || nietsGeraakt(r), `audit: ${wie} wijzigt niets`, uitleg(r));
    r = wie === "daniel" ? await alsMetAal(db, wie, "aal2", "delete from public.audit_log") : await als(db, wie, "delete from public.audit_log");
    check(geweigerd(r) || nietsGeraakt(r), `audit: ${wie} verwijdert niets`, uitleg(r));
  }
  // Zelfs de eigenaar van de tabel (SQL Editor) niet: de trigger blokkeert.
  let blok = null;
  try {
    await db.exec("update public.audit_log set actie = 'gewist'");
  } catch (e) {
    blok = e.code;
  }
  check(blok === "42501", "audit: trigger blokkeert wijzigen, ook voor de tabeleigenaar", String(blok));
  blok = null;
  try {
    await db.exec("delete from public.audit_log");
  } catch (e) {
    blok = e.code;
  }
  check(blok === "42501", "audit: trigger blokkeert verwijderen, ook voor de tabeleigenaar", String(blok));
  blok = null;
  try {
    await db.exec("truncate public.audit_log");
  } catch (e) {
    blok = e.code;
  }
  check(blok === "42501", "audit: trigger blokkeert truncate", String(blok));
  r = await als(db, "mark", "select public.audit_opruimen(0)");
  check(geweigerd(r), "audit: opruimen niet voor teamleden", uitleg(r));
  // Echt uitvoeren (niet terugdraaien) als service-role.
  await db.exec("set role service_role");
  const opgeruimd = (await db.query("select public.audit_opruimen(10) as n")).rows[0].n;
  await db.exec("reset role");
  check(opgeruimd === 1, "audit: opruimen (service) verwijdert alleen regels ouder dan 90 dagen (minimum)", `${opgeruimd}`);
  const over = (await db.query("select count(*)::int as n from public.audit_log")).rows[0].n;
  check(over === 2, "audit: recente regels blijven staan", `${over}`);
  blok = null;
  try {
    await db.exec("delete from public.audit_log");
  } catch (e) {
    blok = e.code;
  }
  check(blok === "42501", "audit: na opruimen is de blokkade weer actief", String(blok));
  const pol = (await db.query("select qual from pg_policies where tablename = 'audit_log'")).rows;
  check(pol.length === 1 && /is_teamlid\(/.test(pol[0].qual) && /is_eigenaar\(/.test(pol[0].qual), "audit: één policy (teamlid + eigenaar)", JSON.stringify(pol));

  // ---- inlog_pogingen ----
  r = await als(db, "service", "insert into public.inlog_pogingen (sleutel) values ('e:0123456789abcdef0123456789abcdef') returning id");
  check(r.ok, "pogingen: service-role voegt toe", uitleg(r));
  await db.exec("insert into public.inlog_pogingen (sleutel) values ('i:0123456789abcdef0123456789abcdef')");
  r = await als(db, "service", "insert into public.inlog_pogingen (sleutel) values ('jan@example.com')");
  check(!r.ok && r.code === "23514", "pogingen: alleen hashes (geen e-mailadres)", uitleg(r));
  for (const wie of ["daniel", "mark", "indringer", "anon"]) {
    r = await als(db, wie, "select * from public.inlog_pogingen");
    check(geweigerd(r), `pogingen: ${wie} leest niets`, uitleg(r));
    r = await als(db, wie, "delete from public.inlog_pogingen");
    check(geweigerd(r), `pogingen: ${wie} wist niets`, uitleg(r));
  }

  // Twee keer uitvoeren: niets dubbel, audit blijft, functies werken nog.
  await voerUit(db, m26, "0026 (6e keer)");
  check((await db.query("select count(*)::int as n from public.audit_log")).rows[0].n === 2, "0026 opnieuw: audit-log ongemoeid");
  r = await alsMetAal(db, "daniel", "aal1", KLANTEN);
  check(telKlanten(r) === 0, "0026 opnieuw: 2FA-controle nog actief", uitleg(r));

  // Opruimen voor de toegangsmatrix: Daniel weer zonder factor.
  await db.query("delete from auth.mfa_factors where user_id = $1", [U.daniel]);
  if (fouten === fouten0) console.log("  0026 beveiliging (2FA, audit-log, pogingen): ok");
}

// ---------------------------------------------------------------------------------
// Scenario B: 0020 nog niet uitgevoerd
// ---------------------------------------------------------------------------------
async function scenarioB() {
  const db = await nieuweDb();
  for (const f of MIGRATIES.filter((f) => f < "0020")) await voerUit(db, lees(`supabase/migrations/${f}`), f);
  await zaaiGebruikersVoor0021(db);
  await zaaiData(db, false);
  checkControle(await voerUit(db, lees("supabase/UITVOEREN_0021_TEAM.sql"), "B: UITVOEREN_0021_TEAM.sql"), "B: 0021 zonder 0020");
  check((await db.query("select to_regclass('public.expenses') as t")).rows[0].t === null, "B: expenses bestaat nog niet");
  checkControle(await voerUit(db, lees("supabase/UITVOEREN_0020_UITGAVEN.sql"), "B: UITVOEREN_0020_UITGAVEN.sql"), "B: daarna 0020 (+0021)");
  const pol = (await db.query("select policyname, qual from pg_policies where tablename in ('expenses', 'expense_files')")).rows;
  check(pol.length === 2 && pol.every((p) => /is_teamlid/.test(p.qual)), "B: uitgaven alleen voor teamleden", JSON.stringify(pol));
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'indringer@example.com', now())", [U.indringer]);
  await db.exec(`insert into public.expenses (supplier) values ('x')`);
  let r = await als(db, "indringer", "select * from public.expenses");
  check(leeg(r), "B: niet-teamlid ziet geen uitgaven", uitleg(r));
  r = await als(db, "daniel", "select * from public.expenses");
  check(r.ok && r.rows.length === 1, "B: teamlid ziet uitgaven", uitleg(r));
  await db.close();
}

await scenarioA();
await scenarioB();

console.log(`\n${goed} geslaagd, ${fouten} mislukt`);
if (fouten) process.exit(1);
