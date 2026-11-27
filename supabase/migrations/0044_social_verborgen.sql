-- 0044: posts verbergen in het overzicht (bv. een gedeeld bericht of evenement dat de sync
-- van Facebook meeneemt). Alleen in het dashboard: op Instagram/Facebook verandert niets.
-- Verborgen blijft verborgen, ook na de volgende sync.
-- Idempotent: opnieuw uitvoeren kan zonder schade.

alter table public.social_posts
  add column if not exists verborgen boolean not null default false;

create index if not exists social_posts_verborgen_idx on public.social_posts (verborgen) where verborgen;

-- Controle: elke regel moet 'ok' zijn.
select 'social_posts.verborgen' as controle,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'social_posts' and column_name = 'verborgen'
       ) then 'ok' else 'ontbreekt' end as uitkomst
union all
select 'app (authenticated) kan er nog steeds niet bij',
       case when not has_table_privilege('authenticated', 'public.social_posts', 'select') then 'ok' else 'open' end;
