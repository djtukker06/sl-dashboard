-- 0043: de afbeelding van een geplaatste post zoals Meta hem toont (eerste slide, of de
-- omslag van een video). Voor posts die buiten het dashboard zijn geplaatst is dit het enige
-- beeld dat we hebben. De URL komt van het CDN van Meta, verloopt na een paar dagen en wordt
-- bij elke sync (± elke 6 uur) ververst.
-- Idempotent: opnieuw uitvoeren kan zonder schade.

alter table public.social_post_kanalen
  add column if not exists beeld_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'social_post_kanalen_beeld_lengte' and conrelid = 'public.social_post_kanalen'::regclass
  ) then
    alter table public.social_post_kanalen add constraint social_post_kanalen_beeld_lengte
      check (beeld_url is null or (char_length(beeld_url) <= 4000 and beeld_url like 'https://%'));
  end if;
end $$;

-- Controle: elke regel moet 'ok' zijn.
select 'social_post_kanalen.beeld_url' as controle,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'social_post_kanalen' and column_name = 'beeld_url'
       ) then 'ok' else 'ontbreekt' end as uitkomst
union all
select 'alleen https, max. 4000 tekens',
       case when exists (select 1 from pg_constraint where conname = 'social_post_kanalen_beeld_lengte') then 'ok' else 'ontbreekt' end
union all
select 'app (authenticated) kan er nog steeds niet bij',
       case when not has_table_privilege('authenticated', 'public.social_post_kanalen', 'select') then 'ok' else 'open' end;
