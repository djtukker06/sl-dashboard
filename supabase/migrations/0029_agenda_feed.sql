-- ============================================================================
-- Studio Levant-backoffice — agenda koppelen aan Apple/Google Agenda (migratie 0029)
-- ============================================================================
--
-- Elk teamlid krijgt een eigen, geheime agenda-link (ICS-abonnement) die hij één keer
-- toevoegt in Apple Agenda of Google Agenda. Daarin staan zijn taken (op zijn naam) en de
-- afspraken waar hij deelnemer van is; de agenda-app haalt de link zelf periodiek op.
-- Koppelen is verplicht: de app stuurt naar /agenda-koppelen tot de link minstens één keer
-- door een agenda-app is opgehaald (of tijdelijk is uitgesteld).
--
--   agenda_feeds  één rij per gebruiker. Alleen de SHA-256 van het token staat hier (de link
--                 zelf ziet de gebruiker één keer; een nieuwe link maakt de oude ongeldig).
--                 Lezen: alleen je eigen rij. Schrijven: alleen de server (service-role).
-- Veilig om opnieuw uit te voeren.

create table if not exists public.agenda_feeds (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  aangemaakt_op timestamptz not null default now(),
  eerst_opgehaald_op timestamptz,
  laatst_opgehaald_op timestamptz,
  client text check (client in ('apple', 'google', 'outlook', 'overig')),
  uitgesteld_tot timestamptz
);

alter table public.agenda_feeds enable row level security;

drop policy if exists "eigen agenda-link lezen" on public.agenda_feeds;
create policy "eigen agenda-link lezen" on public.agenda_feeds
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_teamlid()));

revoke all on public.agenda_feeds from anon;
revoke insert, update, delete on public.agenda_feeds from authenticated;
grant select on public.agenda_feeds to authenticated;

notify pgrst, 'reload schema';

-- Controle: elke regel moet "ok" zijn.
select 'agenda_feeds' as onderdeel,
       case when to_regclass('public.agenda_feeds') is not null then 'ok' else 'ontbreekt' end as status
union all
select 'agenda_feeds: RLS aan',
       case when (select relrowsecurity from pg_class where oid = 'public.agenda_feeds'::regclass) then 'ok' else 'uit' end;
