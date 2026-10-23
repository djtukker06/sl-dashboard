-- ============================================================================
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

-- ------------------------------------------------------------------------------
-- 0024_drive.sql
-- ------------------------------------------------------------------------------

-- 0024: Google Drive als gezamenlijke bestandsopslag (module Bestanden). Idempotent: twee
-- keer uitvoeren geeft geen fout. Alleen nieuwe tabellen; facturen, klanten en projecten
-- veranderen niet. Vereist 0021 (is_teamlid, projects) en 0022.
--
--   drive_koppeling  de ene koppeling met het Google-account van Studio Levant: e-mailadres,
--                    versleuteld refresh token (AES-256-GCM, door de server) en de id van de
--                    rootmap "Studio Levant". GEEN policies en geen rechten voor anon/
--                    authenticated: alleen de server (service-role) leest en schrijft hem.
--   drive_mappen     cache van map-id's (Boekhouding/Facturen/2026, de map van een klant of
--                    project, …), per rootmap; zo hoeft de server niet steeds te zoeken.
--                    Teamleden lezen; alleen de server schrijft (een id hierin geldt als
--                    "binnen de rootmap").
--   drive_bestanden  wie een bestand via het dashboard uploadde (en bij welke klant/project).
--   drive_kopieen    welke factuur, prijsopgave of welk bonnetje al naar Drive is gekopieerd
--                    (en van welk PDF-pad), zodat kopiëren idempotent is.
-- Alle tabellen behalve drive_koppeling: alleen actieve teamleden (is_teamlid()); in
-- drive_mappen en drive_kopieen schrijft alleen de server.

-- ---------------------------------------------------------------------------------
-- 1. De koppeling (één rij)
-- ---------------------------------------------------------------------------------
create table if not exists public.drive_koppeling (
  id smallint primary key default 1 check (id = 1),
  google_email text not null default '' check (length(google_email) <= 320),
  refresh_token_enc text not null check (refresh_token_enc like 'v1:%'),
  root_id text not null check (length(root_id) between 1 and 200),
  scope text not null default '' check (length(scope) <= 1000),
  gekoppeld_door uuid references auth.users (id) on delete set null,
  gekoppeld_op timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists drive_koppeling_set_updated_at on public.drive_koppeling;
create trigger drive_koppeling_set_updated_at
  before update on public.drive_koppeling
  for each row execute function public.set_updated_at();

alter table public.drive_koppeling enable row level security;
-- Bewust geen enkele policy; en ook geen tabelrechten voor de app-rollen.
revoke all on public.drive_koppeling from anon, authenticated;

-- ---------------------------------------------------------------------------------
-- 2. Mappen-cache
-- ---------------------------------------------------------------------------------
--   soort 'pad'      sleutel = het pad onder de root, bv. 'Boekhouding/Facturen/2026'
--   soort 'klant'    sleutel = clients.id
--   soort 'project'  sleutel = projects.id
create table if not exists public.drive_mappen (
  root_id text not null check (length(root_id) between 1 and 200),
  soort text not null check (soort in ('pad', 'klant', 'project')),
  sleutel text not null check (length(sleutel) between 1 and 500),
  drive_id text not null check (length(drive_id) between 1 and 200),
  naam text not null default '' check (length(naam) <= 300),
  ouder_id text check (length(ouder_id) <= 200),
  updated_at timestamptz not null default now(),
  primary key (root_id, soort, sleutel)
);
create index if not exists drive_mappen_drive_idx on public.drive_mappen (drive_id);

alter table public.drive_mappen enable row level security;
drop policy if exists "teamleden beheren drive-mappen" on public.drive_mappen;
drop policy if exists "teamleden lezen drive-mappen" on public.drive_mappen;
create policy "teamleden lezen drive-mappen" on public.drive_mappen
  for select to authenticated
  using ((select public.is_teamlid()));
-- Schrijven doet alleen de server: een map-id in deze tabel geldt als "binnen de root".
revoke insert, update, delete on public.drive_mappen from authenticated;

-- ---------------------------------------------------------------------------------
-- 3. Wie uploadde wat (alleen bestanden die via het dashboard zijn geüpload)
-- ---------------------------------------------------------------------------------
create table if not exists public.drive_bestanden (
  drive_file_id text primary key check (length(drive_file_id) between 1 and 200),
  naam text not null default '' check (length(naam) <= 500),
  geupload_door uuid references auth.users (id) on delete set null default auth.uid(),
  client_id uuid references public.clients (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists drive_bestanden_klant_idx on public.drive_bestanden (client_id);
create index if not exists drive_bestanden_project_idx on public.drive_bestanden (project_id);

alter table public.drive_bestanden enable row level security;
drop policy if exists "teamleden beheren drive-bestanden" on public.drive_bestanden;
create policy "teamleden beheren drive-bestanden" on public.drive_bestanden
  for all to authenticated
  using ((select public.is_teamlid()))
  with check ((select public.is_teamlid()));

-- ---------------------------------------------------------------------------------
-- 4. Wat er al naar Drive is gekopieerd (facturen, prijsopgaven, bonnetjes)
-- ---------------------------------------------------------------------------------
--   bron_id  invoices.id / quotes.id / expense_files.id (bewust zonder foreign key: een
--            verwijderde factuur laat zijn kopie in Drive staan)
--   bron_pad het Storage-pad van de PDF/foto die gekopieerd is; verandert het (factuur
--            bewerkt), dan wordt de kopie in Drive bijgewerkt.
create table if not exists public.drive_kopieen (
  root_id text not null check (length(root_id) between 1 and 200),
  bron text not null check (bron in ('factuur', 'prijsopgave', 'bonnetje')),
  bron_id uuid not null,
  bron_pad text not null default '' check (length(bron_pad) <= 500),
  drive_file_id text not null check (length(drive_file_id) between 1 and 200),
  gekopieerd_op timestamptz not null default now(),
  primary key (root_id, bron, bron_id)
);

alter table public.drive_kopieen enable row level security;
drop policy if exists "teamleden lezen drive-kopieen" on public.drive_kopieen;
create policy "teamleden lezen drive-kopieen" on public.drive_kopieen
  for select to authenticated
  using ((select public.is_teamlid()));
-- Schrijven doet alleen de server (service-role, na de teamlidcontrole).
revoke insert, update, delete on public.drive_kopieen from authenticated;

-- Anon heeft in public niets (0021); voor de zekerheid ook hier expliciet.
revoke all on public.drive_mappen, public.drive_bestanden, public.drive_kopieen from anon;

commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen zijn.
notify pgrst, 'reload schema';

-- Controle: elke regel hoort "ok" te tonen (en daaronder: wie er toegang heeft).
select onderdeel,
       case when aanwezig then 'ok' else 'ONTBREEKT' end as status
from (values
  ('tabel drive_koppeling',   to_regclass('public.drive_koppeling') is not null),
  ('tabel drive_mappen',      to_regclass('public.drive_mappen') is not null),
  ('tabel drive_bestanden',   to_regclass('public.drive_bestanden') is not null),
  ('tabel drive_kopieen',     to_regclass('public.drive_kopieen') is not null),
  ('RLS op de drive-tabellen', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('drive_koppeling', 'drive_mappen', 'drive_bestanden', 'drive_kopieen') and relrowsecurity) = 4),
  ('drive_koppeling zonder policies', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drive_koppeling')),
  ('drive_koppeling onleesbaar voor de app', not has_table_privilege('authenticated', 'public.drive_koppeling', 'select') and not has_table_privilege('anon', 'public.drive_koppeling', 'select')),
  ('drive-tabellen alleen voor teamleden', (select count(*) from pg_policies where schemaname = 'public' and tablename in ('drive_mappen', 'drive_bestanden', 'drive_kopieen') and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'is_teamlid\(') = 3),
  ('drive_mappen en drive_kopieen alleen door de server te schrijven', not has_table_privilege('authenticated', 'public.drive_kopieen', 'insert') and not has_table_privilege('authenticated', 'public.drive_mappen', 'insert'))
) as c(onderdeel, aanwezig)
union all
select 'teamlid: ' || coalesce(p.naam, '?') || ' <' || coalesce(p.email, '?') || '> (' || m.rol || ')',
       case when m.actief then 'actief' else 'gedeactiveerd' end
from public.team_members m
left join public.profiles p on p.id = m.user_id;
