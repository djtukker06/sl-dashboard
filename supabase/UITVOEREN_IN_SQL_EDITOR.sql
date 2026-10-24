-- ============================================================================
-- Studio Levant-backoffice — in één keer uitvoeren in de Supabase SQL Editor
-- ============================================================================
--
-- Wat dit doet: richt de nieuwe modules in.
--   0014–0017  Social media  tabellen social_*, bucket social-assets, huisstijl
--   0018       Agenda/taken  tabellen tasks en calendar_events
--   0019       Mail          privé-bucket mail-tmp (grote bijlagen)
--   0020       Uitgaven      tabellen expenses en expense_files, buckets uitgaven en uitgaven-export
--   0021       Team          alleen teamleden (allowlist + is_teamlid()) in ALLE policies,
--                            taken op naam, projecten, eigen mailbox per gebruiker
--   0022       Team van twee welkomstflow, taken alleen voor betrokkenen, klanten &
--                            projecten (status, notities, eigenaren), snelheid
--   0023       Projectenbord projectstatus voorbereiding / bezig / wachten / afgerond
--                            en sinds wanneer (status_sinds)
--   0024       Bestanden     Google Drive-koppeling (drive_koppeling, alleen server),
--                            mappen-cache, uploads en kopieën van facturen/bonnetjes
--   0025       Opvolgen      volgende stap en opvolgdatum per klant/lead, statusregels
--                            in de tijdlijn (client_notes.soort)
-- Van de facturen-tabellen (0001–0013) veranderen alleen de toegangsregels (0021) en
-- komen er bij clients drie kolommen met standaardwaarden bij (0022) en twee lege
-- kolommen voor opvolgen (0025).
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
-- Al eerder 0014–0020 uitgevoerd? Dan volstaat supabase/UITVOEREN_0021_TEAM.sql.
-- Al eerder 0014–0021 uitgevoerd? Dan volstaat supabase/UITVOEREN_0022.sql (+ 0023).
-- Al eerder 0014–0022 uitgevoerd? Dan volstaat supabase/UITVOEREN_0023.sql (+ 0024).
-- Al eerder 0014–0023 uitgevoerd? Dan volstaat supabase/UITVOEREN_0024.sql (+ 0025).
-- Al eerder 0014–0024 uitgevoerd? Dan volstaat supabase/UITVOEREN_0025.sql.
--
-- Daarna: importeer de oude social-projecten met
--   scripts/importeer-social-projecten.mjs (zie README).
--
-- EERST (vóór je dit uitvoert, zie README "Team & toegang"):
--   - Authentication -> Sign In / Providers: "Allow new users to sign up" UIT,
--     "Allow anonymous sign-ins" UIT, "Confirm email" AAN.
--   - Authentication -> Users: staat daar iemand die er niet hoort? Verwijder die eerst.
-- Daarna (eenmalig):
--   - Authentication -> Emails -> "Invite user": link naar
--     {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/nieuw-wachtwoord
--   - Teamlid toevoegen: node --env-file=.env.local scripts/teamlid-toevoegen.mjs --email … --naam "…"
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

-- ------------------------------------------------------------------------------
-- 0021_team_en_taken.sql
-- ------------------------------------------------------------------------------

-- Team, toegang en taken op naam.
--
--   profiles         weergavegegevens per gebruiker (naam, initialen, kleur); zelf aan te passen
--   team_members     de allowlist: alleen wie hier actief in staat, komt erin. Alleen te
--                    schrijven met de service-role (scripts/teamlid-*.mjs), nooit vanuit de app
--   is_teamlid()     de controle die ALLE policies gebruiken (i.p.v. "auth.uid() is not null")
--   projects         projecten (optioneel aan een klant gekoppeld)
--   task_assignees   voor wie een taak is (één of meer teamleden)
--   task_subtasks    afvinkbare subtaken
--   event_attendees  wie bij een afspraak hoort
--   user_mailboxes   eigen mailbox per gebruiker (wachtwoord versleuteld door de server;
--                    alleen de service-role leest deze tabel)
--
-- Waarom: tot nu toe was elke policy "auth.uid() is not null". Met de anon key uit de
-- browser kan iedereen zich (zolang aanmelden aan staat) registreren en daarna via de
-- REST-API en Storage alles lezen en schrijven. Vanaf nu telt alleen lidmaatschap.
-- Zet daarnaast in Supabase "Allow new users to sign up" en anonieme sign-ins UIT (README).
--
-- Volledig idempotent: veilig om (nogmaals) uit te voeren in de SQL Editor. Werkt ook als
-- 0020 (uitgaven) nog niet is uitgevoerd: de uitgaven-onderdelen worden dan overgeslagen
-- (voer dit bestand na 0020 dan gewoon nog een keer uit). Vereist 0001–0019.
-- Er wordt niets verwijderd: bestaande taken en afspraken gaan naar hun maker (of de eigenaar).

create extension if not exists pgcrypto;

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

-- ---------------------------------------------------------------------------------
-- 1. Team
-- ---------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  naam text not null check (length(btrim(naam)) between 1 and 80),
  initialen text not null check (char_length(initialen) between 1 and 3 and initialen = upper(initialen)),
  kleur text not null default '#c8a97e' check (kleur ~ '^#[0-9a-f]{6}$'),
  email text not null default '' check (length(email) <= 320),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create table if not exists public.team_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  actief boolean not null default true,
  rol text not null default 'lid' check (rol in ('eigenaar', 'lid')),
  toegevoegd_op timestamptz not null default now(),
  gedeactiveerd_op timestamptz
);

-- Is de ingelogde gebruiker een actief teamlid? SECURITY DEFINER zodat de policy op
-- team_members zelf geen rol speelt (geen recursie); search_path leeg tegen kaping.
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
  );
$$;

-- Is een andere gebruiker een actief teamlid? (bij het toewijzen van taken). Alleen
-- bruikbaar voor wie zelf teamlid is, zodat het niets prijsgeeft aan buitenstaanders.
create or replace function public.is_actief_teamlid(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teamlid() and exists (
    select 1 from public.team_members
    where user_id = p_user and actief
  );
$$;

revoke all on function public.is_teamlid() from public, anon;
revoke all on function public.is_actief_teamlid(uuid) from public, anon;
grant execute on function public.is_teamlid() to authenticated, service_role;
grant execute on function public.is_actief_teamlid(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 2. Lidmaatschap zaaien — ALLEEN bij de eerste keer (zolang team_members leeg is).
--    Alleen de OUDSTE bestaande, niet-anonieme gebruiker (bevestigd of al eens ingelogd;
--    nu: Daniel) wordt actief lid en eigenaar. Andere bestaande accounts worden bewust NIET
--    automatisch lid: zolang "Allow new users to sign up" aan stond, kan een buitenstaander
--    zich hebben geregistreerd. Ze staan als melding (NOTICE) in de uitvoer; een echte
--    collega voeg je daarna toe met scripts/teamlid-toevoegen.mjs. Controleer na het
--    uitvoeren de lijst onderaan (aantal leden + wie).
-- ---------------------------------------------------------------------------------
do $$
declare
  palet text[] := array['#c8a97e', '#8f6b4a', '#6e7b5b', '#b5654a', '#5b6b7b', '#9a7fa0'];
  overig record;
begin
  if exists (select 1 from public.team_members) then
    return;
  end if;

  with basis as (
    select
      u.id,
      coalesce(u.email, '') as email,
      left(coalesce(
        nullif(btrim(u.raw_user_meta_data->>'naam'), ''),
        nullif(btrim(u.raw_user_meta_data->>'name'), ''),
        nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(initcap(split_part(split_part(coalesce(u.email, ''), '@', 1), '.', 1)), ''),
        'Teamlid'
      ), 80) as naam,
      (row_number() over (order by u.created_at, u.id))::int as nr
    from auth.users u
    where coalesce(u.email_confirmed_at, u.last_sign_in_at) is not null
      and coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false) = false
      and (u.banned_until is null or u.banned_until < now())
  ),
  met_initialen as (
    select b.*,
      upper(
        left(split_part(b.naam, ' ', 1), 1) ||
        coalesce(left(nullif(split_part(b.naam, ' ', 2), ''), 1), '')
      ) as initialen
    from basis b
    where b.nr = 1
  ),
  profielen as (
    insert into public.profiles (id, naam, initialen, kleur, email)
    select id, naam, coalesce(nullif(initialen, ''), 'S'), palet[1 + ((nr - 1) % array_length(palet, 1))], email
    from met_initialen
    on conflict (id) do nothing
    returning id
  )
  insert into public.team_members (user_id, actief, rol)
  select id, true, 'eigenaar'
  from met_initialen
  on conflict (user_id) do nothing;

  -- Andere bestaande accounts: niet automatisch lid, wel melden.
  for overig in
    select coalesce(u.email, '(geen e-mailadres)') as email
    from auth.users u
    where not exists (select 1 from public.team_members m where m.user_id = u.id)
      and coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false) = false
    order by u.created_at, u.id
  loop
    raise notice 'Niet automatisch teamlid: % (hoort het erbij? voeg toe met scripts/teamlid-toevoegen.mjs)', overig.email;
  end loop;
end
$$;

-- Hulpfunctie: de (oudste actieve) eigenaar, voor het toewijzen van bestaande data.
create or replace function public.team_eigenaar()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id from public.team_members
  where rol = 'eigenaar' and actief
  order by toegevoegd_op, user_id
  limit 1;
$$;
revoke all on function public.team_eigenaar() from public, anon, authenticated;
grant execute on function public.team_eigenaar() to service_role;

-- ---------------------------------------------------------------------------------
-- 3. Projecten
-- ---------------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  naam text not null check (length(btrim(naam)) between 1 and 120),
  client_id uuid references public.clients (id) on delete set null,
  status text not null default 'actief' check (status in ('actief', 'gearchiveerd')),
  notitie text not null default '' check (length(notitie) <= 2000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists projects_klant_naam_key
  on public.projects (coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(naam)));
create index if not exists projects_client_idx on public.projects (client_id);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------
-- 4. Taken op naam
-- ---------------------------------------------------------------------------------
alter table public.tasks
  add column if not exists project_id uuid references public.projects (id) on delete set null,
  add column if not exists completed_by uuid references auth.users (id) on delete set null;

create index if not exists tasks_project_idx on public.tasks (project_id) where project_id is not null;

create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  toegewezen_door uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists task_assignees_user_idx on public.task_assignees (user_id, task_id);

create table if not exists public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  titel text not null check (length(btrim(titel)) between 1 and 200),
  klaar_op timestamptz,
  klaar_door uuid references auth.users (id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists task_subtasks_task_idx on public.task_subtasks (task_id, sort_order, created_at);

-- Bestaande taken: toewijzen aan de maker (als die teamlid is), anders aan de eigenaar.
insert into public.task_assignees (task_id, user_id, toegewezen_door)
select t.id,
       case when exists (select 1 from public.team_members m where m.user_id = t.created_by)
            then t.created_by else public.team_eigenaar() end,
       null
from public.tasks t
where not exists (select 1 from public.task_assignees a where a.task_id = t.id)
  and (t.created_by is not null and exists (select 1 from public.team_members m where m.user_id = t.created_by)
       or public.team_eigenaar() is not null)
on conflict do nothing;

update public.tasks t
set completed_by = case when exists (select 1 from public.team_members m where m.user_id = t.created_by)
                        then t.created_by else public.team_eigenaar() end
where t.completed_at is not null and t.completed_by is null;

-- ---------------------------------------------------------------------------------
-- 5. Afspraken: deelnemers
-- ---------------------------------------------------------------------------------
create table if not exists public.event_attendees (
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_attendees_user_idx on public.event_attendees (user_id);

insert into public.event_attendees (event_id, user_id)
select e.id,
       case when exists (select 1 from public.team_members m where m.user_id = e.created_by)
            then e.created_by else public.team_eigenaar() end
from public.calendar_events e
where not exists (select 1 from public.event_attendees a where a.event_id = e.id)
  and (e.created_by is not null and exists (select 1 from public.team_members m where m.user_id = e.created_by)
       or public.team_eigenaar() is not null)
on conflict do nothing;

-- "Aangemaakt door" kan na het aanmaken niet meer veranderen. Eén uitzondering: wordt de
-- maker zelf verwijderd (auth.users, "on delete set null"), dan mag de waarde leeg worden;
-- anders blokkeert deze trigger het verwijderen van een (oud-)teamlid.
-- SECURITY DEFINER: de ingelogde rol mag auth.users zelf niet lezen.
create or replace function public.behoud_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    if new.created_by is null and old.created_by is not null
       and not exists (select 1 from auth.users u where u.id = old.created_by) then
      return new;
    end if;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
revoke all on function public.behoud_created_by() from public, anon, authenticated;

drop trigger if exists tasks_behoud_created_by on public.tasks;
create trigger tasks_behoud_created_by
  before update on public.tasks
  for each row execute function public.behoud_created_by();

drop trigger if exists calendar_events_behoud_created_by on public.calendar_events;
create trigger calendar_events_behoud_created_by
  before update on public.calendar_events
  for each row execute function public.behoud_created_by();

-- ---------------------------------------------------------------------------------
-- 6. "Aangemaakt door" op klanten, social-posts en bonnetjes
-- ---------------------------------------------------------------------------------
alter table public.clients
  add column if not exists created_by uuid references auth.users (id) on delete set null default auth.uid();
alter table public.social_projects
  add column if not exists created_by uuid references auth.users (id) on delete set null default auth.uid();

do $$
begin
  if to_regclass('public.expenses') is not null then
    execute $sql$
      alter table public.expenses
        add column if not exists soort text check (soort in ('bonnetje', 'inkoopfactuur', 'overig'))
    $sql$;
    -- Bestaande uploads een soort geven (PDF = inkoopfactuur, foto = bonnetje), zodat het
    -- filter "Bonnetjes / Inkoopfacturen" ook de oude uploads vindt. Alleen lege waarden.
    if to_regclass('public.expense_files') is not null then
      execute $sql$
        update public.expenses e
        set soort = case
          when exists (select 1 from public.expense_files f where f.expense_id = e.id and f.mime_type = 'application/pdf')
            then 'inkoopfactuur'
          else 'bonnetje'
        end
        where e.soort is null
          and exists (select 1 from public.expense_files f where f.expense_id = e.id)
      $sql$;
    end if;
  end if;
end
$$;

-- invoices.created_by en quotes.created_by verwezen naar auth.users zonder "on delete": dan
-- kan een (oud-)teamlid met facturen nooit verwijderd worden. Voortaan: maker wordt leeg.
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tabel
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.conrelid in ('public.invoices'::regclass, 'public.quotes'::regclass)
      and a.attname = 'created_by'
      and c.confdeltype <> 'n'
  loop
    execute format('alter table %s drop constraint %I', r.tabel, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (created_by) references auth.users (id) on delete set null',
      r.tabel, r.conname
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------
-- 7. Eigen mailbox per gebruiker. RLS aan en GEEN policies: alleen de server leest deze
--    tabel (service-role, altijd met user_id = eigen sessie). Het wachtwoord staat er
--    versleuteld (AES-256-GCM, sleutel alleen in de server-env) en komt nooit in de browser.
-- ---------------------------------------------------------------------------------
create table if not exists public.user_mailboxes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (length(email) between 3 and 320),
  imap_host text not null default 'mail.privateemail.com' check (length(imap_host) <= 253),
  imap_port int not null default 993 check (imap_port in (993, 143)),
  smtp_host text not null default 'mail.privateemail.com' check (length(smtp_host) <= 253),
  smtp_port int not null default 465 check (smtp_port in (465, 587)),
  from_name text not null default '' check (length(from_name) <= 120),
  handtekening text not null default '' check (length(handtekening) <= 5000),
  wachtwoord_enc text not null check (wachtwoord_enc like 'v1:%'),
  sleutel_versie smallint not null default 1,
  geverifieerd_op timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists user_mailboxes_set_updated_at on public.user_mailboxes;
create trigger user_mailboxes_set_updated_at
  before update on public.user_mailboxes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------
-- 8. Wie mag een taak/afspraak wijzigen? Teamlid én (maker of toegewezen/deelnemer).
--    SECURITY DEFINER: zo is er geen RLS-recursie tussen tasks en task_assignees.
-- ---------------------------------------------------------------------------------
create or replace function public.taak_betrokken(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teamlid() and exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (t.created_by = (select auth.uid())
           or exists (select 1 from public.task_assignees a
                      where a.task_id = t.id and a.user_id = (select auth.uid())))
  );
$$;

create or replace function public.afspraak_betrokken(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teamlid() and exists (
    select 1 from public.calendar_events e
    where e.id = p_event
      and (e.created_by = (select auth.uid())
           or exists (select 1 from public.event_attendees a
                      where a.event_id = e.id and a.user_id = (select auth.uid())))
  );
$$;

revoke all on function public.taak_betrokken(uuid) from public, anon;
revoke all on function public.afspraak_betrokken(uuid) from public, anon;
grant execute on function public.taak_betrokken(uuid) to authenticated, service_role;
grant execute on function public.afspraak_betrokken(uuid) to authenticated, service_role;

-- Een taak met toegewezenen en subtaken in één transactie aanmaken. SECURITY INVOKER:
-- alle RLS-policies gelden gewoon (maker = de ingelogde gebruiker).
--   p = { titel, notities?, datum?, tijd?, duur?, prioriteit?, klantId?, projectId?,
--         voorWie: [uuid, ...], subtaken: [text, ...] }
create or replace function public.taak_aanmaken(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_klant uuid := nullif(p->>'klantId', '')::uuid;
  v_project uuid := nullif(p->>'projectId', '')::uuid;
  v_project_klant uuid;
  v_aantal int;
begin
  if not public.is_teamlid() then
    raise exception 'Geen toegang.' using errcode = '42501';
  end if;

  if v_project is not null then
    select client_id into v_project_klant from public.projects where id = v_project;
    if not found then
      raise exception 'Dat project bestaat niet (meer).' using errcode = '23503';
    end if;
    if v_klant is null then
      v_klant := v_project_klant;
    elsif v_project_klant is not null and v_project_klant <> v_klant then
      raise exception 'Het project hoort bij een andere klant.' using errcode = '23514';
    end if;
  end if;

  insert into public.tasks (title, notes, due_date, due_time, duration_minutes, priority, client_id, project_id)
  values (
    btrim(p->>'titel'),
    coalesce(p->>'notities', ''),
    nullif(p->>'datum', '')::date,
    nullif(p->>'tijd', '')::time,
    nullif(p->>'duur', '')::int,
    coalesce(nullif(p->>'prioriteit', '')::smallint, 2),
    v_klant,
    v_project
  )
  returning id into v_id;

  insert into public.task_assignees (task_id, user_id)
  select distinct v_id, x::uuid
  from jsonb_array_elements_text(coalesce(p->'voorWie', '[]'::jsonb)) as x;

  select count(*) into v_aantal from public.task_assignees where task_id = v_id;
  if v_aantal = 0 then
    raise exception 'Kies minstens één persoon.' using errcode = '23514';
  end if;

  insert into public.task_subtasks (task_id, titel, sort_order)
  select v_id, btrim(s.titel), s.nr::int
  from jsonb_array_elements_text(coalesce(p->'subtaken', '[]'::jsonb)) with ordinality as s(titel, nr)
  where btrim(s.titel) <> '';

  return v_id;
end;
$$;

revoke all on function public.taak_aanmaken(jsonb) from public, anon;
grant execute on function public.taak_aanmaken(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 9. RLS: alle bestaande policies op de gedeelde tabellen weg, opnieuw met is_teamlid().
-- ---------------------------------------------------------------------------------
do $$
declare
  t text;
  p record;
  gedeeld text[] := array[
    'clients', 'social_projects', 'social_slides', 'social_versions', 'social_brand',
    'expenses', 'expense_files', 'projects'
  ];
  alleen_lezen text[] := array['invoices', 'invoice_counters', 'quotes'];
  overig text[] := array[
    'tasks', 'task_assignees', 'task_subtasks', 'calendar_events', 'event_attendees',
    'profiles', 'team_members', 'user_mailboxes'
  ];
begin
  foreach t in array gedeeld || alleen_lezen || overig loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;

  -- Gedeelde bedrijfsdata: lezen en schrijven voor elk actief teamlid.
  foreach t in array gedeeld loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select public.is_teamlid())) with check ((select public.is_teamlid()))',
      'teamleden lezen en schrijven ' || t, t
    );
  end loop;

  -- Facturen, tellers en prijsopgaven: alleen lezen (schrijven gaat via de server).
  foreach t in array alleen_lezen loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_teamlid()))',
      'teamleden lezen ' || t, t
    );
  end loop;
end
$$;

-- Taken: iedereen in het team mag ze zien (agenda-filter "Heel team"); wijzigen alleen
-- door de maker of een toegewezene. Het dashboard toont alleen je eigen taken (app-filter).
drop policy if exists "teamleden lezen taken" on public.tasks;
create policy "teamleden lezen taken" on public.tasks
  for select to authenticated using ((select public.is_teamlid()));
drop policy if exists "teamleden maken taken" on public.tasks;
create policy "teamleden maken taken" on public.tasks
  for insert to authenticated
  with check ((select public.is_teamlid()) and created_by = (select auth.uid()));
drop policy if exists "betrokkenen wijzigen taken" on public.tasks;
create policy "betrokkenen wijzigen taken" on public.tasks
  for update to authenticated
  using (public.taak_betrokken(id)) with check ((select public.is_teamlid()));
drop policy if exists "betrokkenen verwijderen taken" on public.tasks;
create policy "betrokkenen verwijderen taken" on public.tasks
  for delete to authenticated using (public.taak_betrokken(id));

drop policy if exists "teamleden lezen toewijzingen" on public.task_assignees;
create policy "teamleden lezen toewijzingen" on public.task_assignees
  for select to authenticated using ((select public.is_teamlid()));
drop policy if exists "betrokkenen wijzen toe" on public.task_assignees;
create policy "betrokkenen wijzen toe" on public.task_assignees
  for insert to authenticated
  with check (public.taak_betrokken(task_id) and public.is_actief_teamlid(user_id));
drop policy if exists "betrokkenen trekken toewijzing in" on public.task_assignees;
create policy "betrokkenen trekken toewijzing in" on public.task_assignees
  for delete to authenticated using (public.taak_betrokken(task_id));

drop policy if exists "teamleden lezen subtaken" on public.task_subtasks;
create policy "teamleden lezen subtaken" on public.task_subtasks
  for select to authenticated using ((select public.is_teamlid()));
drop policy if exists "betrokkenen maken subtaken" on public.task_subtasks;
create policy "betrokkenen maken subtaken" on public.task_subtasks
  for insert to authenticated with check (public.taak_betrokken(task_id));
drop policy if exists "betrokkenen wijzigen subtaken" on public.task_subtasks;
create policy "betrokkenen wijzigen subtaken" on public.task_subtasks
  for update to authenticated
  using (public.taak_betrokken(task_id)) with check (public.taak_betrokken(task_id));
drop policy if exists "betrokkenen verwijderen subtaken" on public.task_subtasks;
create policy "betrokkenen verwijderen subtaken" on public.task_subtasks
  for delete to authenticated using (public.taak_betrokken(task_id));

drop policy if exists "teamleden lezen afspraken" on public.calendar_events;
create policy "teamleden lezen afspraken" on public.calendar_events
  for select to authenticated using ((select public.is_teamlid()));
drop policy if exists "teamleden maken afspraken" on public.calendar_events;
create policy "teamleden maken afspraken" on public.calendar_events
  for insert to authenticated
  with check ((select public.is_teamlid()) and created_by = (select auth.uid()));
drop policy if exists "betrokkenen wijzigen afspraken" on public.calendar_events;
create policy "betrokkenen wijzigen afspraken" on public.calendar_events
  for update to authenticated
  using (public.afspraak_betrokken(id)) with check ((select public.is_teamlid()));
drop policy if exists "betrokkenen verwijderen afspraken" on public.calendar_events;
create policy "betrokkenen verwijderen afspraken" on public.calendar_events
  for delete to authenticated using (public.afspraak_betrokken(id));

drop policy if exists "teamleden lezen deelnemers" on public.event_attendees;
create policy "teamleden lezen deelnemers" on public.event_attendees
  for select to authenticated using ((select public.is_teamlid()));
drop policy if exists "betrokkenen voegen deelnemers toe" on public.event_attendees;
create policy "betrokkenen voegen deelnemers toe" on public.event_attendees
  for insert to authenticated
  with check (public.afspraak_betrokken(event_id) and public.is_actief_teamlid(user_id));
drop policy if exists "betrokkenen halen deelnemers weg" on public.event_attendees;
create policy "betrokkenen halen deelnemers weg" on public.event_attendees
  for delete to authenticated using (public.afspraak_betrokken(event_id));

-- Profielen: het team ziet elkaars naam/kleur; je past alleen je eigen profiel aan, en
-- alleen naam, initialen en kleur (niet het e-mailadres of je id).
drop policy if exists "teamleden lezen profielen" on public.profiles;
create policy "teamleden lezen profielen" on public.profiles
  for select to authenticated using ((select public.is_teamlid()));
drop policy if exists "eigen profiel aanpassen" on public.profiles;
create policy "eigen profiel aanpassen" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select public.is_teamlid()))
  with check (id = (select auth.uid()) and (select public.is_teamlid()));
revoke insert, update, delete on public.profiles from authenticated;
grant update (naam, initialen, kleur) on public.profiles to authenticated;

-- Lidmaatschap: je ziet je eigen regel (ook als je gedeactiveerd bent, zodat de app
-- "geen toegang" kan tonen) en als teamlid die van de anderen. Nooit schrijven.
drop policy if exists "eigen lidmaatschap of teamlid" on public.team_members;
create policy "eigen lidmaatschap of teamlid" on public.team_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_teamlid()));
revoke insert, update, delete on public.team_members from authenticated;

-- user_mailboxes: geen enkele policy en geen rechten voor anon/authenticated.
revoke all on public.user_mailboxes from anon, authenticated;

-- ---------------------------------------------------------------------------------
-- 10. Storage: alleen teamleden. De buckets uitgaven, uitgaven-export en mail-tmp
--     houden bewust géén policies (alleen de service-role, ná de controle in de app).
-- ---------------------------------------------------------------------------------
drop policy if exists "authenticated read invoice pdfs" on storage.objects;
drop policy if exists "authenticated read social assets" on storage.objects;
drop policy if exists "authenticated insert social assets" on storage.objects;
drop policy if exists "authenticated update social assets" on storage.objects;
drop policy if exists "authenticated delete social assets" on storage.objects;

drop policy if exists "teamleden lezen factuur-pdfs" on storage.objects;
create policy "teamleden lezen factuur-pdfs" on storage.objects
  for select to authenticated
  using (bucket_id = 'invoices' and (select public.is_teamlid()));

drop policy if exists "teamleden lezen social-bestanden" on storage.objects;
create policy "teamleden lezen social-bestanden" on storage.objects
  for select to authenticated
  using (bucket_id = 'social-assets' and (select public.is_teamlid()));

drop policy if exists "teamleden uploaden social-bestanden" on storage.objects;
create policy "teamleden uploaden social-bestanden" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'social-assets' and (select public.is_teamlid()));

drop policy if exists "teamleden wijzigen social-bestanden" on storage.objects;
create policy "teamleden wijzigen social-bestanden" on storage.objects
  for update to authenticated
  using (bucket_id = 'social-assets' and (select public.is_teamlid()))
  with check (bucket_id = 'social-assets' and (select public.is_teamlid()));

drop policy if exists "teamleden verwijderen social-bestanden" on storage.objects;
create policy "teamleden verwijderen social-bestanden" on storage.objects
  for delete to authenticated
  using (bucket_id = 'social-assets' and (select public.is_teamlid()));

-- Controle: geen enkele bucket is openbaar.
update storage.buckets set public = false
where id in ('invoices', 'social-assets', 'mail-tmp', 'uitgaven', 'uitgaven-export') and public;

-- ---------------------------------------------------------------------------------
-- 11. Functierechten. create_invoice/update_invoice zijn SECURITY DEFINER zonder eigen
--     controle; ze waren (via PUBLIC) zelfs met alleen de anon key aan te roepen. De app
--     roept ze uitsluitend aan met de service-role, dus alleen die mag ze nog uitvoeren.
-- ---------------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_invoice', 'update_invoice', 'social_restore_latest')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------
-- 12. Extra laag: de anonieme rol (alleen de anon key, zonder sessie) mag niets in public.
-- ---------------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- ------------------------------------------------------------------------------
-- 0022_team_crm.sql
-- ------------------------------------------------------------------------------

-- 0022: het team van twee (Daniel en Bram) — welkomstflow, wie-ziet-welke-taak, klanten
-- en projecten. Idempotent: twee keer uitvoeren geeft geen fout. Alleen toevoegen; de
-- facturen-functionaliteit (tabellen, RPC's) blijft ongewijzigd. Vereist 0021.
--
-- Dit bestand groeit per bouwstap:
--   stap 1  profiles.welkom_klaar_op (welkomstflow bij de eerste login)
--   stap 2  wie ziet welke taak/afspraak (leesregels), index voor "Uitgezet"
--   stap 3  klanten & projecten: contact/status op clients, client_notes, projectstatus
--           gepland/bezig/afgerond + deadline + project_eigenaren
--   stap 4  snelheid: tellingen in één query (taak_tellingen, project_taak_tellingen) en
--           indexen voor de agenda en de klantpagina

-- ---------------------------------------------------------------------------------
-- Stap 1. Welkomstflow
-- ---------------------------------------------------------------------------------
-- null = de welkomstflow (/welkom) is nog niet doorlopen. De app stuurt een teamlid
-- zolang naar /welkom; zonder deze kolom (0022 nog niet uitgevoerd) slaat de app de
-- flow over.
alter table public.profiles add column if not exists welkom_klaar_op timestamptz;

-- Bestaande eigenaren (Daniel) hebben alles al ingericht: zij zien de flow nooit.
-- Een lid (Bram) wel, ook als hij al vóór deze migratie is uitgenodigd.
update public.profiles p
   set welkom_klaar_op = now()
  from public.team_members m
 where m.user_id = p.id
   and m.rol = 'eigenaar'
   and p.welkom_klaar_op is null;

-- Je mag alleen deze kolom van je EIGEN profiel zetten (de bestaande policy "eigen profiel
-- aanpassen" uit 0021 beperkt tot id = auth.uid() en een actief teamlid). Andere kolommen
-- (e-mail, id) blijven dicht; naam/initialen/kleur waren al toegestaan.
grant update (welkom_klaar_op) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------------
-- Stap 2. Wie ziet welke taak en afspraak
-- ---------------------------------------------------------------------------------
-- Tot nu toe mocht elk teamlid ALLE taken en afspraken lezen (agenda-filter "Heel team").
-- Nu geldt: een taak die Daniel alleen voor Bram maakt, staat bij Bram — en bestaat voor
-- een derde niet, ook niet via de API. Lezen mag:
--   - de maker (die ziet hem onder "Uitgezet", niet in zijn eigen lijst);
--   - wie de taak heeft gekregen (task_assignees);
--   - bij een taak in een project: het hele team (voortgang op de projectpagina). Zo'n
--     taak staat nooit in iemands eigen lijst; die lijsten filteren op task_assignees.
-- Afspraken: de maker en de deelnemers (event_attendees).
-- Wijzigen blijft zoals in 0021 (taak_betrokken / afspraak_betrokken).

-- SECURITY DEFINER: leest tasks/task_assignees zonder RLS, zodat de policies op
-- task_assignees/task_subtasks niet via tasks in een lus terechtkomen.
create or replace function public.taak_zichtbaar(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teamlid() and exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (t.created_by = (select auth.uid())
           or t.project_id is not null
           or exists (select 1 from public.task_assignees a
                      where a.task_id = t.id and a.user_id = (select auth.uid())))
  );
$$;

revoke all on function public.taak_zichtbaar(uuid) from public, anon;
grant execute on function public.taak_zichtbaar(uuid) to authenticated, service_role;

drop policy if exists "teamleden lezen taken" on public.tasks;
drop policy if exists "betrokkenen lezen taken" on public.tasks;
create policy "betrokkenen lezen taken" on public.tasks
  for select to authenticated
  using (
    (select public.is_teamlid())
    and (created_by = (select auth.uid())
         or project_id is not null
         or exists (select 1 from public.task_assignees a
                    where a.task_id = tasks.id and a.user_id = (select auth.uid())))
  );

drop policy if exists "teamleden lezen toewijzingen" on public.task_assignees;
drop policy if exists "betrokkenen lezen toewijzingen" on public.task_assignees;
create policy "betrokkenen lezen toewijzingen" on public.task_assignees
  for select to authenticated
  using ((select public.is_teamlid()) and (user_id = (select auth.uid()) or public.taak_zichtbaar(task_id)));

drop policy if exists "teamleden lezen subtaken" on public.task_subtasks;
drop policy if exists "betrokkenen lezen subtaken" on public.task_subtasks;
create policy "betrokkenen lezen subtaken" on public.task_subtasks
  for select to authenticated
  using ((select public.is_teamlid()) and public.taak_zichtbaar(task_id));

drop policy if exists "teamleden lezen afspraken" on public.calendar_events;
drop policy if exists "betrokkenen lezen afspraken" on public.calendar_events;
create policy "betrokkenen lezen afspraken" on public.calendar_events
  for select to authenticated
  using (
    (select public.is_teamlid())
    and (created_by = (select auth.uid())
         or exists (select 1 from public.event_attendees a
                    where a.event_id = calendar_events.id and a.user_id = (select auth.uid())))
  );

drop policy if exists "teamleden lezen deelnemers" on public.event_attendees;
drop policy if exists "betrokkenen lezen deelnemers" on public.event_attendees;
create policy "betrokkenen lezen deelnemers" on public.event_attendees
  for select to authenticated
  using ((select public.is_teamlid()) and (user_id = (select auth.uid()) or public.afspraak_betrokken(event_id)));

-- "Uitgezet": open taken die jij maakte (en waar je zelf niet op staat).
create index if not exists tasks_maker_open_idx on public.tasks (created_by) where completed_at is null;

-- ---------------------------------------------------------------------------------
-- Stap 3. Klanten & projecten (simpel: weinig velden, geen pipeline, geen uren)
-- ---------------------------------------------------------------------------------
-- Klanten: e-mail, telefoon en een status (lead / actief / afgerond). Alleen kolommen
-- erbij, met standaardwaarden: de facturen (formulieren, RPC's, PDF) sturen deze kolommen
-- niet mee en werken ongewijzigd; een klant die via een factuur ontstaat is 'actief'.
alter table public.clients
  add column if not exists email text not null default '' check (length(email) <= 320),
  add column if not exists telefoon text not null default '' check (length(telefoon) <= 40),
  add column if not exists status text not null default 'actief' check (status in ('lead', 'actief', 'afgerond'));

create index if not exists clients_status_idx on public.clients (status);

-- Een lead met een factuur is een actieve klant. De facturen-code (upsertKlant, RPC's)
-- raakt de status niet aan; deze trigger zet een lead op 'actief' zodra er een factuur
-- voor de klant bestaat. SECURITY DEFINER zodat het ook lukt als de factuur via een RPC of
-- de service-role ontstaat; hij wijzigt alleen 'lead' → 'actief' van díe klant.
create or replace function public.klant_actief_na_factuur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.clients set status = 'actief' where id = new.client_id and status = 'lead';
  return new;
end;
$$;
revoke all on function public.klant_actief_na_factuur() from public, anon, authenticated;

drop trigger if exists invoices_klant_actief on public.invoices;
create trigger invoices_klant_actief
  after insert or update of client_id on public.invoices
  for each row execute function public.klant_actief_na_factuur();

-- Eenmalig (en onschadelijk bij opnieuw uitvoeren): leads die al facturen hebben.
update public.clients c set status = 'actief'
where c.status = 'lead' and exists (select 1 from public.invoices i where i.client_id = c.id);

-- Korte notities per klant (tijdlijn op de klantpagina). Gedeeld met het team; alleen de
-- schrijver kan zijn notitie verwijderen. Wijzigen kan niet (geen update-policy).
create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  tekst text not null check (length(btrim(tekst)) between 1 and 2000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists client_notes_klant_idx on public.client_notes (client_id, created_at desc);

alter table public.client_notes enable row level security;
drop policy if exists "teamleden lezen klantnotities" on public.client_notes;
create policy "teamleden lezen klantnotities" on public.client_notes
  for select to authenticated using ((select public.is_teamlid()));
drop policy if exists "teamleden schrijven klantnotities" on public.client_notes;
create policy "teamleden schrijven klantnotities" on public.client_notes
  for insert to authenticated
  with check ((select public.is_teamlid()) and created_by = (select auth.uid()));
drop policy if exists "schrijver verwijdert klantnotitie" on public.client_notes;
create policy "schrijver verwijdert klantnotitie" on public.client_notes
  for delete to authenticated
  using ((select public.is_teamlid()) and created_by = (select auth.uid()));
revoke update on public.client_notes from anon, authenticated;

-- Projecten: status gepland / bezig / afgerond (was actief / gearchiveerd), een optionele
-- deadline en een langere notitie. Oude waarden worden omgezet; de app leest beide.
-- Is 0023 (projectstatus voorbereiding/bezig/wachten/afgerond, kolom status_sinds) al
-- uitgevoerd, dan blijven status, check en standaardwaarde van 0023 staan: opnieuw
-- uitvoeren zet de statussen nooit terug.
do $$
declare
  c record;
  na0023 boolean := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'status_sinds'
  );
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.projects'::regclass and contype = 'c'
      and ((not na0023 and pg_get_constraintdef(oid) ilike '%status%') or pg_get_constraintdef(oid) ilike '%notitie%')
  loop
    execute format('alter table public.projects drop constraint %I', c.conname);
  end loop;

  if not na0023 then
    update public.projects set status = 'bezig' where status = 'actief';
    update public.projects set status = 'afgerond' where status = 'gearchiveerd';

    alter table public.projects alter column status set default 'bezig';
    alter table public.projects add constraint projects_status_check check (status in ('gepland', 'bezig', 'afgerond'));
  end if;
end
$$;

alter table public.projects add constraint projects_notitie_check check (length(notitie) <= 5000);
alter table public.projects add column if not exists deadline date;

create index if not exists projects_status_idx on public.projects (status);
-- Klantpagina: taken van een klant (open taken, klantfilter in de agenda).
create index if not exists tasks_client_idx on public.tasks (client_id) where client_id is not null;

-- Eigenaar(s) van een project (wie het trekt). Gedeeld met het team; alleen actieve
-- teamleden kunnen eigenaar zijn. Bestaande projecten krijgen bij de eerste keer hun
-- maker (of de eigenaar van het team) als eigenaar.
do $$
declare
  nieuw boolean := to_regclass('public.project_eigenaren') is null;
begin
  create table if not exists public.project_eigenaren (
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (project_id, user_id)
  );
  if nieuw then
    insert into public.project_eigenaren (project_id, user_id)
    select p.id, coalesce(p.created_by, public.team_eigenaar())
    from public.projects p
    where coalesce(p.created_by, public.team_eigenaar()) is not null
    on conflict do nothing;
  end if;
end
$$;
create index if not exists project_eigenaren_user_idx on public.project_eigenaren (user_id);

alter table public.project_eigenaren enable row level security;
drop policy if exists "teamleden lezen projecteigenaren" on public.project_eigenaren;
create policy "teamleden lezen projecteigenaren" on public.project_eigenaren
  for select to authenticated using ((select public.is_teamlid()));
drop policy if exists "teamleden kiezen projecteigenaren" on public.project_eigenaren;
create policy "teamleden kiezen projecteigenaren" on public.project_eigenaren
  for insert to authenticated
  with check ((select public.is_teamlid()) and public.is_actief_teamlid(user_id));
drop policy if exists "teamleden halen projecteigenaren weg" on public.project_eigenaren;
create policy "teamleden halen projecteigenaren weg" on public.project_eigenaren
  for delete to authenticated using ((select public.is_teamlid()));
revoke update on public.project_eigenaren from anon, authenticated;

-- ---------------------------------------------------------------------------------
-- Stap 4. Snelheid
-- ---------------------------------------------------------------------------------
-- De tellers van de takenlijst (Vandaag, Te laat, Gepland, Ooit, Uitgezet) in één query
-- i.p.v. vijf. SECURITY INVOKER: de leesregels hierboven gelden gewoon; je telt alleen wat
-- je mag zien. "Mijn" = ik sta erop (task_assignees); "uitgezet" = ik maakte hem en sta er
-- zelf niet op — dezelfde regels als de lijsten in de app (lib/agenda/repo.ts).
create or replace function public.taak_tellingen(p_vandaag date, p_project uuid default null, p_klant uuid default null)
returns table (vandaag integer, telaat integer, gepland integer, ooit integer, uitgezet integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (count(*) filter (where x.mijn and x.due_date <= p_vandaag))::integer,
    (count(*) filter (where x.mijn and x.due_date < p_vandaag))::integer,
    (count(*) filter (where x.mijn and x.due_date > p_vandaag))::integer,
    (count(*) filter (where x.mijn and x.due_date is null))::integer,
    (count(*) filter (where not x.mijn and x.created_by = (select auth.uid())))::integer
  from (
    select t.due_date, t.created_by,
           exists (select 1 from public.task_assignees a
                   where a.task_id = t.id and a.user_id = (select auth.uid())) as mijn
    from public.tasks t
    where t.completed_at is null
      and (p_project is null or t.project_id = p_project)
      and (p_klant is null or t.client_id = p_klant)
  ) x;
$$;
revoke all on function public.taak_tellingen(date, uuid, uuid) from public, anon;
grant execute on function public.taak_tellingen(date, uuid, uuid) to authenticated, service_role;

-- Voortgang per project (open / totaal) met een group by, i.p.v. alle taakrijen naar de
-- app halen. Ook SECURITY INVOKER: projecttaken zijn voor het team leesbaar (stap 2).
create or replace function public.project_taak_tellingen(p_projecten uuid[] default null)
returns table (project_id uuid, open integer, totaal integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.project_id,
         (count(*) filter (where t.completed_at is null))::integer,
         count(*)::integer
  from public.tasks t
  where t.project_id is not null
    and (p_projecten is null or t.project_id = any (p_projecten))
  group by t.project_id;
$$;
revoke all on function public.project_taak_tellingen(uuid[]) from public, anon;
grant execute on function public.project_taak_tellingen(uuid[]) to authenticated, service_role;

-- Indexen (de data is klein; dit houdt het vlot als hij groeit).
-- Agenda en dashboard zoeken op datum, ook in afgeronde taken (de index uit 0018 dekt
-- alleen open taken).
create index if not exists tasks_due_idx on public.tasks (due_date) where due_date is not null;
-- Klantfilter in de agenda / klantpagina.
create index if not exists calendar_events_client_idx on public.calendar_events (client_id) where client_id is not null;
-- Afspraken waar de maker in staat (leesregel stap 2) en Uitgezet voor afgeronde taken.
create index if not exists calendar_events_maker_idx on public.calendar_events (created_by);
create index if not exists tasks_maker_idx on public.tasks (created_by, completed_at);

-- ------------------------------------------------------------------------------
-- 0023_projectstatus.sql
-- ------------------------------------------------------------------------------

-- 0023: projectstatussen voor het projectenbord. Idempotent: twee keer uitvoeren geeft
-- geen fout. Alleen projects verandert; RLS (is_teamlid) blijft zoals in 0021/0022 en de
-- facturen worden niet aangeraakt. Vereist 0022.
--
--   - status voorbereiding / bezig / wachten (op goedkeuring) / afgerond; bestaande
--     'gepland' wordt 'voorbereiding' (en oude 'actief'/'gearchiveerd', mocht er nog iets
--     staan, 'bezig'/'afgerond'). Nieuwe projecten standaard 'voorbereiding'.
--   - status_sinds: wanneer de status voor het laatst veranderde (gevuld met updated_at),
--     bijgehouden door een trigger. Voor "12 dagen in deze status" en "afgerond, laatste
--     30 dagen" op het bord.
--   - index voor het bord (status + status_sinds) en voor deadlines.
--
-- De app werkt vóór en na deze migratie: vóór 0023 schrijft hij 'gepland' voor
-- Voorbereiding en is "Wachten op goedkeuring" nog niet te kiezen.

-- Sinds wanneer in deze status. Bestaande projecten: hun laatste wijziging (vóór het
-- omzetten hieronder, dat updated_at bijwerkt).
alter table public.projects add column if not exists status_sinds timestamptz;
update public.projects set status_sinds = coalesce(updated_at, created_at, now()) where status_sinds is null;
alter table public.projects alter column status_sinds set default now();
alter table public.projects alter column status_sinds set not null;

-- Status: eerst de oude check weg, dan omzetten, dan de nieuwe check.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.projects'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) not ilike '%voorbereiding%'
  loop
    execute format('alter table public.projects drop constraint %I', c.conname);
  end loop;
end
$$;

update public.projects set status = 'voorbereiding' where status = 'gepland';
update public.projects set status = 'bezig' where status = 'actief';
update public.projects set status = 'afgerond' where status = 'gearchiveerd';

alter table public.projects alter column status set default 'voorbereiding';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass and conname = 'projects_status_check'
  ) then
    alter table public.projects add constraint projects_status_check
      check (status in ('voorbereiding', 'bezig', 'wachten', 'afgerond'));
  end if;
end
$$;

-- Trigger: bij elke statuswijziging status_sinds op nu (de app hoeft daar niets voor te
-- doen; een meegestuurde waarde wordt genegeerd zodat de tijdlijn klopt).
create or replace function public.projects_status_sinds()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status_sinds := now();
  elsif new.status is distinct from old.status then
    new.status_sinds := now();
  else
    new.status_sinds := old.status_sinds;
  end if;
  return new;
end
$$;
revoke all on function public.projects_status_sinds() from public, anon, authenticated;

drop trigger if exists projects_status_sinds on public.projects;
create trigger projects_status_sinds
  before insert or update on public.projects
  for each row execute function public.projects_status_sinds();

-- Het bord haalt alles in één keer op (kleine tabel); deze indexen houden de tellers op
-- het dashboard en "afgerond, laatste 30 dagen" vlot als de lijst groeit.
create index if not exists projects_status_sinds_idx on public.projects (status, status_sinds desc);
create index if not exists projects_deadline_idx on public.projects (deadline) where deadline is not null;

-- ------------------------------------------------------------------------------
-- 0024_drive.sql
-- ------------------------------------------------------------------------------

-- 0024: Google Drive als gezamenlijke bestandsopslag (module Bestanden). Idempotent: twee
-- keer uitvoeren geeft geen fout. Alleen nieuwe tabellen; facturen, klanten en projecten
-- veranderen niet. Vereist 0021 (is_teamlid, projects) en 0022.
--
--   drive_koppeling  de ene koppeling met het Google-account van Studio Levant: e-mailadres,
--                    versleuteld refresh token (AES-256-GCM, door de server) en de id van de
--                    rootmap "Studio Levant". GEEN policies en geen rechten voor anon/
--                    authenticated: alleen de server (service-role) leest en schrijft hem.
--   drive_mappen     cache van map-id's (Boekhouding/Facturen/2026, de map van een klant of
--                    project, …), per rootmap; zo hoeft de server niet steeds te zoeken.
--                    Teamleden lezen; alleen de server schrijft (een id hierin geldt als
--                    "binnen de rootmap").
--   drive_bestanden  wie een bestand via het dashboard uploadde (en bij welke klant/project).
--   drive_kopieen    welke factuur, prijsopgave of welk bonnetje al naar Drive is gekopieerd
--                    (en van welk PDF-pad), zodat kopiëren idempotent is.
-- Alle tabellen behalve drive_koppeling: alleen actieve teamleden (is_teamlid()); in
-- drive_mappen en drive_kopieen schrijft alleen de server.

-- ---------------------------------------------------------------------------------
-- 1. De koppeling (één rij)
-- ---------------------------------------------------------------------------------
create table if not exists public.drive_koppeling (
  id smallint primary key default 1 check (id = 1),
  google_email text not null default '' check (length(google_email) <= 320),
  refresh_token_enc text not null check (refresh_token_enc like 'v1:%'),
  root_id text not null check (length(root_id) between 1 and 200),
  scope text not null default '' check (length(scope) <= 1000),
  gekoppeld_door uuid references auth.users (id) on delete set null,
  gekoppeld_op timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists drive_koppeling_set_updated_at on public.drive_koppeling;
create trigger drive_koppeling_set_updated_at
  before update on public.drive_koppeling
  for each row execute function public.set_updated_at();

alter table public.drive_koppeling enable row level security;
-- Bewust geen enkele policy; en ook geen tabelrechten voor de app-rollen.
revoke all on public.drive_koppeling from anon, authenticated;

-- ---------------------------------------------------------------------------------
-- 2. Mappen-cache
-- ---------------------------------------------------------------------------------
--   soort 'pad'      sleutel = het pad onder de root, bv. 'Boekhouding/Facturen/2026'
--   soort 'klant'    sleutel = clients.id
--   soort 'project'  sleutel = projects.id
create table if not exists public.drive_mappen (
  root_id text not null check (length(root_id) between 1 and 200),
  soort text not null check (soort in ('pad', 'klant', 'project')),
  sleutel text not null check (length(sleutel) between 1 and 500),
  drive_id text not null check (length(drive_id) between 1 and 200),
  naam text not null default '' check (length(naam) <= 300),
  ouder_id text check (length(ouder_id) <= 200),
  updated_at timestamptz not null default now(),
  primary key (root_id, soort, sleutel)
);
create index if not exists drive_mappen_drive_idx on public.drive_mappen (drive_id);

alter table public.drive_mappen enable row level security;
drop policy if exists "teamleden beheren drive-mappen" on public.drive_mappen;
drop policy if exists "teamleden lezen drive-mappen" on public.drive_mappen;
create policy "teamleden lezen drive-mappen" on public.drive_mappen
  for select to authenticated
  using ((select public.is_teamlid()));
-- Schrijven doet alleen de server: een map-id in deze tabel geldt als "binnen de root".
revoke insert, update, delete on public.drive_mappen from authenticated;

-- ---------------------------------------------------------------------------------
-- 3. Wie uploadde wat (alleen bestanden die via het dashboard zijn geüpload)
-- ---------------------------------------------------------------------------------
create table if not exists public.drive_bestanden (
  drive_file_id text primary key check (length(drive_file_id) between 1 and 200),
  naam text not null default '' check (length(naam) <= 500),
  geupload_door uuid references auth.users (id) on delete set null default auth.uid(),
  client_id uuid references public.clients (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists drive_bestanden_klant_idx on public.drive_bestanden (client_id);
create index if not exists drive_bestanden_project_idx on public.drive_bestanden (project_id);

alter table public.drive_bestanden enable row level security;
drop policy if exists "teamleden beheren drive-bestanden" on public.drive_bestanden;
create policy "teamleden beheren drive-bestanden" on public.drive_bestanden
  for all to authenticated
  using ((select public.is_teamlid()))
  with check ((select public.is_teamlid()));

-- ---------------------------------------------------------------------------------
-- 4. Wat er al naar Drive is gekopieerd (facturen, prijsopgaven, bonnetjes)
-- ---------------------------------------------------------------------------------
--   bron_id  invoices.id / quotes.id / expense_files.id (bewust zonder foreign key: een
--            verwijderde factuur laat zijn kopie in Drive staan)
--   bron_pad het Storage-pad van de PDF/foto die gekopieerd is; verandert het (factuur
--            bewerkt), dan wordt de kopie in Drive bijgewerkt.
create table if not exists public.drive_kopieen (
  root_id text not null check (length(root_id) between 1 and 200),
  bron text not null check (bron in ('factuur', 'prijsopgave', 'bonnetje')),
  bron_id uuid not null,
  bron_pad text not null default '' check (length(bron_pad) <= 500),
  drive_file_id text not null check (length(drive_file_id) between 1 and 200),
  gekopieerd_op timestamptz not null default now(),
  primary key (root_id, bron, bron_id)
);

alter table public.drive_kopieen enable row level security;
drop policy if exists "teamleden lezen drive-kopieen" on public.drive_kopieen;
create policy "teamleden lezen drive-kopieen" on public.drive_kopieen
  for select to authenticated
  using ((select public.is_teamlid()));
-- Schrijven doet alleen de server (service-role, na de teamlidcontrole).
revoke insert, update, delete on public.drive_kopieen from authenticated;

-- Anon heeft in public niets (0021); voor de zekerheid ook hier expliciet.
revoke all on public.drive_mappen, public.drive_bestanden, public.drive_kopieen from anon;

-- ------------------------------------------------------------------------------
-- 0025_crm_opvolging.sql
-- ------------------------------------------------------------------------------

-- 0025: opvolgen van leads en klanten. Idempotent: twee keer uitvoeren geeft geen fout.
-- Alleen toevoegen; RLS blijft zoals in 0021/0022 (is_teamlid) en de facturen-functionaliteit
-- (tabellen invoices/quotes, RPC's) wordt niet aangeraakt. Vereist 0022.
--
--   - clients.volgende_stap: korte tekst "wat is de volgende stap" (max. 200 tekens);
--   - clients.opvolgen_op:   datum waarop je de klant/lead opvolgt (voor "vandaag/te laat"
--                            in het klantenoverzicht en de dashboardkaart "Opvolgen");
--   - client_notes.soort:    'notitie' (zelf geschreven) of 'status' (automatisch bij een
--                            statuswijziging, bv. "Lead → Actief"), voor de tijdlijn op de
--                            klantpagina. Bestaande notities worden 'notitie'.
--   - index voor de opvolglijst.
--
-- De app werkt vóór en na deze migratie: vóór 0025 zijn "volgende stap" en "opvolgen op"
-- verborgen en worden statuswijzigingen niet in de tijdlijn gezet.

alter table public.clients add column if not exists volgende_stap text;
alter table public.clients add column if not exists opvolgen_op date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clients'::regclass and conname = 'clients_volgende_stap_lengte'
  ) then
    alter table public.clients add constraint clients_volgende_stap_lengte
      check (volgende_stap is null or length(volgende_stap) <= 200);
  end if;
end
$$;

alter table public.client_notes add column if not exists soort text not null default 'notitie';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_notes'::regclass and conname = 'client_notes_soort_check'
  ) then
    alter table public.client_notes add constraint client_notes_soort_check
      check (soort in ('notitie', 'status'));
  end if;
end
$$;

-- Opvolglijst (dashboard, tab Leads): alleen klanten met een opvolgdatum.
create index if not exists clients_opvolgen_idx on public.clients (opvolgen_op) where opvolgen_op is not null;

commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen zijn.
notify pgrst, 'reload schema';

-- Controle: elke regel hoort "ok" te tonen (en daaronder: wie er toegang heeft).
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
  ('bucket uitgaven-export',  exists (select 1 from storage.buckets where id = 'uitgaven-export' and not public)),
  ('tabel team_members',      to_regclass('public.team_members') is not null),
  ('tabel profiles',          to_regclass('public.profiles') is not null),
  ('tabel projects',          to_regclass('public.projects') is not null),
  ('tabel task_assignees',    to_regclass('public.task_assignees') is not null),
  ('tabel task_subtasks',     to_regclass('public.task_subtasks') is not null),
  ('tabel event_attendees',   to_regclass('public.event_attendees') is not null),
  ('tabel user_mailboxes',    to_regclass('public.user_mailboxes') is not null),
  ('functie is_teamlid',      to_regprocedure('public.is_teamlid()') is not null),
  ('functie taak_aanmaken',   to_regprocedure('public.taak_aanmaken(jsonb)') is not null),
  ('RLS aan op alle tabellen', not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity)),
  ('minstens één actief teamlid', exists (select 1 from public.team_members where actief)),
  ('aantal actieve teamleden: ' || (select count(*) from public.team_members where actief) || ' (zie hieronder wie)', true),
  ('minstens één eigenaar',   exists (select 1 from public.team_members where actief and rol = 'eigenaar')),
  ('elke taak heeft iemand',  not exists (select 1 from public.tasks t where not exists (select 1 from public.task_assignees a where a.task_id = t.id))),
  ('geen open policies (public)', not exists (select 1 from pg_policies where schemaname = 'public' and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'auth\.uid\(\)( AS uid\))? IS NOT NULL')),
  ('geen open policies (storage)', not exists (select 1 from pg_policies where schemaname = 'storage' and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'auth\.uid\(\)( AS uid\))? IS NOT NULL')),
  ('elke policy vereist teamlid', not exists (select 1 from pg_policies where schemaname in ('public', 'storage') and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ '(is_teamlid|taak_betrokken|afspraak_betrokken)\(')),
  ('storage alleen teamleden', not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(invoices|social-assets)' and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'is_teamlid')),
  ('factuurfuncties dicht voor app-rollen', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('create_invoice', 'update_invoice', 'social_restore_latest') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))),
  ('anon leest geen facturen', not has_table_privilege('anon', 'public.invoices', 'select')),
  ('user_mailboxes zonder policies', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_mailboxes')),
  ('geen openbare buckets',   not exists (select 1 from storage.buckets where public)),
  ('kolom profiles.welkom_klaar_op', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'welkom_klaar_op')),
  ('eigenaren slaan de welkomstflow over', not exists (select 1 from public.team_members m join public.profiles p on p.id = m.user_id where m.rol = 'eigenaar' and p.welkom_klaar_op is null)),
  ('functie taak_zichtbaar',  to_regprocedure('public.taak_zichtbaar(uuid)') is not null),
  ('taken alleen voor betrokkenen', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'betrokkenen lezen taken')),
  ('afspraken alleen voor betrokkenen', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_events' and policyname = 'betrokkenen lezen afspraken')),
  ('geen open leesregels voor taken', not exists (select 1 from pg_policies where schemaname = 'public' and policyname in ('teamleden lezen taken', 'teamleden lezen toewijzingen', 'teamleden lezen subtaken', 'teamleden lezen afspraken', 'teamleden lezen deelnemers'))),
  ('kolommen clients (email, telefoon, status)', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name in ('email', 'telefoon', 'status')) = 3),
  ('tabel client_notes',      to_regclass('public.client_notes') is not null),
  ('tabel project_eigenaren', to_regclass('public.project_eigenaren') is not null),
  ('kolom projects.deadline', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'deadline')),
  ('projectstatus omgezet',   not exists (select 1 from public.projects where status not in ('gepland', 'voorbereiding', 'bezig', 'wachten', 'afgerond'))),
  ('functie taak_tellingen',  to_regprocedure('public.taak_tellingen(date,uuid,uuid)') is not null),
  ('functie project_taak_tellingen', to_regprocedure('public.project_taak_tellingen(uuid[])') is not null),
  ('tellingen dicht voor anon', not has_function_privilege('anon', 'public.taak_tellingen(date,uuid,uuid)', 'execute')),
  ('indexen 0022',            (select count(*) from pg_class where relname in ('tasks_maker_open_idx', 'clients_status_idx', 'client_notes_klant_idx', 'projects_status_idx', 'tasks_client_idx', 'project_eigenaren_user_idx', 'tasks_due_idx', 'calendar_events_client_idx', 'calendar_events_maker_idx', 'tasks_maker_idx')) = 10),
  ('projectstatus voorbereiding/bezig/wachten/afgerond', not exists (select 1 from public.projects where status not in ('voorbereiding', 'bezig', 'wachten', 'afgerond'))),
  ('nieuwe projecten standaard voorbereiding', (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'status') like '%voorbereiding%'),
  ('check op projectstatus', exists (select 1 from pg_constraint where conrelid = 'public.projects'::regclass and conname = 'projects_status_check' and pg_get_constraintdef(oid) ilike '%wachten%')),
  ('kolom projects.status_sinds', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'status_sinds' and is_nullable = 'NO')),
  ('trigger status_sinds',    exists (select 1 from pg_trigger where tgname = 'projects_status_sinds' and tgrelid = 'public.projects'::regclass)),
  ('RLS projects ongewijzigd (teamlid)', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'is_teamlid\(')),
  ('indexen 0023',            (select count(*) from pg_class where relname in ('projects_status_sinds_idx', 'projects_deadline_idx')) = 2),
  ('tabel drive_koppeling',   to_regclass('public.drive_koppeling') is not null),
  ('tabel drive_mappen',      to_regclass('public.drive_mappen') is not null),
  ('tabel drive_bestanden',   to_regclass('public.drive_bestanden') is not null),
  ('tabel drive_kopieen',     to_regclass('public.drive_kopieen') is not null),
  ('RLS op de drive-tabellen', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('drive_koppeling', 'drive_mappen', 'drive_bestanden', 'drive_kopieen') and relrowsecurity) = 4),
  ('drive_koppeling zonder policies', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drive_koppeling')),
  ('drive_koppeling onleesbaar voor de app', not has_table_privilege('authenticated', 'public.drive_koppeling', 'select') and not has_table_privilege('anon', 'public.drive_koppeling', 'select')),
  ('drive-tabellen alleen voor teamleden', (select count(*) from pg_policies where schemaname = 'public' and tablename in ('drive_mappen', 'drive_bestanden', 'drive_kopieen') and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'is_teamlid\(') = 3),
  ('drive_mappen en drive_kopieen alleen door de server te schrijven', not has_table_privilege('authenticated', 'public.drive_kopieen', 'insert') and not has_table_privilege('authenticated', 'public.drive_mappen', 'insert')),
  ('kolommen clients.volgende_stap en opvolgen_op', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name in ('volgende_stap', 'opvolgen_op')) = 2),
  ('check volgende stap max. 200 tekens', exists (select 1 from pg_constraint where conrelid = 'public.clients'::regclass and conname = 'clients_volgende_stap_lengte')),
  ('kolom client_notes.soort', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_notes' and column_name = 'soort' and is_nullable = 'NO')),
  ('check notitiesoort notitie/status', exists (select 1 from pg_constraint where conrelid = 'public.client_notes'::regclass and conname = 'client_notes_soort_check')),
  ('index opvolgen', exists (select 1 from pg_class where relname = 'clients_opvolgen_idx')),
  ('RLS clients en client_notes ongewijzigd (teamlid)', not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('clients', 'client_notes') and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'is_teamlid\('))
) as c(onderdeel, aanwezig)
union all
select 'teamlid: ' || coalesce(p.naam, '?') || ' <' || coalesce(p.email, '?') || '> (' || m.rol || ')',
       case when m.actief then 'actief' else 'gedeactiveerd' end
from public.team_members m
left join public.profiles p on p.id = m.user_id;
