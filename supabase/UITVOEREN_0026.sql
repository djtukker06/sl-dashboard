-- ============================================================================
-- Studio Levant-backoffice — beveiliging, meerdere inboxen en back-ups (migratie 0026)
-- ============================================================================
--
-- Wat dit doet (alleen toevoegen; de facturen-functionaliteit blijft ongewijzigd):
--   1. mailboxen       meerdere inboxen per teamlid, met naam en kleur, 'alleen ik' of
--                      'hele team'. Bestaande koppelingen uit user_mailboxes worden één keer
--                      overgezet (zelfde versleuteling). RLS aan, géén policies: wachtwoorden
--                      en servers leest alleen de server.
--   2. 2FA in de database: is_teamlid() eist voortaan een sessie na de 2FA-code (aal2) van
--                      wie een 2FA-apparaat heeft. Een gestolen wachtwoord geeft via de
--                      Supabase-API dan niets. Wie (nog) geen apparaat heeft, valt NIET buiten
--                      (de app laat hem eerst 2FA instellen). Schakelaars in app_instellingen:
--                      noodstop en "streng" (scripts/2fa-herstel.mjs, zie docs/BEVEILIGING.md).
--      audit_log       gevoelige acties; alleen de eigenaar leest, niemand wijzigt of wist.
--      inlog_pogingen  limiet op inlog- en codepogingen (alleen hashes).
--   3. backup_runs, backup_bestanden en heartbeat: status van de dagelijkse versleutelde
--      back-up naar Google Drive en de keep-alive (Supabase pauzeert anders na 7 dagen).
--
-- Vereist 0021 (team) en 0022. Nog niet uitgevoerd? Gebruik dan het grote
-- UITVOEREN_0021_TEAM.sql (bevat 0021 t/m 0026).
--
-- Zo voer je het uit (zie README "Uitrol 0026" voor de volgorde):
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan: elke regel moet "ok" tonen. Regels met een stand ("2fa_rls: stand", "teamleden
--      met 2FA", "laatste back-up", "laatste heartbeat") zijn informatief; daaronder staat wie
--      er toegang heeft.
--
-- Veilig om nogmaals uit te voeren; alles draait in één transactie (gaat er iets mis, dan
-- wordt niets half doorgevoerd). De schakelaars, de audit-log en de back-upgegevens blijven
-- staan. De app werkt vóór en na dit bestand: vóór 0026 één inbox, geen verplichte 2FA en
-- geen back-ups (wel de keep-alive).
--
-- LET OP: voer daarna nooit meer de LOSSE migratie 0021_team_en_taken.sql uit (die zet
-- is_teamlid() terug zonder 2FA-controle). De UITVOEREN_*-bestanden zijn veilig: de grote
-- eindigen met 0026.
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit
-- supabase/migrations/0026_beveiliging_mailboxen_backups.sql. Niet met de hand aanpassen;
-- pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

-- ------------------------------------------------------------------------------
-- 0026_beveiliging_mailboxen_backups.sql
-- ------------------------------------------------------------------------------

-- 0026: beveiliging, meerdere mailboxen en back-ups.
--
-- Idempotent: twee keer uitvoeren geeft geen fout en verandert niets meer. De app werkt ook
-- zonder deze migratie (dan zoals vóór 0026: één eigen inbox via user_mailboxes).
--
-- Deel 1  mailboxen     meerdere inboxen per teamlid, ook gedeeld met het hele team
-- Deel 2  beveiliging   2FA in RLS (is_teamlid), toegang_status(), audit-log, inlogpogingen
-- Deel 3  back-ups      backup_runs, backup_bestanden, heartbeat (keep-alive), backup_tabellen()
--
-- LET OP: voer na deze migratie de LOSSE migratie 0021_team_en_taken.sql niet opnieuw uit; die
-- zet is_teamlid() terug naar de versie zonder 2FA-controle. (Opnieuw 0026 uitvoeren herstelt
-- het.) De UITVOEREN_*-bestanden zijn veilig: de grote eindigen met 0026.

-- ---------------------------------------------------------------------------------
-- Deel 1. Meerdere mailboxen
--
-- Eén rij per gekoppelde inbox. Vervangt functioneel user_mailboxes (die tabel blijft
-- bestaan als terugval voor de code vóór 0026; bestaande koppelingen worden hieronder
-- overgezet).
--   - wachtwoord_enc: AES-256-GCM met MAIL_ENCRYPTION_KEY (alleen in de server-env). Nieuwe
--     koppelingen: "v2:" met eigenaar_id + id als AAD (alleen geldig op precies deze rij).
--     Overgezette ciphertexts uit user_mailboxes blijven "v1:" (AAD = eigenaar_id) en geldig.
--   - zichtbaarheid 'prive': alleen de eigenaar; 'team': alle ACTIEVE teamleden, zolang de
--     eigenaar zelf actief is. Dat filter staat in de servercode (lib/mail/zichtbaarheid.ts).
--   - RLS aan en GEEN policies: anon en authenticated lezen of schrijven niets. Alleen de
--     server (service-role, na de teamcheck) gebruikt deze tabel; wachtwoorden en servers
--     gaan nooit naar de browser.
-- ---------------------------------------------------------------------------------
create table if not exists public.mailboxen (
  id uuid primary key default gen_random_uuid(),
  eigenaar_id uuid not null references auth.users (id) on delete cascade,
  email text not null check (length(email) between 3 and 320),
  label text not null check (char_length(label) between 1 and 40),
  kleur text not null default '#c8a97e' check (kleur ~ '^#[0-9a-f]{6}$'),
  zichtbaarheid text not null default 'prive' check (zichtbaarheid in ('prive', 'team')),
  volgorde smallint not null default 0,
  imap_host text not null default 'mail.privateemail.com' check (length(imap_host) <= 253),
  imap_port int not null default 993 check (imap_port in (993, 143)),
  smtp_host text not null default 'mail.privateemail.com' check (length(smtp_host) <= 253),
  smtp_port int not null default 465 check (smtp_port in (465, 587)),
  from_name text not null default '' check (length(from_name) <= 120),
  handtekening text not null default '' check (length(handtekening) <= 5000),
  wachtwoord_enc text not null check (wachtwoord_enc ~ '^v[12]:'),
  sleutel_versie smallint not null default 1,
  geverifieerd_op timestamptz,
  gekoppeld_op timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Eén keer hetzelfde adres per eigenaar (hoofdletters tellen niet).
create unique index if not exists mailboxen_eigenaar_email on public.mailboxen (eigenaar_id, lower(email));
create index if not exists mailboxen_team on public.mailboxen (eigenaar_id) where zichtbaarheid = 'team';

drop trigger if exists mailboxen_set_updated_at on public.mailboxen;
create trigger mailboxen_set_updated_at
  before update on public.mailboxen
  for each row execute function public.set_updated_at();

alter table public.mailboxen enable row level security;
revoke all on public.mailboxen from anon, authenticated;
grant select, insert, update, delete on public.mailboxen to service_role;

-- Bestaande koppelingen overzetten (één keer; daarna doet "on conflict" niets meer).
-- Label = het deel vóór de @ (bv. "Daniel"), kleur = de profielkleur, alleen voor jezelf.
insert into public.mailboxen (
  eigenaar_id, email, label, kleur, zichtbaarheid, volgorde,
  imap_host, imap_port, smtp_host, smtp_port, from_name, handtekening,
  wachtwoord_enc, sleutel_versie, geverifieerd_op, gekoppeld_op
)
select
  m.user_id,
  lower(m.email),
  left(coalesce(nullif(initcap(split_part(m.email, '@', 1)), ''), 'Inbox'), 40),
  coalesce(
    (select lower(p.kleur) from public.profiles p where p.id = m.user_id and lower(p.kleur) ~ '^#[0-9a-f]{6}$'),
    '#c8a97e'
  ),
  'prive',
  0,
  m.imap_host, m.imap_port, m.smtp_host, m.smtp_port, m.from_name, m.handtekening,
  m.wachtwoord_enc, m.sleutel_versie, m.geverifieerd_op, coalesce(m.updated_at, now())
from public.user_mailboxes m
on conflict (eigenaar_id, lower(email)) do nothing;

-- ---------------------------------------------------------------------------------
-- Deel 2. Beveiliging: tweestapsverificatie (2FA) in RLS, audit-log en inlogpogingen
--
-- app_instellingen   één rij (id = 1) met de 2FA-schakelaars voor de database:
--                      tfa_rls         true  = wie een 2FA-factor heeft, ziet alleen data met
--                                              een sessie op aal2 (na de code). Noodstop:
--                                              false (scripts/2fa-herstel.mjs --rls uit).
--                      tfa_rls_streng  false = wie (nog) GEEN factor heeft, mag er ook in (de
--                                              app dwingt het instellen af). Pas op true zetten
--                                              als iedereen een factor heeft (--streng aan).
--                    Alleen te schrijven met de service-role (script).
-- audit_log          gevoelige acties (inloggen, 2FA, mailboxen, export, verwijderen, ...).
--                    Alleen de eigenaar (met 2FA-sessie) leest; niemand wijzigt of verwijdert
--                    (trigger), behalve audit_opruimen() voor regels ouder dan 400 dagen.
-- inlog_pogingen     mislukte inlog- en codepogingen (alleen hashes), voor de limiet per
--                    e-mailadres en per IP. Alleen de service-role.
-- toegang_status()   lidmaatschap + rol + aal + "heeft een factor" in één rondgang (proxy en
--                    inloggen).
-- is_teamlid()       opnieuw gedefinieerd: actief teamlid EN (noodstop OF aal2 OF nog geen
--                    factor en niet streng). Een gestolen wachtwoord van iemand met 2FA geeft
--                    via de API dus niets. Iemand zonder factor valt nooit buiten.
-- is_eigenaar()      is_teamlid() en rol 'eigenaar'.
-- ---------------------------------------------------------------------------------
create table if not exists public.app_instellingen (
  id smallint primary key default 1 check (id = 1),
  tfa_rls boolean not null default true,
  tfa_rls_streng boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.app_instellingen (id) values (1) on conflict (id) do nothing;

drop trigger if exists app_instellingen_set_updated_at on public.app_instellingen;
create trigger app_instellingen_set_updated_at
  before update on public.app_instellingen
  for each row execute function public.set_updated_at();

alter table public.app_instellingen enable row level security;
revoke all on public.app_instellingen from anon, authenticated;
grant select on public.app_instellingen to authenticated;
grant select, insert, update on public.app_instellingen to service_role;

-- De kern: wie mag bij de data? (Eén create or replace: er is geen moment zonder controle.)
-- SECURITY DEFINER met leeg search_path: mag auth.mfa_factors lezen, niet te kapen.
create or replace function public.is_teamlid()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.team_members
      where user_id = (select auth.uid()) and actief
    )
    and (
      -- Noodstop (scripts/2fa-herstel.mjs --rls uit): 2FA telt even niet mee.
      coalesce((select not i.tfa_rls from public.app_instellingen i where i.id = 1), false)
      -- Sessie na de 2FA-code.
      or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
      -- Nog geen (geverifieerde) factor: niet buitensluiten, tenzij streng.
      or (
        not coalesce((select i.tfa_rls_streng from public.app_instellingen i where i.id = 1), false)
        and not exists (
          select 1 from auth.mfa_factors f
          where f.user_id = (select auth.uid()) and f.status::text = 'verified'
        )
      )
    );
$$;

create or replace function public.is_eigenaar()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teamlid() and exists (
    select 1 from public.team_members
    where user_id = (select auth.uid()) and actief and rol = 'eigenaar'
  );
$$;

create or replace function public.toegang_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lid', coalesce(tm.actief, false),
    'rol', tm.rol,
    'aal', coalesce((select auth.jwt()) ->> 'aal', 'aal1'),
    'heeft_factor', exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status::text = 'verified'
    ),
    'tfa_rls', coalesce((select i.tfa_rls from public.app_instellingen i where i.id = 1), true),
    'tfa_rls_streng', coalesce((select i.tfa_rls_streng from public.app_instellingen i where i.id = 1), false),
    'versie', 26
  )
  from (select 1) as x
  left join public.team_members tm on tm.user_id = (select auth.uid());
$$;

revoke all on function public.is_teamlid() from public, anon;
revoke all on function public.is_eigenaar() from public, anon;
revoke all on function public.toegang_status() from public, anon;
grant execute on function public.is_teamlid() to authenticated, service_role;
grant execute on function public.is_eigenaar() to authenticated, service_role;
grant execute on function public.toegang_status() to authenticated, service_role;

drop policy if exists "teamleden lezen instellingen" on public.app_instellingen;
create policy "teamleden lezen instellingen" on public.app_instellingen
  for select to authenticated using ((select public.is_teamlid()));

-- Audit-log (alleen toevoegen). Geen foreign key op user_id: regels blijven bestaan als een
-- gebruiker wordt verwijderd. In details nooit wachtwoorden, tokens of mailinhoud (de app
-- laat alleen een vaste lijst sleutels door, lib/audit.ts).
create table if not exists public.audit_log (
  id bigserial primary key,
  op timestamptz not null default now(),
  user_id uuid,
  actie text not null check (actie ~ '^[a-z0-9_]{2,60}$'),
  doel text check (length(doel) <= 200),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and length(details::text) <= 4000),
  ip_hash text check (length(ip_hash) <= 64),
  ua text check (length(ua) <= 120),
  bron text not null default 'app' check (bron in ('app', 'script', 'cron', 'github', 'systeem'))
);
create index if not exists audit_log_op on public.audit_log (op desc);
create index if not exists audit_log_actie_op on public.audit_log (actie, op desc);
create index if not exists audit_log_user_op on public.audit_log (user_id, op desc);

create or replace function public.audit_log_onveranderbaar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('sl.audit_opruimen', true) = 'aan' then
    return old;
  end if;
  raise exception 'audit_log is alleen-toevoegen' using errcode = '42501';
end;
$$;

drop trigger if exists audit_log_geen_wijziging on public.audit_log;
create trigger audit_log_geen_wijziging
  before update or delete on public.audit_log
  for each row execute function public.audit_log_onveranderbaar();
drop trigger if exists audit_log_geen_truncate on public.audit_log;
create trigger audit_log_geen_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_onveranderbaar();

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
revoke update, delete, truncate on public.audit_log from service_role;
grant select on public.audit_log to authenticated;
grant select, insert on public.audit_log to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

drop policy if exists "eigenaar leest audit-log" on public.audit_log;
-- is_teamlid() staat er expliciet bij (is_eigenaar() roept hem ook aan): zo blijft de
-- controle "elke policy vereist teamlid" (UITVOEREN_*.sql) kloppen.
create policy "eigenaar leest audit-log" on public.audit_log
  for select to authenticated using ((select public.is_teamlid()) and (select public.is_eigenaar()));

-- Opruimen van regels ouder dan p_dagen (minimaal 90): alleen de service-role (dagelijkse cron).
create or replace function public.audit_opruimen(p_dagen int default 400)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  perform set_config('sl.audit_opruimen', 'aan', true);
  delete from public.audit_log where op < now() - make_interval(days => greatest(coalesce(p_dagen, 400), 90));
  get diagnostics n = row_count;
  perform set_config('sl.audit_opruimen', '', true);
  return n;
end;
$$;
revoke all on function public.audit_opruimen(int) from public, anon, authenticated;
grant execute on function public.audit_opruimen(int) to service_role;

-- Inlogpogingen: alleen hashes (e:<hash e-mail>, i:<hash ip>, t:<hash gebruiker> voor
-- 2FA-codes, w:<hash e-mail> voor wachtwoord-vergeten). Alleen de service-role.
create table if not exists public.inlog_pogingen (
  id bigserial primary key,
  sleutel text not null check (sleutel ~ '^[a-z]:[0-9a-f]{16,64}$'),
  op timestamptz not null default now(),
  gelukt boolean not null default false
);
create index if not exists inlog_pogingen_sleutel_op on public.inlog_pogingen (sleutel, op desc);

alter table public.inlog_pogingen enable row level security;
revoke all on public.inlog_pogingen from anon, authenticated;
revoke all on sequence public.inlog_pogingen_id_seq from anon, authenticated;
grant select, insert, delete on public.inlog_pogingen to service_role;
grant usage, select on sequence public.inlog_pogingen_id_seq to service_role;

-- ---------------------------------------------------------------------------------
-- Deel 3. Back-ups en keep-alive
--
-- backup_runs       één rij per back-up (database-export of bestandensync): status,
--                   grootte, sha256, sleutel-id, tellingen per tabel, korte fout (nooit data).
--                   De eigenaar (aal2) leest; schrijven alleen de service-role (cron/route).
-- backup_bestanden  welke storage-bestanden al (versleuteld) in Drive staan, voor de
--                   wekelijkse incrementele sync. Alleen de service-role.
-- heartbeat         de dagelijkse keep-alive (Vercel Cron, GitHub Actions): een kleine
--                   schrijfactie zodat het gratis Supabase-project nooit pauzeert. De
--                   eigenaar leest; de cron houdt de laatste 120 rijen.
-- backup_tabellen() de basistabellen in public (alleen service-role), zodat de export
--                   waarschuwt als er een tabel bij is gekomen die niet in de vaste lijst staat.
-- ---------------------------------------------------------------------------------
create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  soort text not null check (soort in ('db', 'bestanden')),
  bron text not null default 'cron' check (bron in ('cron', 'github', 'handmatig', 'script')),
  gestart timestamptz not null default now(),
  klaar timestamptz,
  status text not null default 'bezig' check (status in ('bezig', 'ok', 'mislukt', 'overgeslagen')),
  bestand text check (length(bestand) <= 200),
  drive_id text check (length(drive_id) <= 200),
  grootte bigint check (grootte >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  sleutel_id text check (sleutel_id ~ '^[0-9a-f]{16}$'),
  tellingen jsonb not null default '{}'::jsonb check (jsonb_typeof(tellingen) = 'object' and length(tellingen::text) <= 8000),
  fout text check (length(fout) <= 500),
  door uuid
);
create index if not exists backup_runs_soort_gestart on public.backup_runs (soort, gestart desc);

alter table public.backup_runs enable row level security;
revoke all on public.backup_runs from anon, authenticated;
grant select on public.backup_runs to authenticated;
grant select, insert, update, delete on public.backup_runs to service_role;

drop policy if exists "eigenaar leest back-ups" on public.backup_runs;
create policy "eigenaar leest back-ups" on public.backup_runs
  for select to authenticated using ((select public.is_teamlid()) and (select public.is_eigenaar()));

create table if not exists public.backup_bestanden (
  bucket text not null check (length(bucket) between 1 and 63),
  pad text not null check (length(pad) between 1 and 1024),
  grootte bigint,
  bijgewerkt timestamptz,
  etag text check (length(etag) <= 200),
  drive_id text check (length(drive_id) <= 200),
  gesynchroniseerd_op timestamptz not null default now(),
  verwijderd_op timestamptz,
  primary key (bucket, pad)
);

alter table public.backup_bestanden enable row level security;
revoke all on public.backup_bestanden from anon, authenticated;
grant select, insert, update, delete on public.backup_bestanden to service_role;

create table if not exists public.heartbeat (
  id bigserial primary key,
  op timestamptz not null default now(),
  bron text not null default 'cron' check (bron in ('cron', 'github', 'handmatig', 'script'))
);
create index if not exists heartbeat_op on public.heartbeat (op desc);

alter table public.heartbeat enable row level security;
revoke all on public.heartbeat from anon, authenticated;
revoke all on sequence public.heartbeat_id_seq from anon, authenticated;
grant select on public.heartbeat to authenticated;
grant select, insert, delete on public.heartbeat to service_role;
grant usage, select on sequence public.heartbeat_id_seq to service_role;

drop policy if exists "eigenaar leest heartbeat" on public.heartbeat;
create policy "eigenaar leest heartbeat" on public.heartbeat
  for select to authenticated using ((select public.is_teamlid()) and (select public.is_eigenaar()));

create or replace function public.backup_tabellen()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  order by 1;
$$;
revoke all on function public.backup_tabellen() from public, anon, authenticated;
grant execute on function public.backup_tabellen() to service_role;

commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen en functies zijn.
notify pgrst, 'reload schema';

-- Controle: elke regel hoort "ok" te tonen (en daaronder: wie er toegang heeft).
select onderdeel,
       case when aanwezig then 'ok' else 'ONTBREEKT' end as status
from (values
  ('mailboxen: tabel',        to_regclass('public.mailboxen') is not null),
  ('mailboxen: RLS aan',      coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.mailboxen')), false)),
  ('mailboxen: zonder policies', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mailboxen')),
  ('mailboxen: onleesbaar voor de app (wachtwoorden alleen op de server)', not has_table_privilege('anon', 'public.mailboxen', 'select') and not has_table_privilege('authenticated', 'public.mailboxen', 'select') and not has_table_privilege('authenticated', 'public.mailboxen', 'insert') and not has_table_privilege('authenticated', 'public.mailboxen', 'update')),
  ('mailboxen: één keer hetzelfde adres per eigenaar', exists (select 1 from pg_class where relname = 'mailboxen_eigenaar_email')),
  ('mailboxen: alle bestaande koppelingen overgezet', not exists (select 1 from public.user_mailboxes u where not exists (select 1 from public.mailboxen m where m.eigenaar_id = u.user_id and lower(m.email) = lower(u.email)))),
  ('mailboxen: aantal inboxen ' || (select count(*) from public.mailboxen) || ', waarvan gedeeld met het team ' || (select count(*) from public.mailboxen where zichtbaarheid = 'team'), true),
  ('2fa_rls: is_teamlid() met 2FA-controle', coalesce(pg_get_functiondef(to_regprocedure('public.is_teamlid()')) ~ 'mfa_factors' and pg_get_functiondef(to_regprocedure('public.is_teamlid()')) ~ 'aal2', false)),
  ('2fa_rls: functies toegang_status en is_eigenaar', to_regprocedure('public.toegang_status()') is not null and to_regprocedure('public.is_eigenaar()') is not null),
  ('2fa_rls: functies dicht voor anon', not has_function_privilege('anon', 'public.toegang_status()', 'execute') and not has_function_privilege('anon', 'public.is_teamlid()', 'execute')),
  ('2fa_rls: instellingen (één rij)', (select count(*) from public.app_instellingen) = 1),
  ('2fa_rls: instellingen niet te wijzigen door de app', not has_table_privilege('authenticated', 'public.app_instellingen', 'update') and not has_table_privilege('authenticated', 'public.app_instellingen', 'insert')),
  ('2fa_rls: stand: ' || case when (select tfa_rls from public.app_instellingen where id = 1) is false then 'NOODSTOP (2FA telt niet mee; scripts/2fa-herstel.mjs --rls aan)' when (select tfa_rls_streng from public.app_instellingen where id = 1) then 'aan, streng (ook wie geen 2FA heeft ziet niets)' else 'aan (wie 2FA heeft, moet de code invullen)' end, true),
  ('2fa_rls: teamleden met 2FA: ' || (select count(*) from public.team_members m where m.actief and exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status::text = 'verified')) || ' van ' || (select count(*) from public.team_members where actief), true),
  ('audit_log: tabel en RLS', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.audit_log')), false)),
  ('audit_log: alleen de eigenaar leest', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and cmd = 'SELECT' and qual ~ 'is_eigenaar\(') and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'audit_log') = 1),
  ('audit_log: niet te wijzigen of te verwijderen (trigger)', exists (select 1 from pg_trigger where tgname = 'audit_log_geen_wijziging' and tgrelid = 'public.audit_log'::regclass) and exists (select 1 from pg_trigger where tgname = 'audit_log_geen_truncate' and tgrelid = 'public.audit_log'::regclass)),
  ('audit_log: app schrijft niets direct', not has_table_privilege('anon', 'public.audit_log', 'select') and not has_table_privilege('authenticated', 'public.audit_log', 'insert') and not has_table_privilege('authenticated', 'public.audit_log', 'update') and not has_table_privilege('authenticated', 'public.audit_log', 'delete')),
  ('audit_log: opruimen alleen via de server', to_regprocedure('public.audit_opruimen(integer)') is not null and not has_function_privilege('authenticated', 'public.audit_opruimen(integer)', 'execute') and not has_function_privilege('anon', 'public.audit_opruimen(integer)', 'execute')),
  ('inlog_pogingen: zonder policies', to_regclass('public.inlog_pogingen') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inlog_pogingen')),
  ('inlog_pogingen: onleesbaar voor de app', not has_table_privilege('anon', 'public.inlog_pogingen', 'select') and not has_table_privilege('authenticated', 'public.inlog_pogingen', 'select') and not has_table_privilege('authenticated', 'public.inlog_pogingen', 'insert')),
  ('backups: tabellen backup_runs en backup_bestanden', to_regclass('public.backup_runs') is not null and to_regclass('public.backup_bestanden') is not null),
  ('backups: backup_runs alleen voor de eigenaar', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'backup_runs' and cmd = 'SELECT' and qual ~ 'is_eigenaar\(') = 1 and not has_table_privilege('authenticated', 'public.backup_runs', 'insert') and not has_table_privilege('anon', 'public.backup_runs', 'select')),
  ('backups: backup_bestanden zonder policies en onleesbaar', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'backup_bestanden') and not has_table_privilege('anon', 'public.backup_bestanden', 'select') and not has_table_privilege('authenticated', 'public.backup_bestanden', 'select') and not has_table_privilege('authenticated', 'public.backup_bestanden', 'insert')),
  ('backups: backup_tabellen() alleen voor de server', to_regprocedure('public.backup_tabellen()') is not null and not has_function_privilege('authenticated', 'public.backup_tabellen()', 'execute') and not has_function_privilege('anon', 'public.backup_tabellen()', 'execute')),
  ('backups: laatste geslaagde back-up: ' || coalesce((select to_char(max(klaar) at time zone 'Europe/Amsterdam', 'YYYY-MM-DD HH24:MI') from public.backup_runs where soort = 'db' and status = 'ok'), 'nog geen'), true),
  ('heartbeat: tabel en RLS', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.heartbeat')), false)),
  ('heartbeat: alleen de eigenaar leest', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'heartbeat' and cmd = 'SELECT' and qual ~ 'is_eigenaar\(') = 1 and not has_table_privilege('anon', 'public.heartbeat', 'select') and not has_table_privilege('authenticated', 'public.heartbeat', 'insert')),
  ('heartbeat: laatste: ' || coalesce((select to_char(max(op) at time zone 'Europe/Amsterdam', 'YYYY-MM-DD HH24:MI') || ' (' || (select bron from public.heartbeat order by op desc limit 1) || ')' from public.heartbeat), 'nog geen (komt na de eerste nachtelijke taak)'), true)
) as c(onderdeel, aanwezig)
union all
select 'teamlid: ' || coalesce(p.naam, '?') || ' <' || coalesce(p.email, '?') || '> (' || m.rol || ')',
       case when m.actief then 'actief' else 'gedeactiveerd' end
from public.team_members m
left join public.profiles p on p.id = m.user_id;
