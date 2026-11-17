-- ============================================================================
-- Studio Levant-backoffice — terugkerende facturen, klantbeschrijving en bewerkbare
-- tijdlijnnotities (migratie 0036)
-- ============================================================================
--
-- Klanten: een kolom beschrijving (vrije tekst, ook bij leads en "Op de radar").
--
-- Tijdlijn: zelf geschreven notities (soort 'notitie') zijn te bewerken door elk teamlid;
-- de automatische statusregels ('Lead → Actief') niet. bewerkt_op toont "bewerkt".
--
-- Terugkerende facturen (bv. een onderhoudspakket): een sjabloon met klant, regels en btw,
-- een interval (maand/kwartaal/jaar) en een dag van de maand. De dagelijkse cron
-- (/api/cron/dagelijks) maakt de factuur op die dag aan met het eerstvolgende factuurnummer
-- en verstuurt hem desgewenst per e-mail.
--
--   terugkerende_facturen     het sjabloon. RLS aan, GEEN policies: alleen de server
--                             (service-role) leest en schrijft, na de teamlidcontrole.
--   invoices.terugkerend_id   van welk sjabloon een factuur komt, met de periode
--   invoices.terugkerend_periode  (de geplande datum). Uniek per sjabloon en periode,
--                             zodat een periode nooit twee keer gefactureerd wordt.
--   invoices.verzonden_op / verzonden_aan  wanneer en naar wie hij gemaild is.
--
-- Veilig om opnieuw uit te voeren. Vereist 0022 (client_notes) en 0025 (soort).

-- ---------- klanten: beschrijving ----------
alter table public.clients add column if not exists beschrijving text;
alter table public.clients drop constraint if exists clients_beschrijving_lengte;
alter table public.clients add constraint clients_beschrijving_lengte
  check (beschrijving is null or char_length(beschrijving) <= 5000);

-- ---------- tijdlijn: notities bewerken ----------
alter table public.client_notes add column if not exists bewerkt_op timestamptz;
grant update (tekst, bewerkt_op) on public.client_notes to authenticated;
drop policy if exists "teamleden bewerken klantnotities" on public.client_notes;
create policy "teamleden bewerken klantnotities" on public.client_notes
  for update to authenticated
  using ((select public.is_teamlid()) and soort = 'notitie')
  with check ((select public.is_teamlid()) and soort = 'notitie');

-- ---------- terugkerende facturen ----------
create table if not exists public.terugkerende_facturen (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  naam text not null check (char_length(btrim(naam)) between 1 and 200),
  -- [{ beschrijving, midden, totaal (getal, excl. btw), teltMeeInOmzet }]
  regels jsonb not null default '[]'::jsonb check (jsonb_typeof(regels) = 'array'),
  midden_kolom_label text not null default '' check (char_length(midden_kolom_label) <= 100),
  btw_verlegd boolean not null default false,
  btw_verlegd_als text not null default 'verlegd' check (btw_verlegd_als in ('verlegd', 'nvt')),
  btw_verlegd_reden text not null default '' check (char_length(btw_verlegd_reden) <= 500),
  interval text not null default 'maand' check (interval in ('maand', 'kwartaal', 'jaar')),
  dag smallint not null default 1 check (dag between 1 and 28),
  volgende_datum date not null,
  eind_datum date,
  actief boolean not null default true,
  -- E-mail (optioneel): versturen = false → alleen aanmaken.
  versturen boolean not null default false,
  email_aan text not null default '' check (char_length(email_aan) <= 1000),
  email_cc text not null default '' check (char_length(email_cc) <= 1000),
  -- id van een inbox uit public.mailboxen, of 'env' (de standaard-mailbox).
  mailbox_id text not null default '' check (char_length(mailbox_id) <= 100),
  onderwerp text not null default '' check (char_length(onderwerp) <= 300),
  bericht text not null default '' check (char_length(bericht) <= 5000),
  laatst_uitgevoerd_op timestamptz,
  -- Bewust zonder foreign key: invoices verwijst al naar deze tabel (terugkerend_id), en
  -- zonder kringverwijzing kan de back-up hem gewoon vóór invoices herstellen.
  laatste_factuur_id uuid,
  laatste_fout text check (laatste_fout is null or char_length(laatste_fout) <= 1000),
  aangemaakt_door uuid references auth.users (id) on delete set null,
  aangemaakt_op timestamptz not null default now(),
  gewijzigd_op timestamptz not null default now()
);
create index if not exists terugkerende_facturen_gepland_idx
  on public.terugkerende_facturen (volgende_datum) where actief;

alter table public.terugkerende_facturen enable row level security;
revoke all on public.terugkerende_facturen from anon, authenticated;

alter table public.invoices add column if not exists terugkerend_id uuid
  references public.terugkerende_facturen (id) on delete set null;
alter table public.invoices add column if not exists terugkerend_periode date;
alter table public.invoices add column if not exists verzonden_op timestamptz;
alter table public.invoices add column if not exists verzonden_aan text;
create unique index if not exists invoices_terugkerend_periode_uniek
  on public.invoices (terugkerend_id, terugkerend_periode)
  where terugkerend_id is not null;
