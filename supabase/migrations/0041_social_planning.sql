-- ============================================================================
-- Studio Levant-backoffice — social media management: inplannen, plaatsen en
-- inzichten (migratie 0041)
-- ============================================================================
--
-- De nieuwe Social-module: een overzicht van alle posts (ook concepten), posts inplannen op
-- datum en tijd voor Instagram (zakelijk/maker-account aan een Facebookpagina, via de
-- Instagram Graph API van Meta) en Facebookpagina's, en de cijfers per post en per account.
-- De oude tabellen van de carrousel-generator (social_projects, social_slides,
-- social_versions, social_brand; 0014–0017) en de bucket social-assets blijven staan.
--
--   social_accounts           een gekoppeld Instagram-account of een Facebookpagina, met het
--                             page access token, versleuteld (AES-256-GCM, zoals
--                             google_agenda_accounts in 0035). fout = bv. 'opnieuw_koppelen'.
--   social_posts              één post (concept, ingepland, geplaatst, …) met caption, hashtags,
--                             eerste reactie, locatie, gebruikerstags en collaborators.
--   social_post_kanalen       per post de accounts waar hij heen gaat, met per kanaal de
--                             status, het IG-container-id (reels worden vooraf aangemaakt), het
--                             id en de link van de geplaatste post en de pogingen bij een fout.
--   social_media              de foto's en video's van een post, in de privé-bucket
--                             'social-media' (pad = <post-id>/<bestand>).
--   social_inzichten          de cijfers van een geplaatste post per dag (ook van posts die
--                             buiten het dashboard zijn geplaatst: post_kanaal_id is dan leeg).
--   social_account_inzichten  de cijfers van een account per dag (volgers, bereik, …).
--
-- Alle tabellen: RLS aan, GEEN policies en geen rechten voor anon/authenticated. Alleen de
-- server (service-role) leest en schrijft, na de teamlidcontrole (zoals 0035 en 0036). De
-- bucket is privé en heeft geen policies: uploads gaan met een signed upload-URL
-- rechtstreeks naar Storage, Meta haalt de bestanden op via een kortlevende signed URL.
--
-- Plaatsen gebeurt door /api/cron/social (elke 5 minuten via pg_cron, zie
-- UITVOEREN_0041_cron.sql). Een post wordt geclaimd met een conditionele update
-- (status 'ingepland' → 'bezig'), zodat twee runs tegelijk nooit dubbel plaatsen.
--
-- Veilig om opnieuw uit te voeren.

-- ---------- gekoppelde accounts ----------
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('instagram', 'facebook')),
  -- Instagram: het IG-user-id; Facebook: het page-id.
  extern_id text not null check (char_length(extern_id) between 1 and 100),
  naam text not null default '' check (char_length(naam) <= 200),
  gebruikersnaam text check (gebruikersnaam is null or char_length(gebruikersnaam) <= 100),
  afbeelding_url text check (afbeelding_url is null or char_length(afbeelding_url) <= 2000),
  -- De Facebookpagina waar het IG-account aan hangt, of de pagina zelf.
  page_id text check (page_id is null or char_length(page_id) <= 100),
  -- Page access token, versleuteld. Nooit naar de browser, nooit in logs.
  token_enc text not null,
  token_verloopt_op timestamptz,
  scopes text not null default '' check (char_length(scopes) <= 2000),
  gekoppeld_door uuid references auth.users (id) on delete set null,
  gekoppeld_op timestamptz not null default now(),
  laatst_gesynct_op timestamptz,
  fout text check (fout is null or char_length(fout) <= 300),
  actief boolean not null default true,
  unique (platform, extern_id)
);

-- ---------- posts ----------
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'concept'
    check (status in ('concept', 'ingepland', 'bezig', 'geplaatst', 'deels', 'mislukt')),
  soort text not null default 'foto' check (soort in ('foto', 'carrousel', 'reel', 'tekst')),
  caption text not null default '' check (char_length(caption) <= 2200),
  eerste_reactie text not null default '' check (char_length(eerste_reactie) <= 2200),
  -- Los veld; komt achter de caption of in de eerste reactie (hashtags_plek).
  hashtags text not null default '' check (char_length(hashtags) <= 2200),
  hashtags_plek text not null default 'caption' check (hashtags_plek in ('caption', 'reactie')),
  locatie_id text check (locatie_id is null or char_length(locatie_id) <= 100),
  locatie_naam text check (locatie_naam is null or char_length(locatie_naam) <= 200),
  -- IG user_tags: [{ gebruikersnaam, x, y, media_index }]
  gebruikers_tags jsonb not null default '[]'::jsonb check (jsonb_typeof(gebruikers_tags) = 'array'),
  collaborators text[] not null default '{}' check (cardinality(collaborators) <= 3),
  gepland_op timestamptz,
  geplaatst_op timestamptz,
  notities text not null default '' check (char_length(notities) <= 5000),
  -- 'extern' = buiten het dashboard geplaatst en bij de sync opgehaald.
  bron text not null default 'dashboard' check (bron in ('dashboard', 'extern')),
  aangemaakt_door uuid references auth.users (id) on delete set null,
  aangemaakt_op timestamptz not null default now(),
  gewijzigd_op timestamptz not null default now(),
  -- Inplannen kan alleen met een datum.
  constraint social_posts_ingepland_datum check (status <> 'ingepland' or gepland_op is not null)
);
create index if not exists social_posts_status_gepland_idx on public.social_posts (status, gepland_op);
create index if not exists social_posts_geplaatst_idx on public.social_posts (geplaatst_op desc);

-- ---------- per post de kanalen ----------
create table if not exists public.social_post_kanalen (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts (id) on delete cascade,
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  status text not null default 'concept'
    check (status in ('concept', 'ingepland', 'bezig', 'geplaatst', 'deels', 'mislukt')),
  -- Afwijkende caption voor dit kanaal (leeg = die van de post).
  caption_eigen text check (caption_eigen is null or char_length(caption_eigen) <= 2200),
  -- IG-container (reels: ~10 minuten vóór gepland_op aangemaakt, zodat Meta de video kan verwerken).
  container_id text check (container_id is null or char_length(container_id) <= 100),
  extern_post_id text check (extern_post_id is null or char_length(extern_post_id) <= 100),
  permalink text check (permalink is null or char_length(permalink) <= 2000),
  fout text check (fout is null or char_length(fout) <= 1000),
  pogingen integer not null default 0 check (pogingen >= 0),
  volgende_poging_op timestamptz,
  geplaatst_op timestamptz,
  unique (post_id, account_id)
);
create index if not exists social_post_kanalen_status_idx on public.social_post_kanalen (status, volgende_poging_op);
create index if not exists social_post_kanalen_account_idx on public.social_post_kanalen (account_id);
-- Een geplaatste post komt per account maar één keer voor (sync van externe posts).
create unique index if not exists social_post_kanalen_extern_uniek
  on public.social_post_kanalen (account_id, extern_post_id) where extern_post_id is not null;

-- ---------- media ----------
create table if not exists public.social_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts (id) on delete cascade,
  volgorde integer not null default 0 check (volgorde between 0 and 100),
  -- Pad in de privé-bucket 'social-media': <post-id>/<bestand>.
  pad text not null unique check (char_length(pad) between 1 and 500),
  type text not null check (type in ('afbeelding', 'video')),
  mime text not null default '' check (char_length(mime) <= 100),
  breedte integer check (breedte is null or breedte > 0),
  hoogte integer check (hoogte is null or hoogte > 0),
  duur_sec numeric check (duur_sec is null or duur_sec >= 0),
  alt_tekst text not null default '' check (char_length(alt_tekst) <= 1000),
  grootte bigint check (grootte is null or grootte >= 0),
  aangemaakt_op timestamptz not null default now()
);
create index if not exists social_media_post_idx on public.social_media (post_id, volgorde);

-- ---------- inzichten ----------
create table if not exists public.social_inzichten (
  id uuid primary key default gen_random_uuid(),
  -- Leeg voor posts die buiten het dashboard zijn geplaatst.
  post_kanaal_id uuid references public.social_post_kanalen (id) on delete cascade,
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  extern_post_id text not null check (char_length(extern_post_id) between 1 and 100),
  datum date not null,
  -- { bereik, weergaven, likes, reacties, opslagen, gedeeld, profielbezoeken, volgers_erbij, kijktijd_sec, … }
  cijfers jsonb not null default '{}'::jsonb check (jsonb_typeof(cijfers) = 'object'),
  opgehaald_op timestamptz not null default now(),
  unique (account_id, extern_post_id, datum)
);
create index if not exists social_inzichten_datum_idx on public.social_inzichten (datum);
create index if not exists social_inzichten_kanaal_idx on public.social_inzichten (post_kanaal_id);

create table if not exists public.social_account_inzichten (
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  datum date not null,
  volgers integer,
  bereik integer,
  weergaven integer,
  profielbezoeken integer,
  cijfers jsonb not null default '{}'::jsonb check (jsonb_typeof(cijfers) = 'object'),
  opgehaald_op timestamptz not null default now(),
  primary key (account_id, datum)
);

-- ---------- alleen de server ----------
alter table public.social_accounts enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_kanalen enable row level security;
alter table public.social_media enable row level security;
alter table public.social_inzichten enable row level security;
alter table public.social_account_inzichten enable row level security;

revoke all on public.social_accounts from anon, authenticated;
revoke all on public.social_posts from anon, authenticated;
revoke all on public.social_post_kanalen from anon, authenticated;
revoke all on public.social_media from anon, authenticated;
revoke all on public.social_inzichten from anon, authenticated;
revoke all on public.social_account_inzichten from anon, authenticated;

-- ---------- bucket (privé, geen policies) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', false, 52428800, -- 50 MB
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';

-- Controle: elke regel moet "ok" zijn.
select 'social_accounts' as onderdeel,
       case when to_regclass('public.social_accounts') is not null then 'ok' else 'ontbreekt' end as status
union all
select 'social_posts',
       case when to_regclass('public.social_posts') is not null then 'ok' else 'ontbreekt' end
union all
select 'social_post_kanalen',
       case when to_regclass('public.social_post_kanalen') is not null then 'ok' else 'ontbreekt' end
union all
select 'social_media',
       case when to_regclass('public.social_media') is not null then 'ok' else 'ontbreekt' end
union all
select 'social_inzichten',
       case when to_regclass('public.social_inzichten') is not null then 'ok' else 'ontbreekt' end
union all
select 'social_account_inzichten',
       case when to_regclass('public.social_account_inzichten') is not null then 'ok' else 'ontbreekt' end
union all
select 'social-tabellen: RLS aan',
       case when (select bool_and(relrowsecurity) from pg_class where oid in (
         'public.social_accounts'::regclass, 'public.social_posts'::regclass, 'public.social_post_kanalen'::regclass,
         'public.social_media'::regclass, 'public.social_inzichten'::regclass, 'public.social_account_inzichten'::regclass
       )) then 'ok' else 'uit' end
union all
select 'social-tabellen: geen policies',
       case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename in (
         'social_accounts', 'social_posts', 'social_post_kanalen', 'social_media', 'social_inzichten', 'social_account_inzichten'
       )) then 'ok' else 'open' end
union all
select 'app (authenticated) kan er niet bij',
       case when not has_table_privilege('authenticated', 'public.social_accounts', 'select')
             and not has_table_privilege('authenticated', 'public.social_posts', 'select')
             and not has_table_privilege('anon', 'public.social_posts', 'select') then 'ok' else 'open' end
union all
select 'bucket social-media (privé)',
       case when exists (select 1 from storage.buckets where id = 'social-media' and not public) then 'ok' else 'ontbreekt' end;
