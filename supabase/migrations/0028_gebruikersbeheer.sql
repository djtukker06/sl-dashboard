-- ============================================================================
-- Studio Levant-backoffice — gebruikersbeheer (migratie 0028)
-- ============================================================================
--
-- Wat dit doet:
--   - team_members.boekhouding  mag dit teamlid de volledige boekhouding zien (boekingen,
--                               bank, btw, rapporten, activa)? Zonder: alleen facturen,
--                               klanten en bonnetjes. Bestaande leden houden toegang (true).
--   - is_teamlid()              een account met een tijdelijk wachtwoord (app_metadata
--                               wachtwoord_wijzigen = true, gezet door de admin bij aanmaken
--                               of resetten) krijgt in de database nog niets te zien, tot hij
--                               zelf een nieuw wachtwoord heeft gekozen. De app stuurt hem
--                               eerst naar /nieuw-wachtwoord (lib/auth/team.ts).
-- Admin = rol 'eigenaar' (bestaat al sinds 0021). Nieuwe accounts maakt alleen een admin aan,
-- via /gebruikers (app/api/beveiliging/gebruikers).
-- Veilig om opnieuw uit te voeren. Let op: UITVOEREN_0026.sql zet is_teamlid() terug naar de
-- versie zonder deze controle; voer daarna dit bestand opnieuw uit.

alter table public.team_members add column if not exists boekhouding boolean not null default true;

create or replace function public.is_teamlid()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.team_members
      where user_id = (select auth.uid()) and actief
    )
    -- Tijdelijk wachtwoord van de admin: eerst zelf een nieuw wachtwoord kiezen.
    and coalesce((select auth.jwt()) -> 'app_metadata' ->> 'wachtwoord_wijzigen', 'false') <> 'true'
    and (
      -- Noodstop (scripts/2fa-herstel.mjs --rls uit): 2FA telt even niet mee.
      coalesce((select not i.tfa_rls from public.app_instellingen i where i.id = 1), false)
      -- Sessie na de 2FA-code.
      or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
      -- Nog geen (geverifieerde) factor: niet buitensluiten, tenzij streng.
      or (
        not coalesce((select i.tfa_rls_streng from public.app_instellingen i where i.id = 1), false)
        and not exists (
          select 1 from auth.mfa_factors f
          where f.user_id = (select auth.uid()) and f.status::text = 'verified'
        )
      )
    );
$$;

revoke all on function public.is_teamlid() from public, anon;
grant execute on function public.is_teamlid() to authenticated, service_role;

notify pgrst, 'reload schema';

-- Controle: elke regel moet "ok" zijn.
select 'team_members.boekhouding' as onderdeel,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'team_members' and column_name = 'boekhouding'
       ) then 'ok' else 'ontbreekt' end as status
union all
select 'is_teamlid(): eerst eigen wachtwoord',
       case when pg_get_functiondef('public.is_teamlid()'::regprocedure) like '%wachtwoord_wijzigen%' then 'ok' else 'ontbreekt' end;
