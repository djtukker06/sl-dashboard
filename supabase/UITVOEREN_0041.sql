-- ============================================================================
-- Studio Levant-backoffice — Taken in Apple Agenda (migratie 0041)
-- ============================================================================
--
-- Bij een taak kun je een van je Apple-agenda's (0040) kiezen. De taak blijft een taak in het
-- systeem; daarnaast staat er een afspraak voor in die iCloud-agenda (op de datum en tijd van
-- de taak, of de hele dag), met "✓" voor de titel als hij is afgerond. Alleen in die richting:
-- wat je in Apple aan die afspraak verandert, komt niet terug in de taak.
--
--   apple_taak_koppelingen  per taak: in welke Apple-agenda (en van wie die agenda is).
--
-- RLS aan, GEEN policies en geen rechten voor anon/authenticated: alleen de server
-- (service-role) leest en schrijft, na de teamlidcontrole. Zo kan niemand via de API een taak
-- in de agenda van een ander laten schrijven. Weg met de taak, de agenda of het account.
--
-- Veilig om opnieuw uit te voeren. Vereist 0040.

create table if not exists public.apple_taak_koppelingen (
  task_id uuid primary key references public.tasks (id) on delete cascade,
  agenda_id uuid not null references public.apple_agendas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  aangemaakt timestamptz not null default now()
);

create index if not exists apple_taak_koppelingen_agenda_idx on public.apple_taak_koppelingen (agenda_id);

alter table public.apple_taak_koppelingen enable row level security;
revoke all on public.apple_taak_koppelingen from anon, authenticated;
grant all on public.apple_taak_koppelingen to service_role;

notify pgrst, 'reload schema';

-- Controle: elke regel moet "ok" zijn.
select 'apple_taak_koppelingen' as onderdeel,
       case when to_regclass('public.apple_taak_koppelingen') is not null then 'ok' else 'ontbreekt' end as status
union all
select 'apple_taak_koppelingen: RLS aan',
       case when (select relrowsecurity from pg_class where oid = 'public.apple_taak_koppelingen'::regclass) then 'ok' else 'uit' end
union all
select 'app (authenticated) kan er niet bij',
       case when not has_table_privilege('authenticated', 'public.apple_taak_koppelingen', 'select') then 'ok' else 'open' end;
