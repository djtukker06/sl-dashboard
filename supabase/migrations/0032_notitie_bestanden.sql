-- ============================================================================
-- Studio Levant-backoffice — Scratchpad: foto's en bestanden in notities (migratie 0032)
-- ============================================================================
--
-- Een notitie kan foto's (getoond in de tekst) en losse bestanden (als kaartje met downloaden)
-- bevatten. De bestanden staan in de privé-bucket "notities", per notitie in een eigen map:
--   notities/<notitie-id>/<ts>-<hex>-<naam>.<ext>
-- De editor verwijst ernaar met /api/notities/<notitie-id>/bestanden/<bestand-id>; die route
-- kijkt in notitie_bestanden (RLS) of je de notitie mag zien en stuurt dan door naar een
-- signed URL van een paar minuten. Bij een privé-notitie zijn de bijlagen dus ook privé.
--
-- Geen storage-policies: alleen de service-role (na de teamcheck in de route) leest en
-- schrijft de bucket; uploads gaan via een signed upload-URL rechtstreeks naar Storage.
-- Veilig om opnieuw uit te voeren.

insert into storage.buckets (id, name, public, file_size_limit)
values ('notities', 'notities', false, 26214400) -- 25 MB
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create table if not exists public.notitie_bestanden (
  id uuid primary key default gen_random_uuid(),
  notitie_id uuid not null references public.notities (id) on delete cascade,
  storage_path text not null unique check (length(storage_path) <= 300),
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null check (length(mime_type) <= 120),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists notitie_bestanden_notitie_idx on public.notitie_bestanden (notitie_id);

alter table public.notitie_bestanden enable row level security;

-- Zichtbaar als de notitie zichtbaar is (de subquery valt zelf onder de RLS van notities:
-- gedeeld, of je eigen privé-notitie).
drop policy if exists "teamleden lezen notitie-bestanden" on public.notitie_bestanden;
create policy "teamleden lezen notitie-bestanden" on public.notitie_bestanden
  for select to authenticated
  using ((select public.is_teamlid()) and exists (select 1 from public.notities n where n.id = notitie_id));

drop policy if exists "teamleden voegen notitie-bestanden toe" on public.notitie_bestanden;
create policy "teamleden voegen notitie-bestanden toe" on public.notitie_bestanden
  for insert to authenticated
  with check (
    (select public.is_teamlid())
    and created_by = (select auth.uid())
    and exists (select 1 from public.notities n where n.id = notitie_id and n.verwijderd_op is null)
  );

drop policy if exists "teamleden verwijderen notitie-bestanden" on public.notitie_bestanden;
create policy "teamleden verwijderen notitie-bestanden" on public.notitie_bestanden
  for delete to authenticated
  using ((select public.is_teamlid()) and exists (select 1 from public.notities n where n.id = notitie_id));

revoke all on public.notitie_bestanden from anon;
grant select, insert, delete on public.notitie_bestanden to authenticated;

notify pgrst, 'reload schema';

-- Controle: elke regel moet "ok" zijn.
select 'notitie_bestanden' as onderdeel,
       case when to_regclass('public.notitie_bestanden') is not null then 'ok' else 'ontbreekt' end as status
union all
select 'notitie_bestanden: RLS aan',
       case when (select relrowsecurity from pg_class where oid = 'public.notitie_bestanden'::regclass) then 'ok' else 'uit' end
union all
select 'notitie_bestanden: policies (3)',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'notitie_bestanden') = 3 then 'ok' else 'ontbreekt' end
union all
select 'bucket notities (privé)',
       case when exists (select 1 from storage.buckets where id = 'notities' and not public) then 'ok' else 'ontbreekt' end;
