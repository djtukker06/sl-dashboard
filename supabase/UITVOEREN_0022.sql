-- ============================================================================
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
--     afgerond), een deadline en eigenaren (project_eigenaren).
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

-- ------------------------------------------------------------------------------
-- 0022_team_crm.sql
-- ------------------------------------------------------------------------------

-- 0022: het team van twee (Daniel en Bram) — welkomstflow, wie-ziet-welke-taak, klanten
-- en projecten. Idempotent: twee keer uitvoeren geeft geen fout. Alleen toevoegen; de
-- facturen-functionaliteit (tabellen, RPC's) blijft ongewijzigd. Vereist 0021.
--
-- Dit bestand groeit per bouwstap:
--   stap 1  profiles.welkom_klaar_op (welkomstflow bij de eerste login)
--   stap 2  wie ziet welke taak/afspraak (leesregels), index voor "Uitgezet"
--   stap 3  klanten & projecten: contact/status op clients, client_notes, projectstatus
--           gepland/bezig/afgerond + deadline + project_eigenaren
--   stap 4  snelheid: tellingen in één query (taak_tellingen, project_taak_tellingen) en
--           indexen voor de agenda en de klantpagina

-- ---------------------------------------------------------------------------------
-- Stap 1. Welkomstflow
-- ---------------------------------------------------------------------------------
-- null = de welkomstflow (/welkom) is nog niet doorlopen. De app stuurt een teamlid
-- zolang naar /welkom; zonder deze kolom (0022 nog niet uitgevoerd) slaat de app de
-- flow over.
alter table public.profiles add column if not exists welkom_klaar_op timestamptz;

-- Bestaande eigenaren (Daniel) hebben alles al ingericht: zij zien de flow nooit.
-- Een lid (Bram) wel, ook als hij al vóór deze migratie is uitgenodigd.
update public.profiles p
   set welkom_klaar_op = now()
  from public.team_members m
 where m.user_id = p.id
   and m.rol = 'eigenaar'
   and p.welkom_klaar_op is null;

-- Je mag alleen deze kolom van je EIGEN profiel zetten (de bestaande policy "eigen profiel
-- aanpassen" uit 0021 beperkt tot id = auth.uid() en een actief teamlid). Andere kolommen
-- (e-mail, id) blijven dicht; naam/initialen/kleur waren al toegestaan.
grant update (welkom_klaar_op) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------------
-- Stap 2. Wie ziet welke taak en afspraak
-- ---------------------------------------------------------------------------------
-- Tot nu toe mocht elk teamlid ALLE taken en afspraken lezen (agenda-filter "Heel team").
-- Nu geldt: een taak die Daniel alleen voor Bram maakt, staat bij Bram — en bestaat voor
-- een derde niet, ook niet via de API. Lezen mag:
--   - de maker (die ziet hem onder "Uitgezet", niet in zijn eigen lijst);
--   - wie de taak heeft gekregen (task_assignees);
--   - bij een taak in een project: het hele team (voortgang op de projectpagina). Zo'n
--     taak staat nooit in iemands eigen lijst; die lijsten filteren op task_assignees.
-- Afspraken: de maker en de deelnemers (event_attendees).
-- Wijzigen blijft zoals in 0021 (taak_betrokken / afspraak_betrokken).

-- SECURITY DEFINER: leest tasks/task_assignees zonder RLS, zodat de policies op
-- task_assignees/task_subtasks niet via tasks in een lus terechtkomen.
create or replace function public.taak_zichtbaar(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teamlid() and exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (t.created_by = (select auth.uid())
           or t.project_id is not null
           or exists (select 1 from public.task_assignees a
                      where a.task_id = t.id and a.user_id = (select auth.uid())))
  );
$$;

revoke all on function public.taak_zichtbaar(uuid) from public, anon;
grant execute on function public.taak_zichtbaar(uuid) to authenticated, service_role;

drop policy if exists "teamleden lezen taken" on public.tasks;
drop policy if exists "betrokkenen lezen taken" on public.tasks;
create policy "betrokkenen lezen taken" on public.tasks
  for select to authenticated
  using (
    (select public.is_teamlid())
    and (created_by = (select auth.uid())
         or project_id is not null
         or exists (select 1 from public.task_assignees a
                    where a.task_id = tasks.id and a.user_id = (select auth.uid())))
  );

drop policy if exists "teamleden lezen toewijzingen" on public.task_assignees;
drop policy if exists "betrokkenen lezen toewijzingen" on public.task_assignees;
create policy "betrokkenen lezen toewijzingen" on public.task_assignees
  for select to authenticated
  using ((select public.is_teamlid()) and (user_id = (select auth.uid()) or public.taak_zichtbaar(task_id)));

drop policy if exists "teamleden lezen subtaken" on public.task_subtasks;
drop policy if exists "betrokkenen lezen subtaken" on public.task_subtasks;
create policy "betrokkenen lezen subtaken" on public.task_subtasks
  for select to authenticated
  using ((select public.is_teamlid()) and public.taak_zichtbaar(task_id));

drop policy if exists "teamleden lezen afspraken" on public.calendar_events;
drop policy if exists "betrokkenen lezen afspraken" on public.calendar_events;
create policy "betrokkenen lezen afspraken" on public.calendar_events
  for select to authenticated
  using (
    (select public.is_teamlid())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.event_attendees a
                    where a.event_id = calendar_events.id and a.user_id = (select auth.uid())))
  );

drop policy if exists "teamleden lezen deelnemers" on public.event_attendees;
drop policy if exists "betrokkenen lezen deelnemers" on public.event_attendees;
create policy "betrokkenen lezen deelnemers" on public.event_attendees
  for select to authenticated
  using ((select public.is_teamlid()) and (user_id = (select auth.uid()) or public.afspraak_betrokken(event_id)));

-- "Uitgezet": open taken die jij maakte (en waar je zelf niet op staat).
create index if not exists tasks_maker_open_idx on public.tasks (created_by) where completed_at is null;

-- ---------------------------------------------------------------------------------
-- Stap 3. Klanten & projecten (simpel: weinig velden, geen pipeline, geen uren)
-- ---------------------------------------------------------------------------------
-- Klanten: e-mail, telefoon en een status (lead / actief / afgerond). Alleen kolommen
-- erbij, met standaardwaarden: de facturen (formulieren, RPC's, PDF) sturen deze kolommen
-- niet mee en werken ongewijzigd; een klant die via een factuur ontstaat is 'actief'.
alter table public.clients
  add column if not exists email text not null default '' check (length(email) <= 320),
  add column if not exists telefoon text not null default '' check (length(telefoon) <= 40),
  add column if not exists status text not null default 'actief' check (status in ('lead', 'actief', 'afgerond'));

create index if not exists clients_status_idx on public.clients (status);

-- Korte notities per klant (tijdlijn op de klantpagina). Gedeeld met het team; alleen de
-- schrijver kan zijn notitie verwijderen. Wijzigen kan niet (geen update-policy).
create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  tekst text not null check (length(btrim(tekst)) between 1 and 2000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists client_notes_klant_idx on public.client_notes (client_id, created_at desc);

alter table public.client_notes enable row level security;
drop policy if exists "teamleden lezen klantnotities" on public.client_notes;
create policy "teamleden lezen klantnotities" on public.client_notes
  for select to authenticated using ((select public.is_teamlid()));
drop policy if exists "teamleden schrijven klantnotities" on public.client_notes;
create policy "teamleden schrijven klantnotities" on public.client_notes
  for insert to authenticated
  with check ((select public.is_teamlid()) and created_by = (select auth.uid()));
drop policy if exists "schrijver verwijdert klantnotitie" on public.client_notes;
create policy "schrijver verwijdert klantnotitie" on public.client_notes
  for delete to authenticated
  using ((select public.is_teamlid()) and created_by = (select auth.uid()));
revoke update on public.client_notes from anon, authenticated;

-- Projecten: status gepland / bezig / afgerond (was actief / gearchiveerd), een optionele
-- deadline en een langere notitie. Oude waarden worden omgezet; de app leest beide.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.projects'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%status%' or pg_get_constraintdef(oid) ilike '%notitie%')
  loop
    execute format('alter table public.projects drop constraint %I', c.conname);
  end loop;
end
$$;

update public.projects set status = 'bezig' where status = 'actief';
update public.projects set status = 'afgerond' where status = 'gearchiveerd';

alter table public.projects alter column status set default 'bezig';
alter table public.projects add constraint projects_status_check check (status in ('gepland', 'bezig', 'afgerond'));
alter table public.projects add constraint projects_notitie_check check (length(notitie) <= 5000);
alter table public.projects add column if not exists deadline date;

create index if not exists projects_status_idx on public.projects (status);
-- Klantpagina: taken van een klant (open taken, klantfilter in de agenda).
create index if not exists tasks_client_idx on public.tasks (client_id) where client_id is not null;

-- Eigenaar(s) van een project (wie het trekt). Gedeeld met het team; alleen actieve
-- teamleden kunnen eigenaar zijn. Bestaande projecten krijgen bij de eerste keer hun
-- maker (of de eigenaar van het team) als eigenaar.
do $$
declare
  nieuw boolean := to_regclass('public.project_eigenaren') is null;
begin
  create table if not exists public.project_eigenaren (
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (project_id, user_id)
  );
  if nieuw then
    insert into public.project_eigenaren (project_id, user_id)
    select p.id, coalesce(p.created_by, public.team_eigenaar())
    from public.projects p
    where coalesce(p.created_by, public.team_eigenaar()) is not null
    on conflict do nothing;
  end if;
end
$$;
create index if not exists project_eigenaren_user_idx on public.project_eigenaren (user_id);

alter table public.project_eigenaren enable row level security;
drop policy if exists "teamleden lezen projecteigenaren" on public.project_eigenaren;
create policy "teamleden lezen projecteigenaren" on public.project_eigenaren
  for select to authenticated using ((select public.is_teamlid()));
drop policy if exists "teamleden kiezen projecteigenaren" on public.project_eigenaren;
create policy "teamleden kiezen projecteigenaren" on public.project_eigenaren
  for insert to authenticated
  with check ((select public.is_teamlid()) and public.is_actief_teamlid(user_id));
drop policy if exists "teamleden halen projecteigenaren weg" on public.project_eigenaren;
create policy "teamleden halen projecteigenaren weg" on public.project_eigenaren
  for delete to authenticated using ((select public.is_teamlid()));
revoke update on public.project_eigenaren from anon, authenticated;

-- ---------------------------------------------------------------------------------
-- Stap 4. Snelheid
-- ---------------------------------------------------------------------------------
-- De tellers van de takenlijst (Vandaag, Te laat, Gepland, Ooit, Uitgezet) in één query
-- i.p.v. vijf. SECURITY INVOKER: de leesregels hierboven gelden gewoon; je telt alleen wat
-- je mag zien. "Mijn" = ik sta erop (task_assignees); "uitgezet" = ik maakte hem en sta er
-- zelf niet op — dezelfde regels als de lijsten in de app (lib/agenda/repo.ts).
create or replace function public.taak_tellingen(p_vandaag date, p_project uuid default null, p_klant uuid default null)
returns table (vandaag integer, telaat integer, gepland integer, ooit integer, uitgezet integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (count(*) filter (where x.mijn and x.due_date <= p_vandaag))::integer,
    (count(*) filter (where x.mijn and x.due_date < p_vandaag))::integer,
    (count(*) filter (where x.mijn and x.due_date > p_vandaag))::integer,
    (count(*) filter (where x.mijn and x.due_date is null))::integer,
    (count(*) filter (where not x.mijn and x.created_by = (select auth.uid())))::integer
  from (
    select t.due_date, t.created_by,
           exists (select 1 from public.task_assignees a
                   where a.task_id = t.id and a.user_id = (select auth.uid())) as mijn
    from public.tasks t
    where t.completed_at is null
      and (p_project is null or t.project_id = p_project)
      and (p_klant is null or t.client_id = p_klant)
  ) x;
$$;
revoke all on function public.taak_tellingen(date, uuid, uuid) from public, anon;
grant execute on function public.taak_tellingen(date, uuid, uuid) to authenticated, service_role;

-- Voortgang per project (open / totaal) met een group by, i.p.v. alle taakrijen naar de
-- app halen. Ook SECURITY INVOKER: projecttaken zijn voor het team leesbaar (stap 2).
create or replace function public.project_taak_tellingen(p_projecten uuid[] default null)
returns table (project_id uuid, open integer, totaal integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.project_id,
         (count(*) filter (where t.completed_at is null))::integer,
         count(*)::integer
  from public.tasks t
  where t.project_id is not null
    and (p_projecten is null or t.project_id = any (p_projecten))
  group by t.project_id;
$$;
revoke all on function public.project_taak_tellingen(uuid[]) from public, anon;
grant execute on function public.project_taak_tellingen(uuid[]) to authenticated, service_role;

-- Indexen (de data is klein; dit houdt het vlot als hij groeit).
-- Agenda en dashboard zoeken op datum, ook in afgeronde taken (de index uit 0018 dekt
-- alleen open taken).
create index if not exists tasks_due_idx on public.tasks (due_date) where due_date is not null;
-- Klantfilter in de agenda / klantpagina.
create index if not exists calendar_events_client_idx on public.calendar_events (client_id) where client_id is not null;
-- Afspraken waar de maker in staat (leesregel stap 2) en Uitgezet voor afgeronde taken.
create index if not exists calendar_events_maker_idx on public.calendar_events (created_by);
create index if not exists tasks_maker_idx on public.tasks (created_by, completed_at);

commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe kolommen en functies zijn.
notify pgrst, 'reload schema';

-- Controle: elke regel hoort "ok" te tonen (en daaronder: wie er toegang heeft).
select onderdeel,
       case when aanwezig then 'ok' else 'ONTBREEKT' end as status
from (values
  ('kolom profiles.welkom_klaar_op', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'welkom_klaar_op')),
  ('eigenaren slaan de welkomstflow over', not exists (select 1 from public.team_members m join public.profiles p on p.id = m.user_id where m.rol = 'eigenaar' and p.welkom_klaar_op is null)),
  ('functie taak_zichtbaar',  to_regprocedure('public.taak_zichtbaar(uuid)') is not null),
  ('taken alleen voor betrokkenen', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'betrokkenen lezen taken')),
  ('afspraken alleen voor betrokkenen', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_events' and policyname = 'betrokkenen lezen afspraken')),
  ('geen open leesregels voor taken', not exists (select 1 from pg_policies where schemaname = 'public' and policyname in ('teamleden lezen taken', 'teamleden lezen toewijzingen', 'teamleden lezen subtaken', 'teamleden lezen afspraken', 'teamleden lezen deelnemers'))),
  ('kolommen clients (email, telefoon, status)', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name in ('email', 'telefoon', 'status')) = 3),
  ('tabel client_notes',      to_regclass('public.client_notes') is not null),
  ('tabel project_eigenaren', to_regclass('public.project_eigenaren') is not null),
  ('kolom projects.deadline', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'deadline')),
  ('projectstatus omgezet',   not exists (select 1 from public.projects where status not in ('gepland', 'bezig', 'afgerond'))),
  ('functie taak_tellingen',  to_regprocedure('public.taak_tellingen(date,uuid,uuid)') is not null),
  ('functie project_taak_tellingen', to_regprocedure('public.project_taak_tellingen(uuid[])') is not null),
  ('tellingen dicht voor anon', not has_function_privilege('anon', 'public.taak_tellingen(date,uuid,uuid)', 'execute')),
  ('indexen 0022',            (select count(*) from pg_class where relname in ('tasks_maker_open_idx', 'clients_status_idx', 'client_notes_klant_idx', 'projects_status_idx', 'tasks_client_idx', 'project_eigenaren_user_idx', 'tasks_due_idx', 'calendar_events_client_idx', 'calendar_events_maker_idx', 'tasks_maker_idx')) = 10)
) as c(onderdeel, aanwezig)
union all
select 'teamlid: ' || coalesce(p.naam, '?') || ' <' || coalesce(p.email, '?') || '> (' || m.rol || ')',
       case when m.actief then 'actief' else 'gedeactiveerd' end
from public.team_members m
left join public.profiles p on p.id = m.user_id;
