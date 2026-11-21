-- ============================================================================
-- Studio Levant-backoffice — Apple Agenda (iCloud) koppelen (migratie 0040)
-- ============================================================================
--
-- Elk teamlid koppelt zelf zijn iCloud-agenda's met zijn Apple ID en een app-specifiek
-- wachtwoord (account.apple.com). Afspraken uit die agenda's staan (in hun kleur) in de
-- agenda van het systeem; in een schrijfbare iCloud-agenda kun je ze ook maken, wijzigen en
-- verwijderen, en dat staat dan meteen op je iPhone en Mac. Ze zijn alleen van dat teamlid.
--
--   apple_agenda_accounts  per gekoppeld Apple ID: het app-wachtwoord versleuteld
--                          (AES-256-GCM, lib/apple-agenda/koppeling.ts) en de iCloud-adressen.
--                          fout = 'opnieuw_koppelen' als het wachtwoord is ingetrokken.
--   apple_agendas          per agenda in dat account: naam, kleur, schrijfbaar, tonen.
--
-- Beide tabellen: RLS aan, GEEN policies en geen rechten voor anon/authenticated. Alleen de
-- server (service-role) leest en schrijft, na de teamlidcontrole en altijd gefilterd op het
-- user-id van wie het vraagt. De afspraken zelf staan niet in de database: die komen elke
-- keer rechtstreeks uit iCloud.
--
-- Veilig om opnieuw uit te voeren.

create table if not exists public.apple_agenda_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  apple_id text not null check (char_length(apple_id) between 3 and 320),
  wachtwoord_enc text not null,
  principal_url text not null check (char_length(principal_url) <= 1000),
  home_url text not null check (char_length(home_url) <= 1000),
  gekoppeld_op timestamptz not null default now(),
  lijst_bijgewerkt_op timestamptz,
  fout text check (fout is null or fout in ('opnieuw_koppelen')),
  unique (user_id, apple_id)
);

create table if not exists public.apple_agendas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.apple_agenda_accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null check (char_length(url) between 1 and 1000),
  naam text not null default '' check (char_length(naam) <= 200),
  kleur text not null default '#1badf8' check (kleur ~ '^#[0-9a-f]{6}$'),
  schrijfbaar boolean not null default true,
  zichtbaar boolean not null default true,
  volgorde integer not null default 0,
  unique (account_id, url)
);

create index if not exists apple_agenda_accounts_user_idx on public.apple_agenda_accounts (user_id);
create index if not exists apple_agendas_user_idx on public.apple_agendas (user_id);

alter table public.apple_agenda_accounts enable row level security;
alter table public.apple_agendas enable row level security;

revoke all on public.apple_agenda_accounts from anon, authenticated;
revoke all on public.apple_agendas from anon, authenticated;
grant all on public.apple_agenda_accounts to service_role;
grant all on public.apple_agendas to service_role;

notify pgrst, 'reload schema';

-- Controle: elke regel moet "ok" zijn.
select 'apple_agenda_accounts' as onderdeel,
       case when to_regclass('public.apple_agenda_accounts') is not null then 'ok' else 'ontbreekt' end as status
union all
select 'apple_agendas',
       case when to_regclass('public.apple_agendas') is not null then 'ok' else 'ontbreekt' end
union all
select 'apple_agenda_accounts: RLS aan',
       case when (select relrowsecurity from pg_class where oid = 'public.apple_agenda_accounts'::regclass) then 'ok' else 'uit' end
union all
select 'apple_agendas: RLS aan',
       case when (select relrowsecurity from pg_class where oid = 'public.apple_agendas'::regclass) then 'ok' else 'uit' end
union all
select 'app (authenticated) kan er niet bij',
       case when not has_table_privilege('authenticated', 'public.apple_agenda_accounts', 'select') and not has_table_privilege('authenticated', 'public.apple_agendas', 'select') then 'ok' else 'open' end;
