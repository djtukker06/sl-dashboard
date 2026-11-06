-- ============================================================================
-- Studio Levant-backoffice — Google Agenda koppelen + website bij klanten (migratie 0035)
-- ============================================================================
--
-- Google Agenda: elk teamlid koppelt zelf één of meer Google-accounts in /agenda. De
-- afspraken uit die agenda's staan (met hun kleur) in de agenda van het dashboard, met per
-- agenda een schakelaar om hem te tonen, en optioneel ook in de agenda-link (Apple Agenda).
-- Ze zijn alleen van dat teamlid, niet van het team.
--
--   google_agenda_accounts  per gekoppeld Google-account: het e-mailadres en het refresh
--                           token, versleuteld (AES-256-GCM, lib/google-agenda/koppeling.ts).
--                           fout = 'opnieuw_koppelen' als de toegang verlopen of ingetrokken is.
--   google_agendas          per agenda in zo'n account: naam, kleur, rechten (owner/writer/
--                           reader/freeBusyReader), tonen in de agenda, in de agenda-link.
--
-- Beide tabellen: RLS aan, GEEN policies en geen rechten voor anon/authenticated. Alleen de
-- server (service-role) leest en schrijft, na de teamlidcontrole en altijd gefilterd op het
-- user-id van wie het vraagt (zoals drive_koppeling, 0024). De afspraken zelf staan niet in
-- de database: die komen elke keer rechtstreeks uit Google.
--
-- Klanten: een kolom website (vrije tekst zoals getypt, bv. "studio-levant.nl"; de app
-- controleert dat het een domeinnaam of http(s)-link is).
--
-- Veilig om opnieuw uit te voeren.

-- ---------- klanten: website ----------
alter table public.clients add column if not exists website text;
alter table public.clients drop constraint if exists clients_website_lengte;
alter table public.clients add constraint clients_website_lengte check (website is null or char_length(website) <= 300);

-- ---------- Google Agenda ----------
create table if not exists public.google_agenda_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  google_email text not null check (char_length(google_email) between 3 and 320),
  refresh_token_enc text not null,
  scope text not null default '',
  gekoppeld_op timestamptz not null default now(),
  lijst_bijgewerkt_op timestamptz,
  fout text check (fout is null or fout in ('opnieuw_koppelen')),
  unique (user_id, google_email)
);

create table if not exists public.google_agendas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.google_agenda_accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  google_id text not null check (char_length(google_id) between 1 and 1024),
  naam text not null default '' check (char_length(naam) <= 200),
  kleur text not null default '#039be5' check (kleur ~ '^#[0-9a-f]{6}$'),
  toegang text not null default 'reader' check (toegang in ('owner', 'writer', 'reader', 'freeBusyReader')),
  primair boolean not null default false,
  zichtbaar boolean not null default true,
  in_feed boolean not null default false,
  volgorde integer not null default 0,
  unique (account_id, google_id)
);

create index if not exists google_agenda_accounts_user_idx on public.google_agenda_accounts (user_id);
create index if not exists google_agendas_user_idx on public.google_agendas (user_id);

alter table public.google_agenda_accounts enable row level security;
alter table public.google_agendas enable row level security;

revoke all on public.google_agenda_accounts from anon, authenticated;
revoke all on public.google_agendas from anon, authenticated;

notify pgrst, 'reload schema';

-- Controle: elke regel moet "ok" zijn.
select 'clients.website' as onderdeel,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'website') then 'ok' else 'ontbreekt' end as status
union all
select 'google_agenda_accounts',
       case when to_regclass('public.google_agenda_accounts') is not null then 'ok' else 'ontbreekt' end
union all
select 'google_agendas',
       case when to_regclass('public.google_agendas') is not null then 'ok' else 'ontbreekt' end
union all
select 'google_agenda_accounts: RLS aan',
       case when (select relrowsecurity from pg_class where oid = 'public.google_agenda_accounts'::regclass) then 'ok' else 'uit' end
union all
select 'google_agendas: RLS aan',
       case when (select relrowsecurity from pg_class where oid = 'public.google_agendas'::regclass) then 'ok' else 'uit' end;
