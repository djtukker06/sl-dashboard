// Bouwt de bestanden voor de Supabase SQL Editor:
//   supabase/UITVOEREN_IN_SQL_EDITOR.sql  0014–0021 (social, agenda, mail, uitgaven, team)
//   supabase/UITVOEREN_0020_UITGAVEN.sql  0020 + 0021 (voor wie 0014–0019 al heeft uitgevoerd)
//   supabase/UITVOEREN_0021_TEAM.sql      alleen 0021 (team, toegang en taken op naam)
//
// 0021 sluit ELK bestand af: 0014–0020 maken nog policies "auth.uid() is not null"
// (open voor elk account). Wie een ouder bestand opnieuw uitvoert, zou zonder 0021 erachter
// die open policies terugzetten; nu eindigt elk bestand met alleen-teamleden.
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
const DOEL_TEAM = path.join(ROOT, "supabase", "UITVOEREN_0021_TEAM.sql");

const MIGRATIES = [
  "0014_social.sql",
  "0015_social_storage.sql",
  "0016_social_brand_seed.sql",
  "0017_social_storage_limieten.sql",
  "0018_agenda_taken.sql",
  "0019_mail_opslag.sql",
  "0020_uitgaven.sql",
  "0021_team_en_taken.sql",
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

// Team en toegang (0021). "open policy" = nog ergens "auth.uid() is not null".
const OPEN_POLICY = "(coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'auth\\.uid\\(\\)( AS uid\\))? IS NOT NULL'";
const CONTROLE_TEAM = [
  "  ('tabel team_members',      to_regclass('public.team_members') is not null)",
  "  ('tabel profiles',          to_regclass('public.profiles') is not null)",
  "  ('tabel projects',          to_regclass('public.projects') is not null)",
  "  ('tabel task_assignees',    to_regclass('public.task_assignees') is not null)",
  "  ('tabel task_subtasks',     to_regclass('public.task_subtasks') is not null)",
  "  ('tabel event_attendees',   to_regclass('public.event_attendees') is not null)",
  "  ('tabel user_mailboxes',    to_regclass('public.user_mailboxes') is not null)",
  "  ('functie is_teamlid',      to_regprocedure('public.is_teamlid()') is not null)",
  "  ('functie taak_aanmaken',   to_regprocedure('public.taak_aanmaken(jsonb)') is not null)",
  "  ('RLS aan op alle tabellen', not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity))",
  "  ('minstens één actief teamlid', exists (select 1 from public.team_members where actief))",
  "  ('aantal actieve teamleden: ' || (select count(*) from public.team_members where actief) || ' (zie hieronder wie)', true)",
  "  ('minstens één eigenaar',   exists (select 1 from public.team_members where actief and rol = 'eigenaar'))",
  "  ('elke taak heeft iemand',  not exists (select 1 from public.tasks t where not exists (select 1 from public.task_assignees a where a.task_id = t.id)))",
  `  ('geen open policies (public)', not exists (select 1 from pg_policies where schemaname = 'public' and ${OPEN_POLICY}))`,
  `  ('geen open policies (storage)', not exists (select 1 from pg_policies where schemaname = 'storage' and ${OPEN_POLICY}))`,
  "  ('elke policy vereist teamlid', not exists (select 1 from pg_policies where schemaname in ('public', 'storage') and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ '(is_teamlid|taak_betrokken|afspraak_betrokken)\\('))",
  "  ('storage alleen teamleden', not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(invoices|social-assets)' and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'is_teamlid'))",
  "  ('factuurfuncties dicht voor app-rollen', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('create_invoice', 'update_invoice', 'social_restore_latest') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))))",
  "  ('anon leest geen facturen', not has_table_privilege('anon', 'public.invoices', 'select'))",
  "  ('user_mailboxes zonder policies', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_mailboxes'))",
  "  ('geen openbare buckets',   not exists (select 1 from storage.buckets where public))",
];

// Onder de controle: wie er nu toegang heeft (zo zie je meteen of er iemand tussen staat
// die er niet hoort). Zelfde kolommen als de controle, zodat het één tabel blijft.
const TEAMLEDEN = `union all
select 'teamlid: ' || coalesce(p.naam, '?') || ' <' || coalesce(p.email, '?') || '> (' || m.rol || ')',
       case when m.actief then 'actief' else 'gedeactiveerd' end
from public.team_members m
left join public.profiles p on p.id = m.user_id`;

function controle(regels, extra = "") {
  return `-- Controle: elke regel hoort "ok" te tonen${extra ? " (en daaronder: wie er toegang heeft)" : ""}.
select onderdeel,
       case when aanwezig then 'ok' else 'ONTBREEKT' end as status
from (values
${regels.join(",\n")}
) as c(onderdeel, aanwezig)${extra ? `\n${extra}` : ""};
`;
}

const TEAM_STAPPEN = `-- EERST (vóór je dit uitvoert, zie README "Team & toegang"):
--   - Authentication -> Sign In / Providers: "Allow new users to sign up" UIT,
--     "Allow anonymous sign-ins" UIT, "Confirm email" AAN.
--   - Authentication -> Users: staat daar iemand die er niet hoort? Verwijder die eerst.
-- Daarna (eenmalig):
--   - Authentication -> Emails -> "Invite user": link naar
--     {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/nieuw-wachtwoord
--   - Teamlid toevoegen: node --env-file=.env.local scripts/teamlid-toevoegen.mjs --email … --naam "…"`;

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
--   0021       Team          alleen teamleden (allowlist + is_teamlid()) in ALLE policies,
--                            taken op naam, projecten, eigen mailbox per gebruiker
-- Van de facturen-tabellen (0001–0013) veranderen alleen de toegangsregels (0021).
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
-- Al eerder 0014–0020 uitgevoerd? Dan volstaat supabase/UITVOEREN_0021_TEAM.sql.
--
-- Daarna: importeer de oude social-projecten met
--   scripts/importeer-social-projecten.mjs (zie README).
--
${TEAM_STAPPEN}
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
  ...CONTROLE_TEAM,
], TEAMLEDEN)}`;
}

function bouwUitgaven() {
  return `-- ============================================================================
-- Studio Levant-backoffice — module Uitgaven (migratie 0020) in de SQL Editor
-- ============================================================================
--
-- Wat dit doet: tabellen expenses en expense_files (met RLS en updated_at-trigger) en
-- de privé-buckets "uitgaven" (bonnetjes, max. 25 MB, jpeg/png/webp/heic/pdf) en
-- "uitgaven-export" (tijdelijke ZIP's voor de boekhouder, max. 50 MB).
-- Daarna migratie 0021 (team): alleen actieve teamleden mogen nog iets, overal.
--
-- Zo voer je het uit:
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan verschijnt een controletabel: elke regel moet "ok" tonen.
--
-- Veilig om nogmaals uit te voeren; alles draait in één transactie.
-- (Dit zit ook in UITVOEREN_IN_SQL_EDITOR.sql; één van beide uitvoeren is genoeg.)
--
${TEAM_STAPPEN}
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/0020_uitgaven.sql
-- en 0021_team_en_taken.sql. Niet met de hand aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

${deel("0020_uitgaven.sql")}
${deel("0021_team_en_taken.sql")}
commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen zijn.
notify pgrst, 'reload schema';

${controle([...CONTROLE_UITGAVEN, ...CONTROLE_TEAM], TEAMLEDEN)}`;
}

function bouwTeam() {
  return `-- ============================================================================
-- Studio Levant-backoffice — team en toegang (migratie 0021) in de SQL Editor
-- ============================================================================
--
-- Wat dit doet:
--   - team_members (de allowlist) + profiles; alleen ACTIEVE teamleden mogen nog iets.
--     Alleen de oudste bestaande gebruiker (Daniel) wordt bij de eerste keer automatisch lid
--     (eigenaar); andere bestaande accounts niet (ze staan als NOTICE in de uitvoer).
--   - ALLE policies (facturen, klanten, social, agenda, uitgaven, Storage) gaan van
--     "ingelogd" naar "actief teamlid" (is_teamlid()).
--   - create_invoice/update_invoice zijn niet meer aan te roepen met de anon key.
--   - Nieuwe tabellen voor taken op naam (task_assignees, task_subtasks), projecten,
--     deelnemers aan afspraken en een eigen mailbox per gebruiker. Bestaande taken en
--     afspraken gaan naar hun maker (of de eigenaar). Er wordt niets verwijderd.
--
-- Vereist 0014–0019 (zie UITVOEREN_IN_SQL_EDITOR.sql). Uitgaven (0020) nog niet uitgevoerd?
-- Dan worden die onderdelen overgeslagen; voer dit bestand na 0020 gewoon nog eens uit.
--
-- Zo voer je het uit:
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan: elke regel moet "ok" tonen, en daaronder staat wie er toegang heeft.
--      Staat daar iemand die er niet hoort? Deactiveer die met scripts/teamlid-verwijderen.mjs.
--
-- Veilig om nogmaals uit te voeren; alles draait in één transactie.
--
${TEAM_STAPPEN}
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/0021_team_en_taken.sql.
-- Niet met de hand aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

${deel("0021_team_en_taken.sql")}
commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen zijn.
notify pgrst, 'reload schema';

${controle(CONTROLE_TEAM, TEAMLEDEN)}`;
}

const bestanden = [
  [DOEL, bouw()],
  [DOEL_UITGAVEN, bouwUitgaven()],
  [DOEL_TEAM, bouwTeam()],
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
  console.log("UITVOEREN_IN_SQL_EDITOR.sql, UITVOEREN_0020_UITGAVEN.sql en UITVOEREN_0021_TEAM.sql zijn actueel.");
} else {
  for (const [doel, inhoud] of bestanden) fs.writeFileSync(doel, inhoud);
  console.log(
    `Geschreven: ${path.relative(ROOT, DOEL)} (${MIGRATIES.length} migraties), ${path.relative(ROOT, DOEL_UITGAVEN)} en ${path.relative(ROOT, DOEL_TEAM)}`,
  );
}
