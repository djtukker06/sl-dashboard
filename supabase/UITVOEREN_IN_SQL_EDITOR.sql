-- ============================================================================
-- Studio Levant-backoffice — in één keer uitvoeren in de Supabase SQL Editor
-- ============================================================================
--
-- Wat dit doet: richt de nieuwe modules in.
--   0014–0017  Social media  tabellen social_*, bucket social-assets, huisstijl
--   0018       Agenda/taken  tabellen tasks en calendar_events
--   0019       Mail          privé-bucket mail-tmp (grote bijlagen)
--   0020       Uitgaven      tabellen expenses en expense_files, buckets uitgaven en uitgaven-export
-- De facturen-tabellen (0001–0013) worden NIET aangeraakt.
--
-- Zo voer je het uit:
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan verschijnt een controletabel: elke regel moet "ok" tonen.
--
-- Veilig om nogmaals uit te voeren: alles gebruikt "if not exists",
-- "drop policy if exists" of "on conflict do nothing". Bestaande gegevens
-- (posts, taken, uitgaven, een aangepaste huisstijl) blijven staan. Alles draait in
-- één transactie: gaat er iets mis, dan wordt niets half doorgevoerd.
--
-- Al eerder 0014–0019 uitgevoerd? Dan volstaat supabase/UITVOEREN_0020_UITGAVEN.sql.
--
-- Daarna: importeer de oude social-projecten met
--   scripts/importeer-social-projecten.mjs (zie README).
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/.
-- Niet met de hand aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

-- ------------------------------------------------------------------------------
-- 0014_social.sql
-- ------------------------------------------------------------------------------

-- Social media-module (voorheen de lokale Levant Social Studio).
-- Wat vroeger als bestanden op schijf stond, staat nu in deze tabellen:
--   projects/<id>/project.json   -> social_projects
--   projects/<id>/slides/*.html  -> social_slides
--   projects/<id>/versies/*.json -> social_versions
--   brand/brand.css + huisstijl.md -> social_brand (één rij)
--   projects/<id>/assets/*       -> Storage-bucket "social-assets" (zie 0015)
--   projects/.prullenbak         -> social_projects.deleted_at (zacht verwijderen)

create table if not exists public.social_projects (
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

create index if not exists social_projects_updated_at_idx
  on public.social_projects (updated_at desc)
  where deleted_at is null;

create table if not exists public.social_slides (
  project_id text not null references public.social_projects (id) on delete cascade,
  file text not null check (file ~* '^[a-z0-9][a-z0-9._-]*$'),
  html text not null,
  updated_at timestamptz not null default now(),
  primary key (project_id, file)
);

create table if not exists public.social_versions (
  id bigserial primary key,
  project_id text not null references public.social_projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  reason text,
  caption text,
  -- [{ "file": "slide-xxxx.html", "html": "<!doctype html>..." }, ...]
  slides jsonb not null default '[]'::jsonb
);

create index if not exists social_versions_project_created_idx
  on public.social_versions (project_id, created_at desc);

create table if not exists public.social_brand (
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
drop policy if exists "authenticated read/write social_projects" on public.social_projects;
create policy "authenticated read/write social_projects"
  on public.social_projects for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "authenticated read/write social_slides" on public.social_slides;
create policy "authenticated read/write social_slides"
  on public.social_slides for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "authenticated read/write social_versions" on public.social_versions;
create policy "authenticated read/write social_versions"
  on public.social_versions for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "authenticated read/write social_brand" on public.social_brand;
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

-- ------------------------------------------------------------------------------
-- 0015_social_storage.sql
-- ------------------------------------------------------------------------------

-- Privé-bucket voor de social media-module:
--   <project-id>/<bestand>             aangeleverd beeldmateriaal (uploads)
--   exports/<project-id>/<ts>-<naam>   tijdelijke exports (ZIP/PDF/PNG) die via
--                                      een kortlevende signed URL worden gedownload
insert into storage.buckets (id, name, public)
values ('social-assets', 'social-assets', false)
on conflict (id) do nothing;

-- Ingelogde gebruikers mogen lezen en schrijven (o.a. nodig voor uploads via een
-- signed upload-URL). De API-routes gebruiken de service-role client, altijd ná
-- een sessie-check in de route zelf.
drop policy if exists "authenticated read social assets" on storage.objects;
create policy "authenticated read social assets"
  on storage.objects for select
  using (bucket_id = 'social-assets' and (select auth.uid()) is not null);

drop policy if exists "authenticated insert social assets" on storage.objects;
create policy "authenticated insert social assets"
  on storage.objects for insert
  with check (bucket_id = 'social-assets' and (select auth.uid()) is not null);

drop policy if exists "authenticated update social assets" on storage.objects;
create policy "authenticated update social assets"
  on storage.objects for update
  using (bucket_id = 'social-assets' and (select auth.uid()) is not null)
  with check (bucket_id = 'social-assets' and (select auth.uid()) is not null);

drop policy if exists "authenticated delete social assets" on storage.objects;
create policy "authenticated delete social assets"
  on storage.objects for delete
  using (bucket_id = 'social-assets' and (select auth.uid()) is not null);

-- ------------------------------------------------------------------------------
-- 0016_social_brand_seed.sql
-- ------------------------------------------------------------------------------

-- Startwaarde voor de huisstijl van de social media-module: de inhoud van
-- brand/brand.css en brand/huisstijl.md uit de oude Social-media-tool.
-- Gegenereerd met scripts/genereer-brand-seed.mjs. Bestaat de rij al (bijv. omdat de
-- huisstijl in de app is aangepast), dan verandert deze migratie niets.
insert into public.social_brand (id, css, guide)
values (
  1,
  $brand$/* ==========================================================================
   Studio Levant — huisstijl voor social posts
   Elke slide linkt naar dit bestand. Pas je hier iets aan, dan verandert
   het in alle posts tegelijk.
   ========================================================================== */

@import url("https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Fragment+Mono&display=block");

:root {
  /* Kleuren (overgenomen van studio-levant.nl) */
  --lv-dark: #292929;      /* hoofdachtergrond */
  --lv-darker: #232323;    /* diepere variant */
  --lv-charcoal: #3c3b3b;  /* vlakken, lijnen op donker */
  --lv-grey: #868382;      /* secundaire tekst */
  --lv-sand: #e3dedb;      /* hoofdtekst op donker, accentvlak */
  --lv-sand-soft: #efebe8; /* lichte achtergrond */

  /* Typografie */
  --lv-font: "Manrope", system-ui, sans-serif;
  --lv-mono: "Fragment Mono", ui-monospace, monospace;

  /* Ritme */
  --lv-margin: 88px;       /* veilige marge rondom */
  --lv-radius: 6px;
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--lv-dark);
}

/* Canvas: breedte/hoogte komen uit --w en --h op <body> */
.slide {
  position: relative;
  width: var(--w, 1080px);
  height: var(--h, 1350px);
  overflow: hidden;
  background: var(--lv-dark);
  color: var(--lv-sand);
  font-family: var(--lv-font);
  font-weight: 500;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.01em;
}

.slide.lv-light {
  background: var(--lv-sand);
  color: var(--lv-dark);
}

/* Inkt-tinten per thema: niet alle tekst exact dezelfde kleur */
.slide {
  --lv-ink: var(--lv-sand);
  --lv-ink-soft: var(--lv-grey);
  --lv-line: var(--lv-charcoal);
}
.slide.lv-light {
  --lv-ink: var(--lv-dark);
  --lv-ink-soft: #5e5b5a;
  --lv-line: rgba(41, 41, 41, 0.16);
}

/* Koppen: Manrope bold, uppercase (huisstijlregel: titels altijd bold) */
.lv-h1 {
  font-size: 104px;
  line-height: 1.1;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.02em;
  margin: 0;
}
.lv-h2 {
  font-size: 68px;
  line-height: 1.1;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.015em;
  margin: 0;
}

/* Titelblok zoals goedgekeurd: korte aanloopregel + groot kernwoord + subtekst */
.lv-title-lead {
  font-size: 52px;
  line-height: 1.1;
  font-weight: 700;
  text-transform: uppercase;
  margin: 0;
}
.lv-title-big {
  font-size: 128px;
  line-height: 1.1;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.02em;
  margin: 6px 0 0;
}
.lv-sub {
  margin: 24px 0 0;
  font-size: 30px;
  line-height: 1.4;
  font-weight: 400;
  color: var(--lv-ink-soft);
}
.lv-body {
  font-size: 34px;
  line-height: 1.4;
  font-weight: 400;
  margin: 0;
}

/* Omgekeerd accentblok, zoals "CREATIVITEIT" op de website */
.lv-highlight {
  display: inline-block;
  background: var(--lv-sand);
  color: var(--lv-dark);
  padding: 0 0.08em;
  border-radius: 0.045em;   /* licht afgerond blok, zoals op de website */
  line-height: 1.1;
}
.lv-light .lv-highlight {
  background: var(--lv-dark);
  color: var(--lv-sand);
}

/* Kleine monospace labels (categorie, slidenummer, url) */
.lv-mono {
  font-family: var(--lv-mono);
  font-size: 24px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--lv-grey);
}

/* Woordmerk "Levant" zoals rechtsonder op de website */
.lv-wordmark {
  font-weight: 600;
  font-size: 64px;
  letter-spacing: -0.02em;
  line-height: 1;
}

.lv-logo {
  display: block;
  width: 96px;
  height: auto;
}

.lv-rule {
  height: 2px;
  background: var(--lv-charcoal);
  border: 0;
  margin: 0;
}
.lv-light .lv-rule { background: rgba(41, 41, 41, 0.18); }


/* ==========================================================================
   VASTE ELEMENTEN (kader, kop met logo, voetbalk)
   Deze worden door de studio automatisch in elke slide gezet, tussen
   <!-- lv:vast --> en <!-- /lv:vast -->. Pas ze hier aan, dan veranderen
   ze in alle posts tegelijk. Ontwerp de inhoud tussen
   var(--lv-content-top) en var(--lv-content-bottom).
   ========================================================================== */

body {
  --lv-frame-inset: 40px;
  --lv-header-top: 84px;
  --lv-logo-h: 64px;
  --lv-logo-mark: 48px;
  --lv-logo-tekst: 30px;
  --lv-footer-bottom: 84px;
  --lv-content-top: 210px;     /* inhoud begint onder het logo */
  --lv-content-bottom: 180px;  /* ruimte boven de voetbalk */
}
body[data-format="story"] {
  --lv-header-top: 220px;      /* Instagram-balk bovenin vrijhouden */
  --lv-footer-bottom: 280px;   /* reactieveld onderin vrijhouden */
  --lv-content-top: 350px;
  --lv-content-bottom: 380px;
}
body[data-format="linkedin-landscape"] {
  --lv-frame-inset: 22px;
  --lv-header-top: 44px;
  --lv-logo-h: 40px;
  --lv-logo-mark: 30px;
  --lv-logo-tekst: 20px;
  --lv-footer-bottom: 44px;
  --lv-content-top: 120px;
  --lv-content-bottom: 100px;
  --lv-margin: 64px;
}

.lv-frame {
  position: absolute;
  inset: var(--lv-frame-inset);
  border: 2px solid var(--lv-line);
  border-radius: 28px;
  pointer-events: none;
  z-index: 3;
}

.lv-header {
  position: absolute;
  top: var(--lv-header-top);
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  z-index: 4;
}
/* Het logo kleurt automatisch mee: zand op donker, donker op licht */
.lv-logo-banner {
  display: block;
  height: var(--lv-logo-h);
  aspect-ratio: 1600 / 594;
  background: var(--lv-ink);
  -webkit-mask: url("logo-compact-licht.png") center / contain no-repeat;
  mask: url("logo-compact-licht.png") center / contain no-repeat;
}

/* Kop: beeldmerk + naam, zoals op de post "Dit is Studio Levant".
   Kleurt mee: zand op donker, donker op licht. */
.lv-header { align-items: center; gap: 16px; }
.lv-logo {
  display: block;
  width: var(--lv-logo-mark);
  height: var(--lv-logo-mark);
  background: var(--lv-ink);
  -webkit-mask: url("logo-licht.png") center / contain no-repeat;
  mask: url("logo-licht.png") center / contain no-repeat;
}
.lv-logo-tekst {
  font-size: var(--lv-logo-tekst);
  line-height: 1;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--lv-ink);
}

.lv-footer {
  position: absolute;
  left: var(--lv-margin);
  right: var(--lv-margin);
  bottom: var(--lv-footer-bottom);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  z-index: 4;
}
.lv-footer .lv-mono { font-size: 22px; color: var(--lv-ink-soft); }
.lv-footer .lv-right { text-align: right; }
.lv-dots { display: flex; gap: 12px; }
.lv-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--lv-line);
}
.lv-light .lv-dot { background: rgba(41, 41, 41, 0.2); }
.lv-dot.is-active { background: var(--lv-ink); }
$brand$,
  $brand$# Studio Levant — huisstijl en tone of voice

Deze tekst gaat bij elke generatie mee naar Claude. Pas hem gerust aan.

## Over het bedrijf
Studio Levant is een creatief bureau uit Almelo. We combineren creativiteit met strategie
en realiseren resultaatgerichte ontwerpen. We staan voor kwaliteit, functionaliteit en oog voor detail.
Slogan op de website: "Waar creativiteit geen grenzen kent".
Website: studio-levant.nl

## Visuele stijl
- Overwegend donker (#292929) met warm zandkleurige tekst (#E3DEDB). Lichte slides (zand als achtergrond, donkere tekst) mogen als afwisseling.
- Geen felle kleuren. Het palet is bewust ingetogen: donker, zand, warmgrijs (#868382) en antraciet (#3C3B3B).
- Koppen in Manrope **bold**, uppercase, groot en strak. Eén kernwoord mag als omgekeerd blok (class `lv-highlight`), zoals "CREATIVITEIT" op de website.
- Kleine details in Fragment Mono (monospace, uppercase): labels, slidenummers, url.
- Veel lucht, duidelijke grid, links uitgelijnd. Minimalistisch en premium, niet druk.
- Het beeldmerk (hexagon met golvende lijnen) mag groot en deels buiten beeld als heel subtiel achtergrondelement (maximaal 4% dekking).

## Vaste regels voor elke post
Deze regels komen uit eerdere feedback en gelden altijd:
1. Het logo staat op elke slide op exact dezelfde plek bovenaan (wordt automatisch geplaatst), met kader en voetbalk.
2. Alle titels in Manrope bold, uppercase. Titelblok: korte aanloopregel, groot kernwoord (eventueel als accentblok) en een subtekst eronder. Titel staat op elke slide op dezelfde hoogte.
3. De subtekst onder een titel heeft overal dezelfde stijl (lv-sub). Gebruik geen afwijkende "losse" zinnetjes met een andere opmaak.
4. Rustig en luchtig, nooit druk. Liever minder elementen en meer ruimte tussen punten. Het mag niet "gegenereerd" of "vibe-coded" ogen: geen overbodige lijnen, badges, pillen of decoratie.
5. Niet alle tekst exact dezelfde kleur: titels in de hoofdtint, lopende tekst net iets zachter (lv-ink en lv-ink-soft).
6. Geen knoppen of knop-achtige elementen: op Instagram kun je niet klikken. Een call-to-action is tekst, bijv. "Stuur ons een DM" of "studio-levant.nl".
7. Wissel donkere en lichte slides af als dat het verhaal helpt.
8. Opeenvolgende slides met een lijst of stappen moeten duidelijk anders gevisualiseerd zijn, maar binnen hetzelfde systeem blijven.

## Tone of voice
- Nederlands, je-vorm, zelfverzekerd maar niet schreeuwerig.
- Korte, krachtige zinnen. Geen clichés of overdreven marketingtaal, geen emoji's in de slides.
- Inhoudelijk en behulpzaam: laat vakmanschap zien.
$brand$
)
on conflict (id) do nothing;

-- ------------------------------------------------------------------------------
-- 0017_social_storage_limieten.sql
-- ------------------------------------------------------------------------------

-- Grenzen voor de privé-bucket 'social-assets' (zie 0015_social_storage.sql).
--
-- Zonder deze grenzen kon een signed upload-URL (/api/social/projects/[id]/assets/upload-url)
-- een bestand van elke grootte en elk type in <project-id>/<bestand> zetten; de controle in
-- POST /assets kwam pas achteraf. Storage weigert nu zelf alles wat hierbuiten valt.
--
-- De limiet geldt voor de hele bucket, dus ook voor de tijdelijke exports onder
-- exports/<project-id>/ (ZIP met PNG's, PDF), die groter kunnen zijn dan een upload.
-- Daarom 50 MB (het standaard-maximum per bestand van Supabase). Uploads van
-- beeldmateriaal worden in de app strenger begrensd (MAX_UPLOAD_BYTES, 25 MB).
update storage.buckets
set file_size_limit = 52428800, -- 50 MB
    allowed_mime_types = array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'application/zip',
      'application/pdf'
    ]
where id = 'social-assets';

-- ------------------------------------------------------------------------------
-- 0018_agenda_taken.sql
-- ------------------------------------------------------------------------------

-- Agenda & taken.
--   tasks            taken (met of zonder datum/tijd); met tijd staan ze als blok in de agenda
--   calendar_events  afspraken (altijd een begin en eind; hele dag mogelijk)
-- Idempotent: veilig om (nogmaals) uit te voeren in de Supabase SQL Editor.
-- Geen herhalende afspraken in v1 (bewust: kwaliteit boven kwantiteit).

create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 300),
  notes text not null default '' check (length(notes) <= 10000),
  due_date date,                    -- null = "Ooit"
  due_time time,                    -- optioneel; met tijd staat de taak als blok in de agenda
  duration_minutes int check (duration_minutes between 5 and 1440),
  priority smallint not null default 2 check (priority between 1 and 3),  -- 1 hoog, 2 normaal, 3 laag
  client_id uuid references public.clients (id) on delete set null,
  completed_at timestamptz,         -- null = open
  sort_order int not null default 0,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_tijd_vereist_datum check (due_time is null or due_date is not null)
);

create index if not exists tasks_open_due_idx
  on public.tasks (due_date) where completed_at is null;
create index if not exists tasks_completed_idx
  on public.tasks (completed_at desc) where completed_at is not null;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 300),
  notes text not null default '' check (length(notes) <= 10000),
  location text not null default '' check (length(location) <= 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  client_id uuid references public.clients (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_eind_na_begin check (ends_at > starts_at)
);

create index if not exists calendar_events_starts_idx on public.calendar_events (starts_at);
create index if not exists calendar_events_ends_idx on public.calendar_events (ends_at);

-- updated_at automatisch bijwerken.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists calendar_events_set_updated_at on public.calendar_events;
create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- RLS: gedeeld voor het hele (kleine) team, net als clients (0003) en social (0014):
-- alleen "is dit een ingelogde gebruiker". De API-routes gebruiken de gebruikerscliënt.
alter table public.tasks enable row level security;
alter table public.calendar_events enable row level security;

drop policy if exists "authenticated read/write tasks" on public.tasks;
create policy "authenticated read/write tasks"
  on public.tasks for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "authenticated read/write calendar_events" on public.calendar_events;
create policy "authenticated read/write calendar_events"
  on public.calendar_events for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

-- ------------------------------------------------------------------------------
-- 0019_mail_opslag.sql
-- ------------------------------------------------------------------------------

-- Mail: privé-bucket voor het tijdelijk klaarzetten van grote bijlagen (> 4 MB).
-- Een Vercel-respons mag max. 4,5 MB zijn; grotere bijlagen gaan daarom eerst hierheen
-- en de browser downloadt ze via een signed URL van 60 seconden. Bestanden ouder dan
-- 15 minuten ruimt de app zelf op (lib/mail/opslag.ts).
--
-- Geen policies: alleen de service-role (in de API-route, ná de sessiecheck) gebruikt
-- deze bucket. Idempotent: twee keer uitvoeren geeft geen fout.
insert into storage.buckets (id, name, public, file_size_limit)
values ('mail-tmp', 'mail-tmp', false, 26214400)
on conflict (id) do nothing;

-- ------------------------------------------------------------------------------
-- 0020_uitgaven.sql
-- ------------------------------------------------------------------------------

-- Uitgaven: bonnetjes en betaalde facturen.
--   expenses       één uitgave (concept na een upload, of "verwerkt" = doorgegeven aan de boekhouder)
--   expense_files  de bestanden (foto's/PDF's) van een uitgave, in de privé-bucket "uitgaven"
--   buckets        "uitgaven" (bonnetjes, max. 25 MB, jpeg/png/webp/heic/pdf) en
--                  "uitgaven-export" (tijdelijke ZIP's voor de boekhouder, max. 50 MB)
-- Idempotent: veilig om (nogmaals) uit te voeren in de Supabase SQL Editor.
-- De facturen-tabellen worden alleen gelezen (klant koppelen, btw-overzicht), nooit gewijzigd.

create extension if not exists pgcrypto;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date,                                   -- datum op het bonnetje/de factuur
  supplier text not null default '' check (length(supplier) <= 200),
  description text not null default '' check (length(description) <= 500),
  category text check (category in (
    'software', 'hardware', 'kantoor', 'reiskosten', 'marketing', 'representatie',
    'opleiding', 'uitbesteed', 'telefoon', 'bankkosten', 'overig'
  )),
  total_amount numeric(12,2) check (total_amount between -1000000 and 1000000),  -- incl. btw
  vat_amount numeric(12,2) check (vat_amount between -1000000 and 1000000),
  vat_rate text check (vat_rate in ('21', '9', '0', 'verlegd', 'geen')),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  invoice_number text not null default '' check (length(invoice_number) <= 100),
  payment_method text check (payment_method in ('zakelijk', 'prive', 'creditcard', 'contant')),
  client_id uuid references public.clients (id) on delete set null,
  project_note text not null default '' check (length(project_note) <= 300),
  notes text not null default '' check (length(notes) <= 10000),
  status text not null default 'concept' check (status in ('concept', 'verwerkt')),
  -- Velden die door het automatisch uitlezen zijn ingevuld en nog niet door de gebruiker
  -- zijn aangepast (de app markeert ze subtiel).
  ai_fields text[] not null default '{}',
  ai_status text not null default 'geen' check (ai_status in ('geen', 'klaar', 'mislukt')),
  ai_message text not null default '' check (length(ai_message) <= 500),
  source text not null default 'upload' check (source in ('upload', 'mail', 'handmatig')),
  source_ref text not null default '' check (length(source_ref) <= 500),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "Verwerkt" kan pas met een datum en een bedrag.
  constraint expenses_verwerkt_compleet
    check (status = 'concept' or (expense_date is not null and total_amount is not null))
);

create index if not exists expenses_date_idx on public.expenses (expense_date desc nulls first);
create index if not exists expenses_status_idx on public.expenses (status) where status = 'concept';
create index if not exists expenses_supplier_idx on public.expenses (lower(supplier));
create index if not exists expenses_created_idx on public.expenses (created_at desc);

create table if not exists public.expense_files (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  storage_path text not null unique check (length(storage_path) <= 300),
  file_name text not null default '' check (length(file_name) <= 200),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'
  )),
  size_bytes bigint check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists expense_files_expense_idx on public.expense_files (expense_id, created_at);

-- updated_at automatisch bijwerken (functie uit 0018; hier opnieuw, zodat 0020 los kan draaien).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- RLS: gedeeld voor het hele (kleine) team, net als tasks (0018): alleen "is dit een
-- ingelogde gebruiker". De API-routes gebruiken de gebruikerscliënt; alleen Storage gaat
-- via de service-role (ná de sessiecheck in de route).
alter table public.expenses enable row level security;
alter table public.expense_files enable row level security;

drop policy if exists "authenticated read/write expenses" on public.expenses;
create policy "authenticated read/write expenses"
  on public.expenses for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "authenticated read/write expense_files" on public.expense_files;
create policy "authenticated read/write expense_files"
  on public.expense_files for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

-- Storage. Geen policies: alleen de service-role gebruikt deze buckets. Uploads gaan via
-- een signed upload-URL (buiten de 4,5 MB-limiet van Vercel om); Storage weigert zelf
-- bestanden boven de limiet of van een ander type.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uitgaven', 'uitgaven', false, 26214400, -- 25 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do nothing;

-- Exports (ZIP met bonnetjes + CSV) zijn groter dan een Vercel-respons: ze gaan hierheen en
-- de browser downloadt ze via een signed URL. De app ruimt exports ouder dan 15 min op.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uitgaven-export', 'uitgaven-export', false, 52428800, array['application/zip']) -- 50 MB
on conflict (id) do nothing;

commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen zijn.
notify pgrst, 'reload schema';

-- Controle: elke regel hoort "ok" te tonen.
select onderdeel,
       case when aanwezig then 'ok' else 'ONTBREEKT' end as status
from (values
  ('tabel social_projects',   to_regclass('public.social_projects') is not null),
  ('tabel social_slides',     to_regclass('public.social_slides') is not null),
  ('tabel social_versions',   to_regclass('public.social_versions') is not null),
  ('tabel social_brand',      to_regclass('public.social_brand') is not null),
  ('huisstijl (social_brand)', exists (select 1 from public.social_brand where id = 1)),
  ('functie social_restore_latest', to_regprocedure('public.social_restore_latest(text)') is not null),
  ('tabel tasks',             to_regclass('public.tasks') is not null),
  ('tabel calendar_events',   to_regclass('public.calendar_events') is not null),
  ('bucket social-assets',    exists (select 1 from storage.buckets where id = 'social-assets')),
  ('bucket mail-tmp',         exists (select 1 from storage.buckets where id = 'mail-tmp')),
  ('tabel expenses',          to_regclass('public.expenses') is not null),
  ('tabel expense_files',     to_regclass('public.expense_files') is not null),
  ('RLS expenses',            coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.expenses')), false)),
  ('RLS expense_files',       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.expense_files')), false)),
  ('policy expenses',         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses')),
  ('policy expense_files',    exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expense_files')),
  ('trigger updated_at',      exists (select 1 from pg_trigger where tgname = 'expenses_set_updated_at')),
  ('bucket uitgaven (privé)', exists (select 1 from storage.buckets where id = 'uitgaven' and not public)),
  ('bucket uitgaven-export',  exists (select 1 from storage.buckets where id = 'uitgaven-export' and not public))
) as c(onderdeel, aanwezig);
