-- Social media-module (voorheen de lokale Levant Social Studio).
-- Wat vroeger als bestanden op schijf stond, staat nu in deze tabellen:
--   projects/<id>/project.json   -> social_projects
--   projects/<id>/slides/*.html  -> social_slides
--   projects/<id>/versies/*.json -> social_versions
--   brand/brand.css + huisstijl.md -> social_brand (één rij)
--   projects/<id>/assets/*       -> Storage-bucket "social-assets" (zie 0015)
--   projects/.prullenbak         -> social_projects.deleted_at (zacht verwijderen)

create table public.social_projects (
  id text primary key check (id ~* '^[a-z0-9][a-z0-9._-]*$'),
  name text not null,
  format text not null default 'ig-portrait',
  brief jsonb not null default '{}'::jsonb,
  links jsonb not null default '[]'::jsonb,
  assets jsonb not null default '[]'::jsonb,
  caption text not null default '',
  -- Volgorde van de actieve slides (bestandsnamen). Niet-actieve slide-rijen
  -- blijven bestaan, net als losse bestanden in de oude slides-map.
  slides jsonb not null default '[]'::jsonb,
  brand_chrome boolean not null default true,
  feedback_log jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index social_projects_updated_at_idx
  on public.social_projects (updated_at desc)
  where deleted_at is null;

create table public.social_slides (
  project_id text not null references public.social_projects (id) on delete cascade,
  file text not null check (file ~* '^[a-z0-9][a-z0-9._-]*$'),
  html text not null,
  updated_at timestamptz not null default now(),
  primary key (project_id, file)
);

create table public.social_versions (
  id bigserial primary key,
  project_id text not null references public.social_projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  reason text,
  caption text,
  -- [{ "file": "slide-xxxx.html", "html": "<!doctype html>..." }, ...]
  slides jsonb not null default '[]'::jsonb
);

create index social_versions_project_created_idx
  on public.social_versions (project_id, created_at desc);

create table public.social_brand (
  id smallint primary key default 1 check (id = 1),
  css text not null default '',
  guide text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.social_projects enable row level security;
alter table public.social_slides enable row level security;
alter table public.social_versions enable row level security;
alter table public.social_brand enable row level security;

-- Gedeeld voor het hele (kleine) team, net als de klanten in 0003_rls.sql: geen
-- per-gebruiker eigenaarschap, alleen "is dit een ingelogde gebruiker".
-- De API-routes gebruiken de service-role client, altijd ná een sessie-check.
create policy "authenticated read/write social_projects"
  on public.social_projects for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

create policy "authenticated read/write social_slides"
  on public.social_slides for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

create policy "authenticated read/write social_versions"
  on public.social_versions for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

create policy "authenticated read/write social_brand"
  on public.social_brand for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

-- "Stap terug": zet de nieuwste bewaarde versie terug en verwijdert die versie,
-- in één transactie (zoals POST /api/projects/:id/restore in de oude server.js).
-- Geeft de bijgewerkte project-rij terug, of null als er geen eerdere versie is.
create or replace function public.social_restore_latest(p_project_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_version public.social_versions;
  v_project public.social_projects;
begin
  select * into v_version
  from social_versions
  where project_id = p_project_id
  order by created_at desc, id desc
  limit 1
  for update;

  if not found then
    return null;
  end if;

  insert into social_slides (project_id, file, html, updated_at)
  select p_project_id, s->>'file', s->>'html', now()
  from jsonb_array_elements(v_version.slides) as s
  on conflict (project_id, file)
  do update set html = excluded.html, updated_at = excluded.updated_at;

  update social_projects
  set slides = coalesce(
        (select jsonb_agg(s->'file' order by ord)
         from jsonb_array_elements(v_version.slides) with ordinality as t(s, ord)),
        '[]'::jsonb),
      caption = coalesce(v_version.caption, caption),
      updated_at = now()
  where id = p_project_id
  returning * into v_project;

  delete from social_versions where id = v_version.id;

  return to_jsonb(v_project);
end;
$$;

revoke all on function public.social_restore_latest(text) from public, anon;
grant execute on function public.social_restore_latest(text) to authenticated, service_role;
