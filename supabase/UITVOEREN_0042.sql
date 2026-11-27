-- 0042: een eigen titel per social post (alleen intern: in de lijst en de kalender, nooit
-- geplaatst). Leeg = de lijst en kalender tonen het begin van de caption.
-- Idempotent: opnieuw uitvoeren kan zonder schade.

alter table public.social_posts
  add column if not exists titel text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'social_posts_titel_lengte' and conrelid = 'public.social_posts'::regclass
  ) then
    alter table public.social_posts add constraint social_posts_titel_lengte check (char_length(titel) <= 120);
  end if;
end $$;

-- Controle: elke regel moet 'ok' zijn.
select 'social_posts.titel' as controle,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'social_posts' and column_name = 'titel'
       ) then 'ok' else 'ontbreekt' end as uitkomst
union all
select 'max. 120 tekens',
       case when exists (select 1 from pg_constraint where conname = 'social_posts_titel_lengte') then 'ok' else 'ontbreekt' end
union all
select 'app (authenticated) kan er nog steeds niet bij',
       case when not has_table_privilege('authenticated', 'public.social_posts', 'select') then 'ok' else 'open' end;
