-- ============================================================================
-- Studio Levant-backoffice — profielfoto en klantstatus "afgewezen" (migratie 0039)
-- ============================================================================
--
-- Profielfoto: elk teamlid kan bij Account een foto instellen; die staat overal waar nu de
-- initialen staan. De foto staat in de privé-bucket "profielfotos" (geen policies: alleen de
-- server leest en schrijft, na de teamcheck) en het pad in profiles.foto_pad. De app laat
-- hem zien via /api/team/foto/[id] (alleen voor teamleden).
--
-- Klanten: naast koud / lead / actief / afgerond de status 'afgewezen' (een lead of iets op
-- de radar dat niet doorgaat), zodat afgewezen leads niet bij "afgerond" belanden. Krijgt een
-- afgewezen klant toch een factuur, dan wordt hij net als een lead vanzelf actief.
--
-- Veilig om opnieuw uit te voeren. Vereist 0021 (profiles) en 0033 (status 'koud').

-- ---------- profielfoto ----------
alter table public.profiles add column if not exists foto_pad text;
alter table public.profiles drop constraint if exists profiles_foto_pad_lengte;
alter table public.profiles add constraint profiles_foto_pad_lengte check (foto_pad is null or char_length(foto_pad) <= 300);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profielfotos', 'profielfotos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']) -- 2 MB
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------- klanten: status 'afgewezen' ----------
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.clients'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%''lead''%'
      and pg_get_constraintdef(oid) not ilike '%''afgewezen''%'
  loop
    execute format('alter table public.clients drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clients'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%''afgewezen''%'
  ) then
    alter table public.clients add constraint clients_status_check
      check (status in ('koud', 'lead', 'actief', 'afgerond', 'afgewezen'));
  end if;
end
$$;

create or replace function public.klant_actief_na_factuur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.clients set status = 'actief' where id = new.client_id and status in ('lead', 'koud', 'afgewezen');
  return new;
end;
$$;
revoke all on function public.klant_actief_na_factuur() from public, anon, authenticated;
