-- Agenda & taken.
--   tasks            taken (met of zonder datum/tijd); met tijd staan ze als blok in de agenda
--   calendar_events  afspraken (altijd een begin en eind; hele dag mogelijk)
-- Idempotent: veilig om (nogmaals) uit te voeren in de Supabase SQL Editor.
-- Geen herhalende afspraken in v1 (bewust: kwaliteit boven kwantiteit).

create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 300),
  notes text not null default '' check (length(notes) <= 10000),
  due_date date,                    -- null = "Ooit"
  due_time time,                    -- optioneel; met tijd staat de taak als blok in de agenda
  duration_minutes int check (duration_minutes between 5 and 1440),
  priority smallint not null default 2 check (priority between 1 and 3),  -- 1 hoog, 2 normaal, 3 laag
  client_id uuid references public.clients (id) on delete set null,
  completed_at timestamptz,         -- null = open
  sort_order int not null default 0,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_tijd_vereist_datum check (due_time is null or due_date is not null)
);

create index if not exists tasks_open_due_idx
  on public.tasks (due_date) where completed_at is null;
create index if not exists tasks_completed_idx
  on public.tasks (completed_at desc) where completed_at is not null;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 300),
  notes text not null default '' check (length(notes) <= 10000),
  location text not null default '' check (length(location) <= 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  client_id uuid references public.clients (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_eind_na_begin check (ends_at > starts_at)
);

create index if not exists calendar_events_starts_idx on public.calendar_events (starts_at);
create index if not exists calendar_events_ends_idx on public.calendar_events (ends_at);

-- updated_at automatisch bijwerken.
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

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists calendar_events_set_updated_at on public.calendar_events;
create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- RLS: gedeeld voor het hele (kleine) team, net als clients (0003) en social (0014):
-- alleen "is dit een ingelogde gebruiker". De API-routes gebruiken de gebruikerscliënt.
alter table public.tasks enable row level security;
alter table public.calendar_events enable row level security;

drop policy if exists "authenticated read/write tasks" on public.tasks;
create policy "authenticated read/write tasks"
  on public.tasks for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "authenticated read/write calendar_events" on public.calendar_events;
create policy "authenticated read/write calendar_events"
  on public.calendar_events for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);
