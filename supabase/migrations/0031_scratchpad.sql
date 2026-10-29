-- ============================================================================
-- Studio Levant-backoffice — Scratchpad: notities om te brainstormen (migratie 0031)
-- ============================================================================
--
-- Een Notion-achtig kladblok voor het team (module Scratchpad, /scratchpad). Elke notitie
-- heeft een titel, een optionele emoji en rijke tekst (Tiptap-JSON), en kan aan een klant
-- (ook een lead) en/of een project hangen.
--
--   notities  inhoud      Tiptap-JSON (de app schoont hem op vóór het opslaan; getoond
--                         wordt hij alleen via de editor, nooit als losse HTML)
--             inhoud_tekst platte tekst van de inhoud, om te zoeken
--             fragment    de eerste 240 tekens daarvan (gegenereerd), voor de lijsten
--             prive       false = gedeeld met het team (standaard); true = alleen de maker
--             vastgepind  bovenaan in de lijst en op het dashboard
--             verwijderd_op  zacht verwijderd (in de app ongedaan te maken); de lijsten
--                         tonen alleen notities zonder deze datum
--
-- RLS: teamleden lezen en schrijven gedeelde notities; een privé-notitie bestaat alleen voor
-- de maker. Alleen de maker zet een notitie op privé (of terug) en alleen de maker verwijdert
-- definitief. created_by staat vast; updated_by en updated_at zet de database zelf.
-- Veilig om opnieuw uit te voeren.

create table if not exists public.notities (
  id uuid primary key default gen_random_uuid(),
  titel text not null default '' check (length(titel) <= 200),
  emoji text check (emoji is null or length(emoji) between 1 and 16),
  inhoud jsonb not null default '{"type": "doc", "content": [{"type": "paragraph"}]}'::jsonb
    check (jsonb_typeof(inhoud) = 'object' and octet_length(inhoud::text) <= 1048576),
  inhoud_tekst text not null default '' check (length(inhoud_tekst) <= 200000),
  fragment text generated always as (left(inhoud_tekst, 240)) stored,
  client_id uuid references public.clients (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  prive boolean not null default false,
  vastgepind boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verwijderd_op timestamptz
);

create index if not exists notities_lijst_idx on public.notities (vastgepind desc, updated_at desc) where verwijderd_op is null;
create index if not exists notities_klant_idx on public.notities (client_id) where client_id is not null;
create index if not exists notities_project_idx on public.notities (project_id) where project_id is not null;
create index if not exists notities_maker_idx on public.notities (created_by);

drop trigger if exists notities_set_updated_at on public.notities;
create trigger notities_set_updated_at
  before update on public.notities
  for each row execute function public.set_updated_at();

-- Wie bewerkte als laatste, en de vaste velden (ook bij het maken: geen updated_by of
-- created_at van een ander). Zonder ingelogde gebruiker (service-role, bv. het terugzetten
-- van een back-up) blijft alles zoals aangeleverd.
create or replace function public.notities_bewaken()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  wie uuid := (select auth.uid());
begin
  if wie is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.updated_by := wie;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := wie;
  if new.prive is distinct from old.prive and wie is distinct from old.created_by then
    raise exception 'Alleen de maker kan een notitie privé maken of delen.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists notities_bewaken on public.notities;
create trigger notities_bewaken
  before insert or update on public.notities
  for each row execute function public.notities_bewaken();

alter table public.notities enable row level security;

drop policy if exists "teamleden lezen notities" on public.notities;
create policy "teamleden lezen notities" on public.notities
  for select to authenticated
  using ((select public.is_teamlid()) and (not prive or created_by = (select auth.uid())));

drop policy if exists "teamleden maken notities" on public.notities;
create policy "teamleden maken notities" on public.notities
  for insert to authenticated
  with check ((select public.is_teamlid()) and created_by = (select auth.uid()));

drop policy if exists "teamleden wijzigen notities" on public.notities;
create policy "teamleden wijzigen notities" on public.notities
  for update to authenticated
  using ((select public.is_teamlid()) and (not prive or created_by = (select auth.uid())))
  with check ((select public.is_teamlid()) and (not prive or created_by = (select auth.uid())));

drop policy if exists "maker verwijdert notitie" on public.notities;
create policy "maker verwijdert notitie" on public.notities
  for delete to authenticated
  using ((select public.is_teamlid()) and created_by = (select auth.uid()));

revoke all on public.notities from anon;
grant select, insert, update, delete on public.notities to authenticated;

notify pgrst, 'reload schema';

-- Controle: elke regel moet "ok" zijn.
select 'notities' as onderdeel,
       case when to_regclass('public.notities') is not null then 'ok' else 'ontbreekt' end as status
union all
select 'notities: RLS aan',
       case when (select relrowsecurity from pg_class where oid = 'public.notities'::regclass) then 'ok' else 'uit' end
union all
select 'notities: policies (4)',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'notities') = 4 then 'ok' else 'ontbreekt' end
union all
select 'notities: alleen teamleden',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'notities'
                  and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%is_teamlid()%') = 0 then 'ok' else 'open' end
union all
select 'notities: triggers',
       case when (select count(*) from pg_trigger where tgrelid = 'public.notities'::regclass
                  and tgname in ('notities_set_updated_at', 'notities_bewaken')) = 2 then 'ok' else 'ontbreekt' end;
