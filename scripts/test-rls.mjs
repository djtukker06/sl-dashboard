// Test van de RLS-migratie (0021) op een lokale Postgres (PGlite, in het geheugen), met
// nagebootste Supabase-onderdelen: de rollen anon/authenticated/service_role, auth.users +
// auth.uid() (uit request.jwt.claim.sub, zoals PostgREST) en storage.buckets/objects.
// Er wordt niets tegen Supabase uitgevoerd en niets naar het netwerk gestuurd.
//
// Scenario A  0001–0020 → data → UITVOEREN_0021_TEAM.sql (2x) → UITVOEREN_IN_SQL_EDITOR.sql
//             → UITVOEREN_0020_UITGAVEN.sql: elke controleregel "ok", niets heropend.
//             Daarna de toegangsmatrix:
//               - niet-teamleden (ingelogd zonder lidmaatschap, onbevestigd, gedeactiveerd,
//                 en anon zonder sessie): op ELKE tabel in public en in ELKE bucket niets
//                 lezen, invoegen, wijzigen of verwijderen; RPC's geweigerd;
//               - teamleden: gedeelde data lezen/schrijven, facturen alleen lezen,
//                 taken alleen wijzigen als maker/toegewezene, eigen profiel, geen
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

  const team = lees("supabase/UITVOEREN_0021_TEAM.sql");
  checkControle(await voerUit(db, team, "UITVOEREN_0021_TEAM.sql"), "A: 0021_TEAM (1e keer)");
  checkControle(await voerUit(db, team, "UITVOEREN_0021_TEAM.sql (2x)"), "A: 0021_TEAM (2e keer)");

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

  // Opnieuw de grote bestanden: mogen de open policies niet terugzetten.
  checkControle(await voerUit(db, lees("supabase/UITVOEREN_IN_SQL_EDITOR.sql"), "UITVOEREN_IN_SQL_EDITOR.sql"), "A: IN_SQL_EDITOR opnieuw");
  checkControle(await voerUit(db, lees("supabase/UITVOEREN_0020_UITGAVEN.sql"), "UITVOEREN_0020_UITGAVEN.sql"), "A: 0020_UITGAVEN opnieuw");
  const nLeden = (await db.query("select count(*)::int as n from public.team_members")).rows[0].n;
  check(nLeden === 1, "opnieuw uitvoeren zaait geen extra leden", `${nLeden}`);

  // Mark komt er (zoals in het echt) bij via het teamlid-script: profiel + lidmaatschap.
  await db.query("insert into public.profiles (id, naam, initialen, email) values ($1, 'Mark', 'M', 'mark@studio-levant.nl')", [U.mark]);
  await db.query("insert into public.team_members (user_id, actief, rol) values ($1, true, 'lid')", [U.mark]);

  await zaaiNa0021(db);
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
      "select p.oid::regprocedure::text as f, has_function_privilege(current_user, p.oid, 'execute') as mag from pg_proc p where p.proname in ('create_invoice','update_invoice','social_restore_latest','team_eigenaar')",
    );
    check(fac.ok && fac.rows.length >= 4 && fac.rows.every((r) => !r.mag), `${wie}: factuur-/beheerfuncties niet uitvoerbaar`, JSON.stringify(fac.rows ?? fac.msg));
    if (wie !== "anon") {
      const lid = await als(db, wie, "select public.is_teamlid() as lid, public.is_actief_teamlid($1) as ander", [U.daniel]);
      check(lid.ok && lid.rows[0].lid === false && lid.rows[0].ander === false, `${wie}: is_teamlid() = false en verraadt niets`, uitleg(lid));
    } else {
      const lid = await als(db, wie, "select public.is_teamlid()");
      check(geweigerd(lid), "anon: is_teamlid() niet uitvoerbaar", uitleg(lid));
    }
  }

  // ---- Teamleden ----
  for (const wie of ["daniel", "mark"]) {
    for (const t of tabellen) {
      const sel = await als(db, wie, `select count(*)::int as n from public.${t}`);
      if (t === "user_mailboxes") {
        check(geweigerd(sel), `${wie}: user_mailboxes niet leesbaar (alleen server)`, uitleg(sel));
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
