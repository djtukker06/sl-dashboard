// Bouwt supabase/UITVOEREN_IN_SQL_EDITOR.sql: de migraties 0014–0020 (social, agenda,
// mail, uitgaven) samengevoegd tot één bestand dat je in één keer in de Supabase SQL Editor
// plakt. Daarnaast supabase/UITVOEREN_0020_UITGAVEN.sql: alleen uitgaven, voor wie 0014–0019
// al heeft uitgevoerd.
//
// De losse migratiebestanden blijven zoals ze zijn. Dit script maakt ze in de
// samengevoegde versie idempotent (twee keer uitvoeren geeft geen fout):
//   create table / create index      -> ... if not exists
//   create policy "x" on t           -> eerst drop policy if exists "x" on t
//   insert into storage.buckets ...  -> ... on conflict (id) do nothing
// (create or replace function, update ... en de brand-seed met on conflict waren al veilig.)
//
// Gebruik:  node scripts/genereer-sql-editor.mjs              schrijft het bestand
//           node scripts/genereer-sql-editor.mjs --controleer faalt als het bestand verouderd is
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP = path.join(ROOT, "supabase", "migrations");
const DOEL = path.join(ROOT, "supabase", "UITVOEREN_IN_SQL_EDITOR.sql");
const DOEL_UITGAVEN = path.join(ROOT, "supabase", "UITVOEREN_0020_UITGAVEN.sql");

const MIGRATIES = [
  "0014_social.sql",
  "0015_social_storage.sql",
  "0016_social_brand_seed.sql",
  "0017_social_storage_limieten.sql",
  "0018_agenda_taken.sql",
  "0019_mail_opslag.sql",
  "0020_uitgaven.sql",
];

// Controle-regels per onderdeel (onderaan elk bestand; elke regel hoort "ok" te tonen).
const CONTROLE_UITGAVEN = [
  "  ('tabel expenses',          to_regclass('public.expenses') is not null)",
  "  ('tabel expense_files',     to_regclass('public.expense_files') is not null)",
  "  ('RLS expenses',            coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.expenses')), false))",
  "  ('RLS expense_files',       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.expense_files')), false))",
  "  ('policy expenses',         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses'))",
  "  ('policy expense_files',    exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expense_files'))",
  "  ('trigger updated_at',      exists (select 1 from pg_trigger where tgname = 'expenses_set_updated_at'))",
  "  ('bucket uitgaven (privé)', exists (select 1 from storage.buckets where id = 'uitgaven' and not public))",
  "  ('bucket uitgaven-export',  exists (select 1 from storage.buckets where id = 'uitgaven-export' and not public))",
];

function controle(regels) {
  return `-- Controle: elke regel hoort "ok" te tonen.
select onderdeel,
       case when aanwezig then 'ok' else 'ONTBREEKT' end as status
from (values
${regels.join(",\n")}
) as c(onderdeel, aanwezig);
`;
}

export function maakIdempotent(sql) {
  let uit = sql
    .replace(/\bcreate table (?!if not exists)/gi, "create table if not exists ")
    .replace(/\bcreate (unique )?index (?!if not exists)/gi, (_m, u) => `create ${u || ""}index if not exists `);

  // drop policy if exists vóór elke create policy (tenzij die er al staat).
  uit = uit.replace(/(^|\n)([ \t]*)create policy ("[^"]+")\s+on ([\w.]+)/gi, (m, nl, inspring, naam, tabel, offset) => {
    const drop = `drop policy if exists ${naam} on ${tabel};`;
    const ervoor = uit.slice(Math.max(0, offset - 300), offset);
    if (ervoor.toLowerCase().includes(drop.toLowerCase())) return m;
    return `${nl}${inspring}${drop}\n${m.slice(nl.length)}`;
  });

  // Bucket-inserts: niet opnieuw invoegen als de bucket al bestaat.
  uit = uit.replace(/insert into storage\.buckets\b[^;]*;/gi, (stmt) =>
    /on conflict/i.test(stmt) ? stmt : stmt.replace(/;\s*$/, "\non conflict (id) do nothing;"),
  );
  return uit;
}

function deel(naam) {
  const sql = fs.readFileSync(path.join(MAP, naam), "utf8").replace(/\s+$/, "");
  const streep = "-".repeat(78);
  return `-- ${streep}\n-- ${naam}\n-- ${streep}\n\n${maakIdempotent(sql)}\n`;
}

function bouw() {
  const delen = MIGRATIES.map(deel);

  return `-- ============================================================================
-- Studio Levant-backoffice — in één keer uitvoeren in de Supabase SQL Editor
-- ============================================================================
--
-- Wat dit doet: richt de nieuwe modules in.
--   0014–0017  Social media  tabellen social_*, bucket social-assets, huisstijl
--   0018       Agenda/taken  tabellen tasks en calendar_events
--   0019       Mail          privé-bucket mail-tmp (grote bijlagen)
--   0020       Uitgaven      tabellen expenses en expense_files, buckets uitgaven en uitgaven-export
-- De facturen-tabellen (0001–0013) worden NIET aangeraakt.
--
-- Zo voer je het uit:
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan verschijnt een controletabel: elke regel moet "ok" tonen.
--
-- Veilig om nogmaals uit te voeren: alles gebruikt "if not exists",
-- "drop policy if exists" of "on conflict do nothing". Bestaande gegevens
-- (posts, taken, uitgaven, een aangepaste huisstijl) blijven staan. Alles draait in
-- één transactie: gaat er iets mis, dan wordt niets half doorgevoerd.
--
-- Al eerder 0014–0019 uitgevoerd? Dan volstaat supabase/UITVOEREN_0020_UITGAVEN.sql.
--
-- Daarna: importeer de oude social-projecten met
--   scripts/importeer-social-projecten.mjs (zie README).
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/.
-- Niet met de hand aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

${delen.join("\n")}
commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen zijn.
notify pgrst, 'reload schema';

${controle([
  "  ('tabel social_projects',   to_regclass('public.social_projects') is not null)",
  "  ('tabel social_slides',     to_regclass('public.social_slides') is not null)",
  "  ('tabel social_versions',   to_regclass('public.social_versions') is not null)",
  "  ('tabel social_brand',      to_regclass('public.social_brand') is not null)",
  "  ('huisstijl (social_brand)', exists (select 1 from public.social_brand where id = 1))",
  "  ('functie social_restore_latest', to_regprocedure('public.social_restore_latest(text)') is not null)",
  "  ('tabel tasks',             to_regclass('public.tasks') is not null)",
  "  ('tabel calendar_events',   to_regclass('public.calendar_events') is not null)",
  "  ('bucket social-assets',    exists (select 1 from storage.buckets where id = 'social-assets'))",
  "  ('bucket mail-tmp',         exists (select 1 from storage.buckets where id = 'mail-tmp'))",
  ...CONTROLE_UITGAVEN,
])}`;
}

function bouwUitgaven() {
  return `-- ============================================================================
-- Studio Levant-backoffice — module Uitgaven (migratie 0020) in de SQL Editor
-- ============================================================================
--
-- Wat dit doet: tabellen expenses en expense_files (met RLS en updated_at-trigger) en
-- de privé-buckets "uitgaven" (bonnetjes, max. 25 MB, jpeg/png/webp/heic/pdf) en
-- "uitgaven-export" (tijdelijke ZIP's voor de boekhouder, max. 50 MB).
-- De facturen-tabellen worden NIET aangeraakt (alleen een verwijzing naar clients).
--
-- Zo voer je het uit:
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan verschijnt een controletabel: elke regel moet "ok" tonen.
--
-- Veilig om nogmaals uit te voeren; alles draait in één transactie.
-- (Dit zit ook in UITVOEREN_IN_SQL_EDITOR.sql; één van beide uitvoeren is genoeg.)
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/0020_uitgaven.sql.
-- Niet met de hand aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

${deel("0020_uitgaven.sql")}
commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen zijn.
notify pgrst, 'reload schema';

${controle(CONTROLE_UITGAVEN)}`;
}

const bestanden = [
  [DOEL, bouw()],
  [DOEL_UITGAVEN, bouwUitgaven()],
];
if (process.argv.includes("--controleer")) {
  let verouderd = false;
  for (const [doel, inhoud] of bestanden) {
    const huidig = fs.existsSync(doel) ? fs.readFileSync(doel, "utf8") : "";
    if (huidig !== inhoud) {
      console.error(`${path.relative(ROOT, doel)} is verouderd: draai node scripts/genereer-sql-editor.mjs`);
      verouderd = true;
    }
  }
  if (verouderd) process.exit(1);
  console.log("UITVOEREN_IN_SQL_EDITOR.sql en UITVOEREN_0020_UITGAVEN.sql zijn actueel.");
} else {
  for (const [doel, inhoud] of bestanden) fs.writeFileSync(doel, inhoud);
  console.log(`Geschreven: ${path.relative(ROOT, DOEL)} (${MIGRATIES.length} migraties) en ${path.relative(ROOT, DOEL_UITGAVEN)}`);
}
