-- 0023: projectstatussen voor het projectenbord. Idempotent: twee keer uitvoeren geeft
-- geen fout. Alleen projects verandert; RLS (is_teamlid) blijft zoals in 0021/0022 en de
-- facturen worden niet aangeraakt. Vereist 0022.
--
--   - status voorbereiding / bezig / wachten (op goedkeuring) / afgerond; bestaande
--     'gepland' wordt 'voorbereiding' (en oude 'actief'/'gearchiveerd', mocht er nog iets
--     staan, 'bezig'/'afgerond'). Nieuwe projecten standaard 'voorbereiding'.
--   - status_sinds: wanneer de status voor het laatst veranderde (gevuld met updated_at),
--     bijgehouden door een trigger. Voor "12 dagen in deze status" en "afgerond, laatste
--     30 dagen" op het bord.
--   - index voor het bord (status + status_sinds) en voor deadlines.
--
-- De app werkt vóór en na deze migratie: vóór 0023 schrijft hij 'gepland' voor
-- Voorbereiding en is "Wachten op goedkeuring" nog niet te kiezen.

-- Sinds wanneer in deze status. Bestaande projecten: hun laatste wijziging (vóór het
-- omzetten hieronder, dat updated_at bijwerkt).
alter table public.projects add column if not exists status_sinds timestamptz;
update public.projects set status_sinds = coalesce(updated_at, created_at, now()) where status_sinds is null;
alter table public.projects alter column status_sinds set default now();
alter table public.projects alter column status_sinds set not null;

-- Status: eerst de oude check weg, dan omzetten, dan de nieuwe check.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.projects'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) not ilike '%voorbereiding%'
  loop
    execute format('alter table public.projects drop constraint %I', c.conname);
  end loop;
end
$$;

update public.projects set status = 'voorbereiding' where status = 'gepland';
update public.projects set status = 'bezig' where status = 'actief';
update public.projects set status = 'afgerond' where status = 'gearchiveerd';

alter table public.projects alter column status set default 'voorbereiding';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass and conname = 'projects_status_check'
  ) then
    alter table public.projects add constraint projects_status_check
      check (status in ('voorbereiding', 'bezig', 'wachten', 'afgerond'));
  end if;
end
$$;

-- Trigger: bij elke statuswijziging status_sinds op nu (de app hoeft daar niets voor te
-- doen; een meegestuurde waarde wordt genegeerd zodat de tijdlijn klopt).
create or replace function public.projects_status_sinds()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status_sinds := now();
  elsif new.status is distinct from old.status then
    new.status_sinds := now();
  else
    new.status_sinds := old.status_sinds;
  end if;
  return new;
end
$$;
revoke all on function public.projects_status_sinds() from public, anon, authenticated;

drop trigger if exists projects_status_sinds on public.projects;
create trigger projects_status_sinds
  before insert or update on public.projects
  for each row execute function public.projects_status_sinds();

-- Het bord haalt alles in één keer op (kleine tabel); deze indexen houden de tellers op
-- het dashboard en "afgerond, laatste 30 dagen" vlot als de lijst groeit.
create index if not exists projects_status_sinds_idx on public.projects (status, status_sinds desc);
create index if not exists projects_deadline_idx on public.projects (deadline) where deadline is not null;
