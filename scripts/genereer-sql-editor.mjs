// Bouwt de bestanden voor de Supabase SQL Editor:
//   supabase/UITVOEREN_IN_SQL_EDITOR.sql  0014–0024 (social, agenda, mail, uitgaven, team, klanten, Drive)
//   supabase/UITVOEREN_0020_UITGAVEN.sql  0020 + 0021 + 0022 + 0023 + 0024 (voor wie 0014–0019 al heeft uitgevoerd)
//   supabase/UITVOEREN_0021_TEAM.sql      0021 + 0022 + 0023 + 0024 (team, toegang en taken op naam)
//   supabase/UITVOEREN_0022.sql           alleen 0022 (welkomstflow, wie-ziet-welke-taak,
//                                         klanten & projecten, snelheid) — vereist 0021
//   supabase/UITVOEREN_0023.sql           alleen 0023 (projectstatus voor het bord) — vereist 0022
//   supabase/UITVOEREN_0024.sql           alleen 0024 (Google Drive / module Bestanden) — vereist 0022
//
// 0021 + 0022 (+ 0023 projectstatus en 0024 Drive, alleen nieuwe tabellen met teamcheck) sluiten ELK groot bestand af: 0014–0020 maken nog policies "auth.uid() is not null"
// (open voor elk account) en 0021 laat elk teamlid alle taken lezen. Wie een ouder bestand
// opnieuw uitvoert, zou zonder 0021/0022 erachter die open regels terugzetten; nu eindigt
// elk bestand met alleen-teamleden en de afgeschermde taken van 0022.
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
const DOEL_0022 = path.join(ROOT, "supabase", "UITVOEREN_0022.sql");
const DOEL_0023 = path.join(ROOT, "supabase", "UITVOEREN_0023.sql");
const DOEL_0024 = path.join(ROOT, "supabase", "UITVOEREN_0024.sql");

const MIGRATIES = [
  "0014_social.sql",
  "0015_social_storage.sql",
  "0016_social_brand_seed.sql",
  "0017_social_storage_limieten.sql",
  "0018_agenda_taken.sql",
  "0019_mail_opslag.sql",
  "0020_uitgaven.sql",
  "0021_team_en_taken.sql",
  "0022_team_crm.sql",
  "0023_projectstatus.sql",
  "0024_drive.sql",
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

// Team van twee, klanten & projecten, snelheid (0022).
const CONTROLE_0022 = [
  "  ('kolom profiles.welkom_klaar_op', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'welkom_klaar_op'))",
  "  ('eigenaren slaan de welkomstflow over', not exists (select 1 from public.team_members m join public.profiles p on p.id = m.user_id where m.rol = 'eigenaar' and p.welkom_klaar_op is null))",
  "  ('functie taak_zichtbaar',  to_regprocedure('public.taak_zichtbaar(uuid)') is not null)",
  "  ('taken alleen voor betrokkenen', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'betrokkenen lezen taken'))",
  "  ('afspraken alleen voor betrokkenen', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_events' and policyname = 'betrokkenen lezen afspraken'))",
  "  ('geen open leesregels voor taken', not exists (select 1 from pg_policies where schemaname = 'public' and policyname in ('teamleden lezen taken', 'teamleden lezen toewijzingen', 'teamleden lezen subtaken', 'teamleden lezen afspraken', 'teamleden lezen deelnemers')))",
  "  ('kolommen clients (email, telefoon, status)', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name in ('email', 'telefoon', 'status')) = 3)",
  "  ('tabel client_notes',      to_regclass('public.client_notes') is not null)",
  "  ('tabel project_eigenaren', to_regclass('public.project_eigenaren') is not null)",
  "  ('kolom projects.deadline', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'deadline'))",
  "  ('projectstatus omgezet',   not exists (select 1 from public.projects where status not in ('gepland', 'voorbereiding', 'bezig', 'wachten', 'afgerond')))",
  "  ('functie taak_tellingen',  to_regprocedure('public.taak_tellingen(date,uuid,uuid)') is not null)",
  "  ('functie project_taak_tellingen', to_regprocedure('public.project_taak_tellingen(uuid[])') is not null)",
  "  ('tellingen dicht voor anon', not has_function_privilege('anon', 'public.taak_tellingen(date,uuid,uuid)', 'execute'))",
  "  ('indexen 0022',            (select count(*) from pg_class where relname in ('tasks_maker_open_idx', 'clients_status_idx', 'client_notes_klant_idx', 'projects_status_idx', 'tasks_client_idx', 'project_eigenaren_user_idx', 'tasks_due_idx', 'calendar_events_client_idx', 'calendar_events_maker_idx', 'tasks_maker_idx')) = 10)",
];

// Projectstatus voor het bord (0023).
const CONTROLE_0023 = [
  "  ('projectstatus voorbereiding/bezig/wachten/afgerond', not exists (select 1 from public.projects where status not in ('voorbereiding', 'bezig', 'wachten', 'afgerond')))",
  "  ('nieuwe projecten standaard voorbereiding', (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'status') like '%voorbereiding%')",
  "  ('check op projectstatus', exists (select 1 from pg_constraint where conrelid = 'public.projects'::regclass and conname = 'projects_status_check' and pg_get_constraintdef(oid) ilike '%wachten%'))",
  "  ('kolom projects.status_sinds', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'status_sinds' and is_nullable = 'NO'))",
  "  ('trigger status_sinds',    exists (select 1 from pg_trigger where tgname = 'projects_status_sinds' and tgrelid = 'public.projects'::regclass))",
  "  ('RLS projects ongewijzigd (teamlid)', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'is_teamlid\\('))",
  "  ('indexen 0023',            (select count(*) from pg_class where relname in ('projects_status_sinds_idx', 'projects_deadline_idx')) = 2)",
];

// Google Drive / module Bestanden (0024).
const CONTROLE_0024 = [
  "  ('tabel drive_koppeling',   to_regclass('public.drive_koppeling') is not null)",
  "  ('tabel drive_mappen',      to_regclass('public.drive_mappen') is not null)",
  "  ('tabel drive_bestanden',   to_regclass('public.drive_bestanden') is not null)",
  "  ('tabel drive_kopieen',     to_regclass('public.drive_kopieen') is not null)",
  "  ('RLS op de drive-tabellen', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('drive_koppeling', 'drive_mappen', 'drive_bestanden', 'drive_kopieen') and relrowsecurity) = 4)",
  "  ('drive_koppeling zonder policies', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drive_koppeling'))",
  "  ('drive_koppeling onleesbaar voor de app', not has_table_privilege('authenticated', 'public.drive_koppeling', 'select') and not has_table_privilege('anon', 'public.drive_koppeling', 'select'))",
  "  ('drive-tabellen alleen voor teamleden', (select count(*) from pg_policies where schemaname = 'public' and tablename in ('drive_mappen', 'drive_bestanden', 'drive_kopieen') and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'is_teamlid\\(') = 3)",
  "  ('drive_mappen en drive_kopieen alleen door de server te schrijven', not has_table_privilege('authenticated', 'public.drive_kopieen', 'insert') and not has_table_privilege('authenticated', 'public.drive_mappen', 'insert'))",
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
--   0022       Team van twee welkomstflow, taken alleen voor betrokkenen, klanten &
--                            projecten (status, notities, eigenaren), snelheid
--   0023       Projectenbord projectstatus voorbereiding / bezig / wachten / afgerond
--                            en sinds wanneer (status_sinds)
--   0024       Bestanden     Google Drive-koppeling (drive_koppeling, alleen server),
--                            mappen-cache, uploads en kopieën van facturen/bonnetjes
-- Van de facturen-tabellen (0001–0013) veranderen alleen de toegangsregels (0021) en
-- komen er bij clients drie kolommen met standaardwaarden bij (0022).
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
-- Al eerder 0014–0021 uitgevoerd? Dan volstaat supabase/UITVOEREN_0022.sql (+ 0023).
-- Al eerder 0014–0022 uitgevoerd? Dan volstaat supabase/UITVOEREN_0023.sql (+ 0024).
-- Al eerder 0014–0023 uitgevoerd? Dan volstaat supabase/UITVOEREN_0024.sql.
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
  ...CONTROLE_0022,
  ...CONTROLE_0023,
  ...CONTROLE_0024,
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
-- Daarna migratie 0021 (team): alleen actieve teamleden mogen nog iets, overal, 0022
-- (taken alleen voor betrokkenen, klanten & projecten), 0023 (projectstatus) en 0024
-- (Google Drive / module Bestanden).
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
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/0020_uitgaven.sql,
-- 0021_team_en_taken.sql, 0022_team_crm.sql, 0023_projectstatus.sql en 0024_drive.sql. Niet met de hand
-- aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

${deel("0020_uitgaven.sql")}
${deel("0021_team_en_taken.sql")}
${deel("0022_team_crm.sql")}
${deel("0023_projectstatus.sql")}
${deel("0024_drive.sql")}
commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen zijn.
notify pgrst, 'reload schema';

${controle([...CONTROLE_UITGAVEN, ...CONTROLE_TEAM, ...CONTROLE_0022, ...CONTROLE_0023, ...CONTROLE_0024], TEAMLEDEN)}`;
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
--   - Daarna 0022 (zie UITVOEREN_0022.sql), zodat dit bestand nooit de open leesregels
--     voor taken van 0021 terugzet, 0023 (projectstatus, zie UITVOEREN_0023.sql) en 0024
--     (Google Drive, zie UITVOEREN_0024.sql).
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
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/0021_team_en_taken.sql,
-- 0022_team_crm.sql, 0023_projectstatus.sql en 0024_drive.sql. Niet met de hand aanpassen;
-- pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

${deel("0021_team_en_taken.sql")}
${deel("0022_team_crm.sql")}
${deel("0023_projectstatus.sql")}
${deel("0024_drive.sql")}
commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen zijn.
notify pgrst, 'reload schema';

${controle([...CONTROLE_TEAM, ...CONTROLE_0022, ...CONTROLE_0023, ...CONTROLE_0024], TEAMLEDEN)}`;
}

function bouw0022() {
  return `-- ============================================================================
-- Studio Levant-backoffice — team van twee, klanten & projecten (migratie 0022)
-- ============================================================================
--
-- Wat dit doet (alleen toevoegen; de facturen werken ongewijzigd):
--   - Welkomstflow: kolom profiles.welkom_klaar_op. Eigenaren (Daniel) krijgen meteen
--     "klaar"; een nieuw teamlid (Bram) ziet bij zijn eerste login /welkom.
--   - Wie ziet welke taak: een taak, de toewijzingen en subtaken leest alleen de maker,
--     wie hem kreeg, of (bij een projecttaak) het team. Afspraken: maker en deelnemers.
--     Een taak die Daniel voor Bram maakt, staat bij Bram en bij Daniel alleen onder
--     "Uitgezet".
--   - Klanten: e-mail, telefoon en status (lead / actief / afgerond, standaard actief);
--     notities per klant (client_notes).
--   - Projecten: status gepland / bezig / afgerond (actief -> bezig, gearchiveerd ->
--     afgerond), een deadline en eigenaren (project_eigenaren). Daarna kan
--     UITVOEREN_0023.sql (projectstatus voor het bord); is 0023 al uitgevoerd, dan laat
--     dit bestand die statussen staan.
--   - Snelheid: tellers in één query (taak_tellingen, project_taak_tellingen) en indexen.
--
-- Vereist 0021 (team). Nog niet uitgevoerd? Gebruik dan UITVOEREN_0021_TEAM.sql (bevat
-- 0021 én 0022).
--
-- Zo voer je het uit:
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan: elke regel moet "ok" tonen, en daaronder staat wie er toegang heeft.
--
-- Veilig om nogmaals uit te voeren; alles draait in één transactie (gaat er iets mis, dan
-- wordt niets half doorgevoerd). Een welkom-vlag, weggehaalde projecteigenaren en
-- statussen blijven bij opnieuw uitvoeren zoals ze zijn.
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/0022_team_crm.sql.
-- Niet met de hand aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

${deel("0022_team_crm.sql")}
commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe kolommen en functies zijn.
notify pgrst, 'reload schema';

${controle(CONTROLE_0022, TEAMLEDEN)}`;
}

function bouw0023() {
  return `-- ============================================================================
-- Studio Levant-backoffice — projectstatus voor het projectenbord (migratie 0023)
-- ============================================================================
--
-- Wat dit doet (alleen de tabel projects; RLS en facturen ongewijzigd):
--   - Status voorbereiding / bezig / wachten (op goedkeuring) / afgerond. Bestaande
--     'gepland' wordt 'voorbereiding'; nieuwe projecten staan standaard op voorbereiding.
--   - Kolom status_sinds (gevuld met de laatste wijziging) en een trigger die hem bij
--     elke statuswijziging op "nu" zet: voor "12 dagen in deze status" op het bord.
--   - Indexen op status + status_sinds en op deadline.
--
-- Vereist 0022. Nog niet uitgevoerd? Voer dan eerst UITVOEREN_0022.sql uit (of het grote
-- UITVOEREN_0021_TEAM.sql, dat 0021, 0022 én 0023 bevat).
--
-- Zo voer je het uit:
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan: elke regel moet "ok" tonen, en daaronder staat wie er toegang heeft.
--
-- Veilig om nogmaals uit te voeren; alles draait in één transactie (gaat er iets mis, dan
-- wordt niets half doorgevoerd). De app werkt vóór en na dit bestand.
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/0023_projectstatus.sql.
-- Niet met de hand aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

${deel("0023_projectstatus.sql")}
commit;

-- PostgREST (de API van Supabase) direct laten weten dat er een nieuwe kolom is.
notify pgrst, 'reload schema';

${controle(CONTROLE_0023, TEAMLEDEN)}`;
}

function bouw0024() {
  return `-- ============================================================================
-- Studio Levant-backoffice — Google Drive / module Bestanden (migratie 0024)
-- ============================================================================
--
-- Wat dit doet (alleen nieuwe tabellen; facturen, klanten en projecten ongewijzigd):
--   - drive_koppeling: de ene koppeling met het Google-account van Studio Levant
--     (e-mailadres, versleuteld refresh token, id van de rootmap "Studio Levant").
--     Geen policies en geen rechten voor de app-rollen: alleen de server leest hem.
--   - drive_mappen: cache van map-id's (Boekhouding/Facturen/<jaar>, klant- en
--     projectmappen); teamleden lezen, alleen de server schrijft.
--   - drive_bestanden: wie welk bestand via het dashboard uploadde (teamleden).
--   - drive_kopieen: welke facturen, prijsopgaven en bonnetjes al naar Drive zijn
--     gekopieerd (teamleden lezen, alleen de server schrijft).
--
-- Vereist 0022 (klanten & projecten). Nog niet uitgevoerd? Gebruik dan het grote
-- UITVOEREN_0021_TEAM.sql (bevat 0021 t/m 0024).
--
-- Zo voer je het uit:
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan: elke regel moet "ok" tonen, en daaronder staat wie er toegang heeft.
--
-- Veilig om nogmaals uit te voeren; alles draait in één transactie (gaat er iets mis, dan
-- wordt niets half doorgevoerd). De app werkt vóór en na dit bestand: vóór 0024 toont
-- Bestanden een nette melding en gaan facturen gewoon door zonder Drive.
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/0024_drive.sql.
-- Niet met de hand aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

${deel("0024_drive.sql")}
commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen zijn.
notify pgrst, 'reload schema';

${controle(CONTROLE_0024, TEAMLEDEN)}`;
}

const bestanden = [
  [DOEL, bouw()],
  [DOEL_UITGAVEN, bouwUitgaven()],
  [DOEL_TEAM, bouwTeam()],
  [DOEL_0022, bouw0022()],
  [DOEL_0023, bouw0023()],
  [DOEL_0024, bouw0024()],
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
  console.log("UITVOEREN_IN_SQL_EDITOR.sql, UITVOEREN_0020_UITGAVEN.sql, UITVOEREN_0021_TEAM.sql, UITVOEREN_0022.sql, UITVOEREN_0023.sql en UITVOEREN_0024.sql zijn actueel.");
} else {
  for (const [doel, inhoud] of bestanden) fs.writeFileSync(doel, inhoud);
  console.log(
    `Geschreven: ${path.relative(ROOT, DOEL)} (${MIGRATIES.length} migraties), ${path.relative(ROOT, DOEL_UITGAVEN)}, ${path.relative(ROOT, DOEL_TEAM)}, ${path.relative(ROOT, DOEL_0022)}, ${path.relative(ROOT, DOEL_0023)} en ${path.relative(ROOT, DOEL_0024)}`,
  );
}
