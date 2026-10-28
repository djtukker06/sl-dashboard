-- ============================================================================
-- Studio Levant-backoffice — boekhouding alleen met het vinkje (migratie 0030)
-- ============================================================================
--
-- Een teamlid zonder vinkje Boekhouding (team_members.boekhouding = false, migratie 0028)
-- ziet en wijzigt niets in de boekhouding zelf (alle 13 bk_*-tabellen: boekingen, bank,
-- btw-aangiften, activa, memoriaal, rapporten). Facturen, klanten en bonnetjes (invoices,
-- clients, expenses) blijven voor elk teamlid. Een admin (rol 'eigenaar') ziet altijd alles.
--
-- Hoe: per bk-tabel één RESTRICTIVE policy bovenop de bestaande policies uit 0027 (die
-- blijven ongewijzigd): elke actie moet daarnaast aan is_boekhouder() voldoen. De
-- boekhoudfuncties (bk_importeer, bk_memoriaal_toevoegen, …) zijn security invoker, dus ook
-- die vallen hieronder. Veilig om opnieuw uit te voeren.

create or replace function public.is_boekhouder()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teamlid() and exists (
    select 1 from public.team_members
    where user_id = (select auth.uid()) and actief and (boekhouding or rol = 'eigenaar')
  );
$$;

revoke all on function public.is_boekhouder() from public, anon;
grant execute on function public.is_boekhouder() to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['bk_instellingen', 'bk_grootboek', 'bk_rekeningen', 'bk_vennoten', 'bk_imports', 'bk_boekingen',
                           'bk_koppelingen', 'bk_activa', 'bk_bron_extra', 'bk_memoriaal', 'bk_memoriaal_regels',
                           'bk_aangiften', 'bk_boekjaren'] loop
    execute format('drop policy if exists "alleen boekhouding %s" on public.%I', t, t);
    execute format(
      'create policy "alleen boekhouding %s" on public.%I as restrictive for all to authenticated using ((select public.is_boekhouder())) with check ((select public.is_boekhouder()))',
      t, t
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

-- Controle: elke regel moet "ok" zijn.
select 'is_boekhouder()' as onderdeel,
       case when to_regprocedure('public.is_boekhouder()') is not null then 'ok' else 'ontbreekt' end as status
union all
select 'bk-tabellen met vinkje-policy (13)',
       case when (select count(*) from pg_policies where schemaname = 'public' and policyname like 'alleen boekhouding bk\_%' and permissive = 'RESTRICTIVE') = 13
            then 'ok' else 'ontbreekt' end;
