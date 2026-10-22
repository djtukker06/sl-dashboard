-- Team, toegang en taken op naam.
--
--   profiles         weergavegegevens per gebruiker (naam, initialen, kleur); zelf aan te passen
--   team_members     de allowlist: alleen wie hier actief in staat, komt erin. Alleen te
--                    schrijven met de service-role (scripts/teamlid-*.mjs), nooit vanuit de app
--   is_teamlid()     de controle die ALLE policies gebruiken (i.p.v. "auth.uid() is not null")
--   projects         projecten (optioneel aan een klant gekoppeld)
--   task_assignees   voor wie een taak is (één of meer teamleden)
--   task_subtasks    afvinkbare subtaken
--   event_attendees  wie bij een afspraak hoort
--   user_mailboxes   eigen mailbox per gebruiker (wachtwoord versleuteld door de server;
--                    alleen de service-role leest deze tabel)
--
-- Waarom: tot nu toe was elke policy "auth.uid() is not null". Met de anon key uit de
-- browser kan iedereen zich (zolang aanmelden aan staat) registreren en daarna via de
-- REST-API en Storage alles lezen en schrijven. Vanaf nu telt alleen lidmaatschap.
-- Zet daarnaast in Supabase "Allow new users to sign up" en anonieme sign-ins UIT (README).
--
-- Volledig idempotent: veilig om (nogmaals) uit te voeren in de SQL Editor. Werkt ook als
-- 0020 (uitgaven) nog niet is uitgevoerd: de uitgaven-onderdelen worden dan overgeslagen
-- (voer dit bestand na 0020 dan gewoon nog een keer uit). Vereist 0001–0019.
-- Er wordt niets verwijderd: bestaande taken en afspraken gaan naar hun maker (of de eigenaar).

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 1. Team
-- ---------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  naam text not null check (length(btrim(naam)) between 1 and 80),
  initialen text not null check (char_length(initialen) between 1 and 3 and initialen = upper(initialen)),
  kleur text not null default '#c8a97e' check (kleur ~ '^#[0-9a-f]{6}$'),
  email text not null default '' check (length(email) <= 320),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create table if not exists public.team_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  actief boolean not null default true,
  rol text not null default 'lid' check (rol in ('eigenaar', 'lid')),
  toegevoegd_op timestamptz not null default now(),
  gedeactiveerd_op timestamptz
);

-- Is de ingelogde gebruiker een actief teamlid? SECURITY DEFINER zodat de policy op
-- team_members zelf geen rol speelt (geen recursie); search_path leeg tegen kaping.
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
  );
$$;

-- Is een andere gebruiker een actief teamlid? (bij het toewijzen van taken). Alleen
-- bruikbaar voor wie zelf teamlid is, zodat het niets prijsgeeft aan buitenstaanders.
create or replace function public.is_actief_teamlid(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teamlid() and exists (
    select 1 from public.team_members
    where user_id = p_user and actief
  );
$$;

revoke all on function public.is_teamlid() from public, anon;
revoke all on function public.is_actief_teamlid(uuid) from public, anon;
grant execute on function public.is_teamlid() to authenticated, service_role;
grant execute on function public.is_actief_teamlid(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 2. Lidmaatschap zaaien — ALLEEN bij de eerste keer (zolang team_members leeg is).
--    Elke bestaande, niet-anonieme gebruiker (bevestigd of al eens ingelogd) wordt actief lid; de oudste
--    wordt eigenaar. Daarna komen er alleen nog leden bij via scripts/teamlid-toevoegen.mjs.
--    Controleer na het uitvoeren de lijst onderaan: staat er iemand tussen die er niet
--    hoort, deactiveer die dan met scripts/teamlid-verwijderen.mjs.
-- ---------------------------------------------------------------------------------
do $$
declare
  palet text[] := array['#c8a97e', '#8f6b4a', '#6e7b5b', '#b5654a', '#5b6b7b', '#9a7fa0'];
begin
  if exists (select 1 from public.team_members) then
    return;
  end if;

  with basis as (
    select
      u.id,
      coalesce(u.email, '') as email,
      left(coalesce(
        nullif(btrim(u.raw_user_meta_data->>'naam'), ''),
        nullif(btrim(u.raw_user_meta_data->>'name'), ''),
        nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(initcap(split_part(split_part(coalesce(u.email, ''), '@', 1), '.', 1)), ''),
        'Teamlid'
      ), 80) as naam,
      (row_number() over (order by u.created_at, u.id))::int as nr
    from auth.users u
    where coalesce(u.email_confirmed_at, u.last_sign_in_at) is not null
      and coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false) = false
      and (u.banned_until is null or u.banned_until < now())
  ),
  met_initialen as (
    select b.*,
      upper(
        left(split_part(b.naam, ' ', 1), 1) ||
        coalesce(left(nullif(split_part(b.naam, ' ', 2), ''), 1), '')
      ) as initialen
    from basis b
  ),
  profielen as (
    insert into public.profiles (id, naam, initialen, kleur, email)
    select id, naam, coalesce(nullif(initialen, ''), 'S'), palet[1 + ((nr - 1) % array_length(palet, 1))], email
    from met_initialen
    on conflict (id) do nothing
    returning id
  )
  insert into public.team_members (user_id, actief, rol)
  select id, true, case when nr = 1 then 'eigenaar' else 'lid' end
  from met_initialen
  on conflict (user_id) do nothing;
end
$$;

-- Hulpfunctie: de (oudste actieve) eigenaar, voor het toewijzen van bestaande data.
create or replace function public.team_eigenaar()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id from public.team_members
  where rol = 'eigenaar' and actief
  order by toegevoegd_op, user_id
  limit 1;
$$;
revoke all on function public.team_eigenaar() from public, anon, authenticated;
grant execute on function public.team_eigenaar() to service_role;

-- ---------------------------------------------------------------------------------
-- 3. Projecten
-- ---------------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  naam text not null check (length(btrim(naam)) between 1 and 120),
  client_id uuid references public.clients (id) on delete set null,
  status text not null default 'actief' check (status in ('actief', 'gearchiveerd')),
  notitie text not null default '' check (length(notitie) <= 2000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists projects_klant_naam_key
  on public.projects (coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(naam)));
create index if not exists projects_client_idx on public.projects (client_id);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------
-- 4. Taken op naam
-- ---------------------------------------------------------------------------------
alter table public.tasks
  add column if not exists project_id uuid references public.projects (id) on delete set null,
  add column if not exists completed_by uuid references auth.users (id) on delete set null;

create index if not exists tasks_project_idx on public.tasks (project_id) where project_id is not null;

create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  toegewezen_door uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists task_assignees_user_idx on public.task_assignees (user_id, task_id);

create table if not exists public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  titel text not null check (length(btrim(titel)) between 1 and 200),
  klaar_op timestamptz,
  klaar_door uuid references auth.users (id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists task_subtasks_task_idx on public.task_subtasks (task_id, sort_order, created_at);

-- Bestaande taken: toewijzen aan de maker (als die teamlid is), anders aan de eigenaar.
insert into public.task_assignees (task_id, user_id, toegewezen_door)
select t.id,
       case when exists (select 1 from public.team_members m where m.user_id = t.created_by)
            then t.created_by else public.team_eigenaar() end,
       null
from public.tasks t
where not exists (select 1 from public.task_assignees a where a.task_id = t.id)
  and (t.created_by is not null and exists (select 1 from public.team_members m where m.user_id = t.created_by)
       or public.team_eigenaar() is not null)
on conflict do nothing;

update public.tasks t
set completed_by = case when exists (select 1 from public.team_members m where m.user_id = t.created_by)
                        then t.created_by else public.team_eigenaar() end
where t.completed_at is not null and t.completed_by is null;

-- ---------------------------------------------------------------------------------
-- 5. Afspraken: deelnemers
-- ---------------------------------------------------------------------------------
create table if not exists public.event_attendees (
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_attendees_user_idx on public.event_attendees (user_id);

insert into public.event_attendees (event_id, user_id)
select e.id,
       case when exists (select 1 from public.team_members m where m.user_id = e.created_by)
            then e.created_by else public.team_eigenaar() end
from public.calendar_events e
where not exists (select 1 from public.event_attendees a where a.event_id = e.id)
  and (e.created_by is not null and exists (select 1 from public.team_members m where m.user_id = e.created_by)
       or public.team_eigenaar() is not null)
on conflict do nothing;

-- "Aangemaakt door" kan na het aanmaken niet meer veranderen. Eén uitzondering: wordt de
-- maker zelf verwijderd (auth.users, "on delete set null"), dan mag de waarde leeg worden;
-- anders blokkeert deze trigger het verwijderen van een (oud-)teamlid.
-- SECURITY DEFINER: de ingelogde rol mag auth.users zelf niet lezen.
create or replace function public.behoud_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    if new.created_by is null and old.created_by is not null
       and not exists (select 1 from auth.users u where u.id = old.created_by) then
      return new;
    end if;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
revoke all on function public.behoud_created_by() from public, anon, authenticated;

drop trigger if exists tasks_behoud_created_by on public.tasks;
create trigger tasks_behoud_created_by
  before update on public.tasks
  for each row execute function public.behoud_created_by();

drop trigger if exists calendar_events_behoud_created_by on public.calendar_events;
create trigger calendar_events_behoud_created_by
  before update on public.calendar_events
  for each row execute function public.behoud_created_by();

-- ---------------------------------------------------------------------------------
-- 6. "Aangemaakt door" op klanten, social-posts en bonnetjes
-- ---------------------------------------------------------------------------------
alter table public.clients
  add column if not exists created_by uuid references auth.users (id) on delete set null default auth.uid();
alter table public.social_projects
  add column if not exists created_by uuid references auth.users (id) on delete set null default auth.uid();

do $$
begin
  if to_regclass('public.expenses') is not null then
    execute $sql$
      alter table public.expenses
        add column if not exists soort text check (soort in ('bonnetje', 'inkoopfactuur', 'overig'))
    $sql$;
    -- Bestaande uploads een soort geven (PDF = inkoopfactuur, foto = bonnetje), zodat het
    -- filter "Bonnetjes / Inkoopfacturen" ook de oude uploads vindt. Alleen lege waarden.
    if to_regclass('public.expense_files') is not null then
      execute $sql$
        update public.expenses e
        set soort = case
          when exists (select 1 from public.expense_files f where f.expense_id = e.id and f.mime_type = 'application/pdf')
            then 'inkoopfactuur'
          else 'bonnetje'
        end
        where e.soort is null
          and exists (select 1 from public.expense_files f where f.expense_id = e.id)
      $sql$;
    end if;
  end if;
end
$$;

-- invoices.created_by en quotes.created_by verwezen naar auth.users zonder "on delete": dan
-- kan een (oud-)teamlid met facturen nooit verwijderd worden. Voortaan: maker wordt leeg.
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tabel
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.conrelid in ('public.invoices'::regclass, 'public.quotes'::regclass)
      and a.attname = 'created_by'
      and c.confdeltype <> 'n'
  loop
    execute format('alter table %s drop constraint %I', r.tabel, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (created_by) references auth.users (id) on delete set null',
      r.tabel, r.conname
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------
-- 7. Eigen mailbox per gebruiker. RLS aan en GEEN policies: alleen de server leest deze
--    tabel (service-role, altijd met user_id = eigen sessie). Het wachtwoord staat er
--    versleuteld (AES-256-GCM, sleutel alleen in de server-env) en komt nooit in de browser.
-- ---------------------------------------------------------------------------------
create table if not exists public.user_mailboxes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (length(email) between 3 and 320),
  imap_host text not null default 'mail.privateemail.com' check (length(imap_host) <= 253),
  imap_port int not null default 993 check (imap_port in (993, 143)),
  smtp_host text not null default 'mail.privateemail.com' check (length(smtp_host) <= 253),
  smtp_port int not null default 465 check (smtp_port in (465, 587)),
  from_name text not null default '' check (length(from_name) <= 120),
  handtekening text not null default '' check (length(handtekening) <= 5000),
  wachtwoord_enc text not null check (wachtwoord_enc like 'v1:%'),
  sleutel_versie smallint not null default 1,
  geverifieerd_op timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists user_mailboxes_set_updated_at on public.user_mailboxes;
create trigger user_mailboxes_set_updated_at
  before update on public.user_mailboxes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------
-- 8. Wie mag een taak/afspraak wijzigen? Teamlid én (maker of toegewezen/deelnemer).
--    SECURITY DEFINER: zo is er geen RLS-recursie tussen tasks en task_assignees.
-- ---------------------------------------------------------------------------------
create or replace function public.taak_betrokken(p_task uuid)
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
           or exists (select 1 from public.task_assignees a
                      where a.task_id = t.id and a.user_id = (select auth.uid())))
  );
$$;

create or replace function public.afspraak_betrokken(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teamlid() and exists (
    select 1 from public.calendar_events e
    where e.id = p_event
      and (e.created_by = (select auth.uid())
           or exists (select 1 from public.event_attendees a
                      where a.event_id = e.id and a.user_id = (select auth.uid())))
  );
$$;

revoke all on function public.taak_betrokken(uuid) from public, anon;
revoke all on function public.afspraak_betrokken(uuid) from public, anon;
grant execute on function public.taak_betrokken(uuid) to authenticated, service_role;
grant execute on function public.afspraak_betrokken(uuid) to authenticated, service_role;

-- Een taak met toegewezenen en subtaken in één transactie aanmaken. SECURITY INVOKER:
-- alle RLS-policies gelden gewoon (maker = de ingelogde gebruiker).
--   p = { titel, notities?, datum?, tijd?, duur?, prioriteit?, klantId?, projectId?,
--         voorWie: [uuid, ...], subtaken: [text, ...] }
create or replace function public.taak_aanmaken(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_klant uuid := nullif(p->>'klantId', '')::uuid;
  v_project uuid := nullif(p->>'projectId', '')::uuid;
  v_project_klant uuid;
  v_aantal int;
begin
  if not public.is_teamlid() then
    raise exception 'Geen toegang.' using errcode = '42501';
  end if;

  if v_project is not null then
    select client_id into v_project_klant from public.projects where id = v_project;
    if not found then
      raise exception 'Dat project bestaat niet (meer).' using errcode = '23503';
    end if;
    if v_klant is null then
      v_klant := v_project_klant;
    elsif v_project_klant is not null and v_project_klant <> v_klant then
      raise exception 'Het project hoort bij een andere klant.' using errcode = '23514';
    end if;
  end if;

  insert into public.tasks (title, notes, due_date, due_time, duration_minutes, priority, client_id, project_id)
  values (
    btrim(p->>'titel'),
    coalesce(p->>'notities', ''),
    nullif(p->>'datum', '')::date,
    nullif(p->>'tijd', '')::time,
    nullif(p->>'duur', '')::int,
    coalesce(nullif(p->>'prioriteit', '')::smallint, 2),
    v_klant,
    v_project
  )
  returning id into v_id;

  insert into public.task_assignees (task_id, user_id)
  select distinct v_id, x::uuid
  from jsonb_array_elements_text(coalesce(p->'voorWie', '[]'::jsonb)) as x;

  select count(*) into v_aantal from public.task_assignees where task_id = v_id;
  if v_aantal = 0 then
    raise exception 'Kies minstens één persoon.' using errcode = '23514';
  end if;

  insert into public.task_subtasks (task_id, titel, sort_order)
  select v_id, btrim(s.titel), s.nr::int
  from jsonb_array_elements_text(coalesce(p->'subtaken', '[]'::jsonb)) with ordinality as s(titel, nr)
  where btrim(s.titel) <> '';

  return v_id;
end;
$$;

revoke all on function public.taak_aanmaken(jsonb) from public, anon;
grant execute on function public.taak_aanmaken(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 9. RLS: alle bestaande policies op de gedeelde tabellen weg, opnieuw met is_teamlid().
-- ---------------------------------------------------------------------------------
do $$
declare
  t text;
  p record;
  gedeeld text[] := array[
    'clients', 'social_projects', 'social_slides', 'social_versions', 'social_brand',
    'expenses', 'expense_files', 'projects'
  ];
  alleen_lezen text[] := array['invoices', 'invoice_counters', 'quotes'];
  overig text[] := array[
    'tasks', 'task_assignees', 'task_subtasks', 'calendar_events', 'event_attendees',
    'profiles', 'team_members', 'user_mailboxes'
  ];
begin
  foreach t in array gedeeld || alleen_lezen || overig loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;

  -- Gedeelde bedrijfsdata: lezen en schrijven voor elk actief teamlid.
  foreach t in array gedeeld loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select public.is_teamlid())) with check ((select public.is_teamlid()))',
      'teamleden lezen en schrijven ' || t, t
    );
  end loop;

  -- Facturen, tellers en prijsopgaven: alleen lezen (schrijven gaat via de server).
  foreach t in array alleen_lezen loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_teamlid()))',
      'teamleden lezen ' || t, t
    );
  end loop;
end
$$;

-- Taken: iedereen in het team mag ze zien (agenda-filter "Heel team"); wijzigen alleen
-- door de maker of een toegewezene. Het dashboard toont alleen je eigen taken (app-filter).
create policy "teamleden lezen taken" on public.tasks
  for select to authenticated using ((select public.is_teamlid()));
create policy "teamleden maken taken" on public.tasks
  for insert to authenticated
  with check ((select public.is_teamlid()) and created_by = (select auth.uid()));
create policy "betrokkenen wijzigen taken" on public.tasks
  for update to authenticated
  using (public.taak_betrokken(id)) with check ((select public.is_teamlid()));
create policy "betrokkenen verwijderen taken" on public.tasks
  for delete to authenticated using (public.taak_betrokken(id));

create policy "teamleden lezen toewijzingen" on public.task_assignees
  for select to authenticated using ((select public.is_teamlid()));
create policy "betrokkenen wijzen toe" on public.task_assignees
  for insert to authenticated
  with check (public.taak_betrokken(task_id) and public.is_actief_teamlid(user_id));
create policy "betrokkenen trekken toewijzing in" on public.task_assignees
  for delete to authenticated using (public.taak_betrokken(task_id));

create policy "teamleden lezen subtaken" on public.task_subtasks
  for select to authenticated using ((select public.is_teamlid()));
create policy "betrokkenen maken subtaken" on public.task_subtasks
  for insert to authenticated with check (public.taak_betrokken(task_id));
create policy "betrokkenen wijzigen subtaken" on public.task_subtasks
  for update to authenticated
  using (public.taak_betrokken(task_id)) with check (public.taak_betrokken(task_id));
create policy "betrokkenen verwijderen subtaken" on public.task_subtasks
  for delete to authenticated using (public.taak_betrokken(task_id));

create policy "teamleden lezen afspraken" on public.calendar_events
  for select to authenticated using ((select public.is_teamlid()));
create policy "teamleden maken afspraken" on public.calendar_events
  for insert to authenticated
  with check ((select public.is_teamlid()) and created_by = (select auth.uid()));
create policy "betrokkenen wijzigen afspraken" on public.calendar_events
  for update to authenticated
  using (public.afspraak_betrokken(id)) with check ((select public.is_teamlid()));
create policy "betrokkenen verwijderen afspraken" on public.calendar_events
  for delete to authenticated using (public.afspraak_betrokken(id));

create policy "teamleden lezen deelnemers" on public.event_attendees
  for select to authenticated using ((select public.is_teamlid()));
create policy "betrokkenen voegen deelnemers toe" on public.event_attendees
  for insert to authenticated
  with check (public.afspraak_betrokken(event_id) and public.is_actief_teamlid(user_id));
create policy "betrokkenen halen deelnemers weg" on public.event_attendees
  for delete to authenticated using (public.afspraak_betrokken(event_id));

-- Profielen: het team ziet elkaars naam/kleur; je past alleen je eigen profiel aan, en
-- alleen naam, initialen en kleur (niet het e-mailadres of je id).
create policy "teamleden lezen profielen" on public.profiles
  for select to authenticated using ((select public.is_teamlid()));
create policy "eigen profiel aanpassen" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select public.is_teamlid()))
  with check (id = (select auth.uid()) and (select public.is_teamlid()));
revoke insert, update, delete on public.profiles from authenticated;
grant update (naam, initialen, kleur) on public.profiles to authenticated;

-- Lidmaatschap: je ziet je eigen regel (ook als je gedeactiveerd bent, zodat de app
-- "geen toegang" kan tonen) en als teamlid die van de anderen. Nooit schrijven.
create policy "eigen lidmaatschap of teamlid" on public.team_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_teamlid()));
revoke insert, update, delete on public.team_members from authenticated;

-- user_mailboxes: geen enkele policy en geen rechten voor anon/authenticated.
revoke all on public.user_mailboxes from anon, authenticated;

-- ---------------------------------------------------------------------------------
-- 10. Storage: alleen teamleden. De buckets uitgaven, uitgaven-export en mail-tmp
--     houden bewust géén policies (alleen de service-role, ná de controle in de app).
-- ---------------------------------------------------------------------------------
drop policy if exists "authenticated read invoice pdfs" on storage.objects;
drop policy if exists "authenticated read social assets" on storage.objects;
drop policy if exists "authenticated insert social assets" on storage.objects;
drop policy if exists "authenticated update social assets" on storage.objects;
drop policy if exists "authenticated delete social assets" on storage.objects;

drop policy if exists "teamleden lezen factuur-pdfs" on storage.objects;
create policy "teamleden lezen factuur-pdfs" on storage.objects
  for select to authenticated
  using (bucket_id = 'invoices' and (select public.is_teamlid()));

drop policy if exists "teamleden lezen social-bestanden" on storage.objects;
create policy "teamleden lezen social-bestanden" on storage.objects
  for select to authenticated
  using (bucket_id = 'social-assets' and (select public.is_teamlid()));

drop policy if exists "teamleden uploaden social-bestanden" on storage.objects;
create policy "teamleden uploaden social-bestanden" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'social-assets' and (select public.is_teamlid()));

drop policy if exists "teamleden wijzigen social-bestanden" on storage.objects;
create policy "teamleden wijzigen social-bestanden" on storage.objects
  for update to authenticated
  using (bucket_id = 'social-assets' and (select public.is_teamlid()))
  with check (bucket_id = 'social-assets' and (select public.is_teamlid()));

drop policy if exists "teamleden verwijderen social-bestanden" on storage.objects;
create policy "teamleden verwijderen social-bestanden" on storage.objects
  for delete to authenticated
  using (bucket_id = 'social-assets' and (select public.is_teamlid()));

-- Controle: geen enkele bucket is openbaar.
update storage.buckets set public = false
where id in ('invoices', 'social-assets', 'mail-tmp', 'uitgaven', 'uitgaven-export') and public;

-- ---------------------------------------------------------------------------------
-- 11. Functierechten. create_invoice/update_invoice zijn SECURITY DEFINER zonder eigen
--     controle; ze waren (via PUBLIC) zelfs met alleen de anon key aan te roepen. De app
--     roept ze uitsluitend aan met de service-role, dus alleen die mag ze nog uitvoeren.
-- ---------------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_invoice', 'update_invoice', 'social_restore_latest')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------
-- 12. Extra laag: de anonieme rol (alleen de anon key, zonder sessie) mag niets in public.
-- ---------------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
