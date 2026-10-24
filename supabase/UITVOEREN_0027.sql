-- ============================================================================
-- Studio Levant-backoffice — boekhouding (migratie 0027)
-- ============================================================================
--
-- Wat dit doet (alleen toevoegen; facturen en bonnetjes blijven ongewijzigd):
--   - bk_rekeningen       bankrekeningen: RegioBank (standaard) en Revolut, later meer
--   - bk_boekingen        alles wat er op de rekening gebeurt, in regels: datum, omschrijving,
--                         uitgave/inkomst/privé/overboeking/btw, bedrag (centen), btw-code en
--                         btw; kwartaal automatisch. Niet te verwijderen (bewaarplicht), wel
--                         te markeren als verwijderd.
--   - bk_grootboek        standaard rekeningschema (categorieën) met indicatieve RGS-codes
--   - bk_vennoten         Daniel en Bram (VOF), standaard 50/50
--   - bk_activa           investeringen met lineaire afschrijving (vrije termijn)
--   - bk_memoriaal(+regels) beginbalans, correcties en jaarafsluiting (moet sluiten)
--   - bk_koppelingen, bk_bron_extra  betalingen afletteren en facturen/bonnetjes verfijnen
--                         zonder invoices/expenses te wijzigen
--   - bk_aangiften, bk_boekjaren     ingediende aangifte = kwartaal vergrendeld; afgesloten
--                         boekjaar = jaar vergrendeld (intrekken alleen door de eigenaar)
--   - bk_imports          bankafschriften (CSV) die zijn ingelezen
-- Alles alleen voor actieve teamleden (is_teamlid() met 2FA uit 0026), gedeeld met het team.
-- De nieuwe tabellen komen automatisch in de dagelijkse back-up (backup_tabellen()).
--
-- Vereist 0026. Tot dit bestand is uitgevoerd, draait de boekhouding in de app in de
-- demo-modus (voorbeeldgegevens, er wordt niets opgeslagen).
--
-- Zo voer je het uit:
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan: elke regel moet "ok" tonen (de laatste "boekhouding:"-regel is informatief),
--      en daaronder staat wie er toegang heeft.
--
-- Veilig om nogmaals uit te voeren; alles draait in één transactie (gaat er iets mis, dan
-- wordt niets half doorgevoerd). Aangepaste instellingen, rekeningen, vennoten en alle
-- boekingen blijven staan.
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/0027_boekhouding.sql.
-- Niet met de hand aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

-- ------------------------------------------------------------------------------
-- 0027_boekhouding.sql
-- ------------------------------------------------------------------------------

-- 0027 — Boekhouding: bankrekeningen, boekingsregels, grootboek, vennoten, activa,
-- memoriaal, btw-aangiften (vergrendeling) en boekjaren.
--
-- Alleen toevoegingen; de facturen (invoices, quotes, clients) en bonnetjes (expenses)
-- veranderen NIET. De boekhouding leest die alleen en bewaart koppelingen en
-- verfijningen in eigen tabellen (bk_koppelingen, bk_bron_extra).
--
-- Idempotent: create table/index if not exists, drop policy/trigger if exists + create,
-- create or replace function en seeds met on conflict do nothing (opnieuw uitvoeren
-- overschrijft niets wat de gebruiker heeft aangepast).
--
-- Bedragen: bigint in hele centen (nooit floats). Datums: date (kalenderdag NL).
-- Toegang: alle bk_*-tabellen alleen voor actieve teamleden (is_teamlid(), met 2FA/aal2 uit
-- 0026); de boekhouding is gedeeld met het team. Een ingediende aangifte of een afgesloten
-- boekjaar intrekken kan alleen de eigenaar. anon heeft nergens rechten.
--
-- Vergrendeling: een rij in bk_aangiften (ingediend) vergrendelt dat kwartaal, een rij in
-- bk_boekjaren (afgesloten) het jaar. Triggers weigeren dan wijzigingen in die periode met
-- een fout die begint met 'periode_vergrendeld:' (de app vertaalt die). Herstel uit een
-- back-up (service-role) slaat deze controles over.
--
-- Bewaarplicht (7 jaar, art. 52 AWR): boekingsregels worden niet echt verwijderd maar
-- gemarkeerd (verwijderd_op/-door/-reden); er is geen delete-policy op bk_boekingen.

-- ---------------------------------------------------------------------------------
-- Hulpfuncties
-- ---------------------------------------------------------------------------------
-- updated_at + updated_by (wie het laatst wijzigde) voor de bk-tabellen.
create or replace function public.bk_bijgewerkt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.updated_by = coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

-- Herstel uit een back-up (service-role) en beheer als postgres slaan de controles over.
create or replace function public.bk_systeemrol()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('postgres', 'service_role', 'supabase_admin');
$$;

-- ---------------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------------
create table if not exists public.bk_instellingen (
  id smallint primary key default 1 check (id = 1),
  bedrijfsnaam text not null default 'Studio Levant' check (length(bedrijfsnaam) between 1 and 200),
  rechtsvorm text not null default 'vof' check (rechtsvorm in ('vof', 'eenmanszaak', 'bv', 'maatschap')),
  kvk text check (kvk ~ '^[0-9]{8}$'),
  btw_nummer text check (btw_nummer ~ '^NL[0-9]{9}B[0-9]{2}$'),
  startdatum date,
  kor boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bk_grootboek (
  code text primary key check (code ~ '^[0-9]{4}$'),
  naam text not null check (length(naam) between 1 and 120),
  soort text not null check (soort in ('activa', 'passiva', 'eigen_vermogen', 'opbrengst', 'kosten')),
  rubriek text not null default 'overig' check (length(rubriek) <= 40),
  rgs_code text check (length(rgs_code) <= 40),
  btw_standaard text check (btw_standaard in ('21', '9', '0', 'geen', 'verlegd_nl', 'eu_dienst', 'buiten_eu')),
  hint text check (length(hint) <= 200),
  systeem boolean not null default false,
  actief boolean not null default true,
  volgorde integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bk_rekeningen (
  id uuid primary key default gen_random_uuid(),
  naam text not null check (length(naam) between 1 and 80),
  iban text check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$'),
  grootboek_code text not null unique references public.bk_grootboek (code),
  standaard boolean not null default false,
  import_formaat text not null default 'generiek' check (import_formaat in ('regiobank', 'revolut', 'generiek')),
  import_mapping jsonb check (import_mapping is null or jsonb_typeof(import_mapping) = 'object'),
  beginsaldo_centen bigint not null default 0 check (abs(beginsaldo_centen) <= 9999999999),
  beginsaldo_datum date,
  actief boolean not null default true,
  volgorde integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index if not exists bk_rekeningen_een_standaard on public.bk_rekeningen ((true)) where standaard;
create unique index if not exists bk_rekeningen_naam on public.bk_rekeningen (lower(naam));

create table if not exists public.bk_vennoten (
  id uuid primary key default gen_random_uuid(),
  naam text not null unique check (length(naam) between 1 and 80),
  user_id uuid references auth.users (id) on delete set null,
  winstaandeel numeric(5,2) not null default 50 check (winstaandeel >= 0 and winstaandeel <= 100),
  grootboek_kapitaal text not null references public.bk_grootboek (code),
  grootboek_prive text not null references public.bk_grootboek (code),
  actief boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bk_imports (
  id uuid primary key default gen_random_uuid(),
  rekening_id uuid not null references public.bk_rekeningen (id),
  bestandsnaam text check (length(bestandsnaam) <= 200),
  formaat text not null check (formaat in ('regiobank', 'revolut', 'generiek')),
  aantal_nieuw integer not null default 0 check (aantal_nieuw >= 0),
  aantal_dubbel integer not null default 0 check (aantal_dubbel >= 0),
  periode_van date,
  periode_tot date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.bk_boekingen (
  id uuid primary key default gen_random_uuid(),
  rekening_id uuid references public.bk_rekeningen (id),
  datum date not null check (datum >= date '2000-01-01'),
  omschrijving text not null check (length(omschrijving) between 1 and 200),
  tegenpartij text check (length(tegenpartij) <= 200),
  tegenrekening text check (length(tegenrekening) <= 64),
  soort text not null check (soort in ('uitgave', 'inkomst', 'prive', 'overboeking', 'btw')),
  richting text not null check (richting in ('af', 'bij')),
  bedrag_centen bigint not null check (bedrag_centen > 0 and bedrag_centen <= 9999999999),
  bedrag_is_excl boolean not null default false,
  btw_code text not null default '21' check (btw_code in ('21', '9', '0', 'geen', 'verlegd_nl', 'eu_dienst', 'buiten_eu')),
  btw_centen bigint not null default 0 check (btw_centen >= 0 and btw_centen <= 9999999999),
  btw_handmatig boolean not null default false,
  grootboek_code text references public.bk_grootboek (code),
  vennoot_id uuid references public.bk_vennoten (id),
  status text not null default 'geboekt' check (status in ('te_verwerken', 'geboekt')),
  import_id uuid references public.bk_imports (id) on delete set null,
  import_sleutel text check (length(import_sleutel) <= 128),
  kenmerk text check (length(kenmerk) <= 120),
  notities text check (length(notities) <= 2000),
  jaar smallint generated always as (extract(year from datum)::smallint) stored,
  kwartaal smallint generated always as (extract(quarter from datum)::smallint) stored,
  verwijderd_op timestamptz,
  verwijderd_door uuid,
  verwijder_reden text check (length(verwijder_reden) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint bk_boekingen_prive_vennoot check (soort <> 'prive' or vennoot_id is not null),
  constraint bk_boekingen_zonder_btw check (soort not in ('prive', 'overboeking', 'btw') or (btw_code = 'geen' and btw_centen = 0)),
  constraint bk_boekingen_verwijderd check ((verwijderd_op is null) = (verwijder_reden is null))
);
create index if not exists bk_boekingen_rekening_datum on public.bk_boekingen (rekening_id, datum desc);
create index if not exists bk_boekingen_periode on public.bk_boekingen (jaar, kwartaal);
create index if not exists bk_boekingen_status on public.bk_boekingen (status) where verwijderd_op is null;
create unique index if not exists bk_boekingen_import_sleutel on public.bk_boekingen (rekening_id, import_sleutel) where import_sleutel is not null;

-- Koppelingen (afletteren): een bankregel ↔ factuur, bonnetje, aangifte of andere boeking.
-- Bewust geen foreign key naar invoices/expenses: een verwijderde factuur laat dan een
-- "verweesde" koppeling achter die de app markeert.
create table if not exists public.bk_koppelingen (
  id uuid primary key default gen_random_uuid(),
  boeking_id uuid not null references public.bk_boekingen (id) on delete cascade,
  bron text not null check (bron in ('factuur', 'uitgave', 'aangifte', 'boeking')),
  bron_id uuid not null,
  bedrag_centen bigint not null check (bedrag_centen <> 0 and abs(bedrag_centen) <= 9999999999),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (boeking_id, bron, bron_id)
);
create index if not exists bk_koppelingen_bron on public.bk_koppelingen (bron, bron_id);

create table if not exists public.bk_activa (
  id uuid primary key default gen_random_uuid(),
  omschrijving text not null check (length(omschrijving) between 1 and 200),
  categorie_grootboek text not null references public.bk_grootboek (code),
  aanschafdatum date not null,
  ingebruikname date not null,
  aanschaf_centen bigint not null check (aanschaf_centen > 0 and aanschaf_centen <= 9999999999),
  restwaarde_centen bigint not null default 0 check (restwaarde_centen >= 0),
  looptijd_maanden integer not null check (looptijd_maanden between 12 and 240),
  methode text not null default 'lineair' check (methode = 'lineair'),
  uitgave_id uuid,
  boeking_id uuid references public.bk_boekingen (id) on delete set null,
  desinvestering_datum date,
  desinvestering_centen bigint check (desinvestering_centen >= 0),
  notities text check (length(notities) <= 2000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint bk_activa_restwaarde check (restwaarde_centen < aanschaf_centen),
  constraint bk_activa_volgorde check (ingebruikname >= aanschafdatum),
  constraint bk_activa_desinvestering check (desinvestering_datum is null or desinvestering_datum >= ingebruikname)
);

-- Boekhoudkundige verfijning van een factuur of bonnetje ZONDER invoices/expenses te
-- wijzigen: andere btw-rubriek (bv. verlegd → 3b), categorie, vennoot of activum.
create table if not exists public.bk_bron_extra (
  bron text not null check (bron in ('factuur', 'uitgave')),
  bron_id uuid not null,
  btw_code text check (btw_code in ('21', '9', '0', 'geen', 'verlegd_nl', 'eu_dienst', 'buiten_eu')),
  grootboek_code text references public.bk_grootboek (code),
  vennoot_id uuid references public.bk_vennoten (id),
  activum_id uuid references public.bk_activa (id) on delete set null,
  notitie text check (length(notitie) <= 2000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (bron, bron_id)
);

create table if not exists public.bk_memoriaal (
  id uuid primary key default gen_random_uuid(),
  datum date not null,
  omschrijving text not null check (length(omschrijving) between 1 and 200),
  soort text not null default 'correctie' check (soort in ('beginbalans', 'correctie', 'jaarafsluiting')),
  jaar smallint generated always as (extract(year from datum)::smallint) stored,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bk_memoriaal_regels (
  id uuid primary key default gen_random_uuid(),
  memoriaal_id uuid not null references public.bk_memoriaal (id) on delete cascade,
  grootboek_code text not null references public.bk_grootboek (code),
  debet_centen bigint not null default 0 check (debet_centen >= 0 and debet_centen <= 9999999999),
  credit_centen bigint not null default 0 check (credit_centen >= 0 and credit_centen <= 9999999999),
  vennoot_id uuid references public.bk_vennoten (id),
  btw_rubriek text check (btw_rubriek in ('1a', '1b', '1c', '1d', '1e', '2a', '3a', '3b', '3c', '4a', '4b', '5b')),
  omschrijving text check (length(omschrijving) <= 200),
  constraint bk_memoriaal_regel_een_kant check ((debet_centen > 0) <> (credit_centen > 0))
);
create index if not exists bk_memoriaal_regels_memoriaal on public.bk_memoriaal_regels (memoriaal_id);

-- Een rij = de aangifte over dat kwartaal is ingediend (en het kwartaal is vergrendeld).
create table if not exists public.bk_aangiften (
  id uuid primary key default gen_random_uuid(),
  jaar smallint not null check (jaar between 2000 and 2999),
  kwartaal smallint not null check (kwartaal between 1 and 4),
  status text not null default 'ingediend' check (status = 'ingediend'),
  rubrieken jsonb not null default '{}'::jsonb check (jsonb_typeof(rubrieken) = 'object'),
  te_betalen_centen bigint not null default 0,
  ingediend_op timestamptz not null default now(),
  ingediend_door uuid default auth.uid(),
  kenmerk text check (length(kenmerk) <= 120),
  opmerking text check (length(opmerking) <= 2000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (jaar, kwartaal)
);

create table if not exists public.bk_boekjaren (
  jaar smallint primary key check (jaar between 2000 and 2999),
  status text not null default 'afgesloten' check (status = 'afgesloten'),
  afgesloten_op timestamptz not null default now(),
  afgesloten_door uuid default auth.uid(),
  memoriaal_id uuid references public.bk_memoriaal (id) on delete set null,
  samenvatting jsonb not null default '{}'::jsonb check (jsonb_typeof(samenvatting) = 'object'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------
-- updated_at / updated_by
-- ---------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['bk_instellingen', 'bk_grootboek', 'bk_rekeningen', 'bk_vennoten', 'bk_boekingen', 'bk_activa',
                           'bk_bron_extra', 'bk_memoriaal', 'bk_aangiften', 'bk_boekjaren'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_bijgewerkt', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.bk_bijgewerkt()', t || '_bijgewerkt', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------
-- Vergrendeling van periodes
-- ---------------------------------------------------------------------------------
create or replace function public.bk_periode_open(d date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select d is null or (
    not exists (
      select 1 from public.bk_aangiften a
      where a.jaar = extract(year from d)::int and a.kwartaal = extract(quarter from d)::int
    )
    and not exists (select 1 from public.bk_boekjaren j where j.jaar = extract(year from d)::int)
  );
$$;

create or replace function public.bk_weiger_periode(d date)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'periode_vergrendeld: ' || to_char(d, 'YYYY-MM-DD'),
    hint = 'De btw-aangifte over dit kwartaal is ingediend of het boekjaar is afgesloten.';
end;
$$;

-- Boekingsregels: nieuw/verwijderen alleen in een open periode; wijzigen van de
-- financiële velden (datum, bank, soort, richting, bedrag, btw, categorie, vennoot,
-- verwijderd) alleen als oud én nieuw open zijn. Omschrijving, notities, status en
-- tegenpartij mogen altijd (bv. na het afletteren).
create or replace function public.bk_boekingen_periode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.bk_systeemrol() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if not public.bk_periode_open(new.datum) then perform public.bk_weiger_periode(new.datum); end if;
    return new;
  elsif tg_op = 'DELETE' then
    if not public.bk_periode_open(old.datum) then perform public.bk_weiger_periode(old.datum); end if;
    return old;
  end if;
  if (new.datum, new.rekening_id, new.soort, new.richting, new.bedrag_centen, new.bedrag_is_excl, new.btw_code,
      new.btw_centen, new.grootboek_code, new.vennoot_id, new.verwijderd_op)
     is distinct from
     (old.datum, old.rekening_id, old.soort, old.richting, old.bedrag_centen, old.bedrag_is_excl, old.btw_code,
      old.btw_centen, old.grootboek_code, old.vennoot_id, old.verwijderd_op) then
    if not public.bk_periode_open(old.datum) then perform public.bk_weiger_periode(old.datum); end if;
    if not public.bk_periode_open(new.datum) then perform public.bk_weiger_periode(new.datum); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bk_boekingen_periode on public.bk_boekingen;
create trigger bk_boekingen_periode
  before insert or update or delete on public.bk_boekingen
  for each row execute function public.bk_boekingen_periode();

-- Memoriaal: alleen in een open periode, behalve de jaarafsluiting op 31-12 van het jaar dat
-- wordt afgesloten (die wordt geboekt vóór de rij in bk_boekjaren bestaat, maar in een
-- kwartaal waarvan de aangifte al is ingediend).
create or replace function public.bk_memoriaal_periode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  oud_open boolean;
  nieuw_open boolean;
begin
  if public.bk_systeemrol() then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    oud_open := public.bk_periode_open(old.datum)
      or (old.soort = 'jaarafsluiting' and not exists (select 1 from public.bk_boekjaren j where j.jaar = extract(year from old.datum)::int));
    if not oud_open then perform public.bk_weiger_periode(old.datum); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.soort = 'jaarafsluiting' and not coalesce(public.is_eigenaar(), false) then
      raise exception using errcode = 'P0001', message = 'geen_eigenaar: alleen de eigenaar boekt een jaarafsluiting';
    end if;
    nieuw_open := public.bk_periode_open(new.datum)
      or (new.soort = 'jaarafsluiting' and to_char(new.datum, 'MM-DD') = '12-31'
          and not exists (select 1 from public.bk_boekjaren j where j.jaar = extract(year from new.datum)::int));
    if not nieuw_open then perform public.bk_weiger_periode(new.datum); end if;
    return new;
  end if;
  return old;
end;
$$;
drop trigger if exists bk_memoriaal_periode on public.bk_memoriaal;
create trigger bk_memoriaal_periode
  before insert or update or delete on public.bk_memoriaal
  for each row execute function public.bk_memoriaal_periode();

create or replace function public.bk_memoriaal_regels_periode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m record;
begin
  if public.bk_systeemrol() then
    return coalesce(new, old);
  end if;
  select datum, soort into m from public.bk_memoriaal where id = coalesce(new.memoriaal_id, old.memoriaal_id);
  if found and not public.bk_periode_open(m.datum)
     and not (m.soort = 'jaarafsluiting' and not exists (select 1 from public.bk_boekjaren j where j.jaar = extract(year from m.datum)::int)) then
    perform public.bk_weiger_periode(m.datum);
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists bk_memoriaal_regels_periode on public.bk_memoriaal_regels;
create trigger bk_memoriaal_regels_periode
  before insert or update or delete on public.bk_memoriaal_regels
  for each row execute function public.bk_memoriaal_regels_periode();

-- Een memoriaalpost moet sluiten (som debet = som credit), gecontroleerd aan het einde van
-- de transactie (zo kun je eerst alle regels invoegen).
create or replace function public.bk_memoriaal_sluit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  mid uuid := coalesce(new.memoriaal_id, old.memoriaal_id);
  verschil bigint;
begin
  if public.bk_systeemrol() then
    return null;
  end if;
  if not exists (select 1 from public.bk_memoriaal where id = mid) then
    return null;
  end if;
  select coalesce(sum(debet_centen), 0) - coalesce(sum(credit_centen), 0) into verschil
  from public.bk_memoriaal_regels where memoriaal_id = mid;
  if verschil <> 0 then
    raise exception using errcode = 'P0001', message = 'memoriaal_sluit_niet: verschil ' || verschil || ' cent';
  end if;
  return null;
end;
$$;
drop trigger if exists bk_memoriaal_sluit on public.bk_memoriaal_regels;
create constraint trigger bk_memoriaal_sluit
  after insert or update or delete on public.bk_memoriaal_regels
  deferrable initially deferred
  for each row execute function public.bk_memoriaal_sluit();

-- Activa: in een afgesloten boekjaar liggen de afschrijvingen vast. Aanschaf, restwaarde,
-- looptijd en ingebruikname wijzigen of het activum verwijderen kan dan niet meer.
create or replace function public.bk_activa_periode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.bk_systeemrol() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.bk_boekjaren j where j.jaar >= extract(year from new.ingebruikname)::int) then
      perform public.bk_weiger_periode(new.ingebruikname);
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' or (new.aanschaf_centen, new.restwaarde_centen, new.looptijd_maanden, new.ingebruikname, new.categorie_grootboek)
     is distinct from (old.aanschaf_centen, old.restwaarde_centen, old.looptijd_maanden, old.ingebruikname, old.categorie_grootboek) then
    if exists (select 1 from public.bk_boekjaren j where j.jaar >= extract(year from least(old.ingebruikname, coalesce(new.ingebruikname, old.ingebruikname)))::int) then
      perform public.bk_weiger_periode(old.ingebruikname);
    end if;
  end if;
  if tg_op = 'UPDATE' and new.desinvestering_datum is distinct from old.desinvestering_datum then
    if not public.bk_periode_open(coalesce(new.desinvestering_datum, old.desinvestering_datum)) then
      perform public.bk_weiger_periode(coalesce(new.desinvestering_datum, old.desinvestering_datum));
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists bk_activa_periode on public.bk_activa;
create trigger bk_activa_periode
  before insert or update or delete on public.bk_activa
  for each row execute function public.bk_activa_periode();

-- Grootboek: systeemrekeningen en rekeningen die in gebruik zijn niet verwijderen; de code
-- van een systeemrekening niet wijzigen.
create or replace function public.bk_grootboek_bewaken()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.bk_systeemrol() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.systeem then
      raise exception using errcode = 'P0001', message = 'grootboek_systeem: ' || old.code;
    end if;
    if exists (select 1 from public.bk_boekingen where grootboek_code = old.code)
       or exists (select 1 from public.bk_memoriaal_regels where grootboek_code = old.code)
       or exists (select 1 from public.bk_rekeningen where grootboek_code = old.code) then
      raise exception using errcode = 'P0001', message = 'grootboek_in_gebruik: ' || old.code;
    end if;
    return old;
  end if;
  if old.systeem and (new.code <> old.code or new.soort <> old.soort or not new.systeem) then
    raise exception using errcode = 'P0001', message = 'grootboek_systeem: ' || old.code;
  end if;
  return new;
end;
$$;
drop trigger if exists bk_grootboek_bewaken on public.bk_grootboek;
create trigger bk_grootboek_bewaken
  before update or delete on public.bk_grootboek
  for each row execute function public.bk_grootboek_bewaken();

-- Koppelingen (afletteren): een gekoppelde bankregel telt niet meer zelf voor de btw (die komt
-- uit de factuur of het bonnetje). (Ont)koppelen in een vergrendeld kwartaal mag daarom alleen
-- als de regel zelf geen btw-effect heeft (btw-code 'geen'); in een afgesloten boekjaar nooit.
-- Een factuur hoort bij een inkomst, een bonnetje bij een uitgave, een (ingediende) btw-aangifte
-- bij een bankregel van de soort btw.
create or replace function public.bk_koppelingen_controle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  b record;
begin
  if public.bk_systeemrol() then
    return coalesce(new, old);
  end if;
  select datum, soort, btw_code, verwijderd_op into b from public.bk_boekingen where id = coalesce(new.boeking_id, old.boeking_id);
  if not found then
    return coalesce(new, old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if b.verwijderd_op is not null then
      raise exception using errcode = 'P0001', message = 'koppeling_ongeldig: de boeking is verwijderd';
    end if;
    if (new.bron = 'factuur' and b.soort <> 'inkomst') or (new.bron = 'uitgave' and b.soort <> 'uitgave')
       or (new.bron = 'aangifte' and b.soort <> 'btw') then
      raise exception using errcode = 'P0001', message = 'koppeling_ongeldig: soort past niet bij het document';
    end if;
    -- Een btw-betaling hoort bij een ingediende aangifte.
    if new.bron = 'aangifte' and not exists (select 1 from public.bk_aangiften a where a.id = new.bron_id) then
      raise exception using errcode = 'P0001', message = 'koppeling_ongeldig: de aangifte bestaat niet';
    end if;
  end if;
  if not public.bk_periode_open(b.datum)
     and (exists (select 1 from public.bk_boekjaren j where j.jaar = extract(year from b.datum)::int)
          or (b.soort in ('inkomst', 'uitgave') and b.btw_code <> 'geen')) then
    perform public.bk_weiger_periode(b.datum);
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists bk_koppelingen_controle on public.bk_koppelingen;
create trigger bk_koppelingen_controle
  before insert or update or delete on public.bk_koppelingen
  for each row execute function public.bk_koppelingen_controle();

-- Verfijning van een factuur/bonnetje (btw-code, categorie, vennoot) verandert de btw en het
-- resultaat van die periode: alleen in een open periode (datum van het document; de factuur-
-- of bonnetjestabel wordt alleen gelezen).
create or replace function public.bk_bron_extra_periode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bron text := coalesce(new.bron, old.bron);
  v_id uuid := coalesce(new.bron_id, old.bron_id);
  d date;
begin
  if public.bk_systeemrol() then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and (new.btw_code, new.grootboek_code, new.vennoot_id, new.bron, new.bron_id)
     is not distinct from (old.btw_code, old.grootboek_code, old.vennoot_id, old.bron, old.bron_id) then
    return new; -- alleen de notitie of het activum
  end if;
  if v_bron = 'factuur' then
    select (i.issued_at at time zone 'Europe/Amsterdam')::date into d from public.invoices i where i.id = v_id;
  else
    select e.expense_date into d from public.expenses e where e.id = v_id;
  end if;
  if d is not null and not public.bk_periode_open(d) then
    perform public.bk_weiger_periode(d);
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists bk_bron_extra_periode on public.bk_bron_extra;
create trigger bk_bron_extra_periode
  before insert or update or delete on public.bk_bron_extra
  for each row execute function public.bk_bron_extra_periode();

-- Bankafschrift importeren in één transactie: een rij in bk_imports en de nieuwe regels
-- (status 'te_verwerken'). Regels met een importsleutel die al bestaat voor deze rekening
-- worden overgeslagen (dubbel). Geeft {import_id, nieuw, dubbel}. Draait als het teamlid
-- (security invoker): RLS en de periodecontrole gelden gewoon.
create or replace function public.bk_importeer(
  p_rekening uuid,
  p_bestandsnaam text,
  p_formaat text,
  p_regels jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_import uuid;
  v_totaal integer;
  v_nieuw integer;
begin
  if not public.is_teamlid() then
    raise exception using errcode = '42501', message = 'geen toegang';
  end if;
  if jsonb_typeof(p_regels) <> 'array' or jsonb_array_length(p_regels) > 5000 then
    raise exception using errcode = '22023', message = 'ongeldige regels';
  end if;
  if not exists (select 1 from public.bk_rekeningen where id = p_rekening and actief) then
    raise exception using errcode = 'P0001', message = 'rekening_onbekend';
  end if;
  v_totaal := jsonb_array_length(p_regels);
  insert into public.bk_imports (rekening_id, bestandsnaam, formaat, periode_van, periode_tot)
  select p_rekening, left(p_bestandsnaam, 200), p_formaat, min((x->>'datum')::date), max((x->>'datum')::date)
  from jsonb_array_elements(p_regels) x
  returning id into v_import;

  insert into public.bk_boekingen (rekening_id, datum, omschrijving, tegenpartij, tegenrekening, soort, richting,
                                   bedrag_centen, bedrag_is_excl, btw_code, btw_centen, btw_handmatig, grootboek_code,
                                   vennoot_id, status, import_id, import_sleutel, kenmerk)
  select p_rekening, (x->>'datum')::date, x->>'omschrijving', nullif(x->>'tegenpartij', ''), nullif(x->>'tegenrekening', ''),
         x->>'soort', x->>'richting', (x->>'bedrag_centen')::bigint, false, x->>'btw_code', (x->>'btw_centen')::bigint, false,
         nullif(x->>'grootboek_code', ''), nullif(x->>'vennoot_id', '')::uuid, 'te_verwerken', v_import, x->>'import_sleutel',
         nullif(x->>'kenmerk', '')
  from jsonb_array_elements(p_regels) x
  on conflict (rekening_id, import_sleutel) where import_sleutel is not null do nothing;
  get diagnostics v_nieuw = row_count;

  update public.bk_imports set aantal_nieuw = v_nieuw, aantal_dubbel = v_totaal - v_nieuw where id = v_import;
  return jsonb_build_object('import_id', v_import, 'nieuw', v_nieuw, 'dubbel', v_totaal - v_nieuw);
end;
$$;

-- Een rekening toevoegen = ook een eigen grootboekrekening (11xx) in één transactie.
create or replace function public.bk_rekening_toevoegen(
  p_naam text,
  p_iban text default null,
  p_formaat text default 'generiek',
  p_beginsaldo bigint default 0,
  p_begindatum date default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text;
  v_id uuid;
begin
  if not public.is_teamlid() then
    raise exception using errcode = '42501', message = 'geen toegang';
  end if;
  select c into v_code
  from (select lpad((1100 + 10 * g)::text, 4, '0') as c from generate_series(0, 9) g) x
  where not exists (select 1 from public.bk_grootboek where code = x.c)
  order by c
  limit 1;
  if v_code is null then
    raise exception using errcode = 'P0001', message = 'geen_vrije_rekening: maximaal 10 bankrekeningen';
  end if;
  insert into public.bk_grootboek (code, naam, soort, rubriek, rgs_code, systeem, volgorde)
  values (v_code, left('Bank ' || p_naam, 120), 'activa', 'liquide_middelen', 'BLim', false, v_code::int);
  insert into public.bk_rekeningen (naam, iban, grootboek_code, import_formaat, beginsaldo_centen, beginsaldo_datum, volgorde)
  values (p_naam, nullif(p_iban, ''), v_code, coalesce(p_formaat, 'generiek'), coalesce(p_beginsaldo, 0), p_begindatum,
          (select coalesce(max(volgorde), 0) + 1 from public.bk_rekeningen))
  returning id into v_id;
  return v_id;
end;
$$;

-- De standaardrekening wisselen (eerst uitzetten, dan aanzetten; één transactie).
create or replace function public.bk_standaard_rekening(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_teamlid() then
    raise exception using errcode = '42501', message = 'geen toegang';
  end if;
  if not exists (select 1 from public.bk_rekeningen where id = p_id and actief) then
    raise exception using errcode = 'P0001', message = 'rekening_onbekend';
  end if;
  update public.bk_rekeningen set standaard = false where standaard and id <> p_id;
  update public.bk_rekeningen set standaard = true where id = p_id and not standaard;
end;
$$;

-- ---------------------------------------------------------------------------------
-- Memoriaal en jaarafsluiting (stap 4)
-- ---------------------------------------------------------------------------------
-- Een memoriaalpost (beginbalans of correctie) met al zijn regels in één transactie. De
-- deferred trigger bk_memoriaal_sluit controleert aan het einde dat de post sluit; de
-- periodetriggers dat de datum in een open periode valt. Een jaarafsluiting gaat alleen via
-- bk_jaar_afsluiten. p_regels: [{grootboek_code, debet_centen, credit_centen, vennoot_id?}].
create or replace function public.bk_memoriaal_toevoegen(
  p_datum date,
  p_omschrijving text,
  p_soort text,
  p_regels jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_teamlid() then
    raise exception using errcode = '42501', message = 'geen toegang';
  end if;
  if p_soort not in ('beginbalans', 'correctie') then
    raise exception using errcode = '22023', message = 'ongeldige soort';
  end if;
  if jsonb_typeof(p_regels) <> 'array' or jsonb_array_length(p_regels) < 2 or jsonb_array_length(p_regels) > 200 then
    raise exception using errcode = '22023', message = 'ongeldige regels';
  end if;
  insert into public.bk_memoriaal (datum, omschrijving, soort) values (p_datum, p_omschrijving, p_soort) returning id into v_id;
  insert into public.bk_memoriaal_regels (memoriaal_id, grootboek_code, debet_centen, credit_centen, vennoot_id, omschrijving)
  select v_id, x->>'grootboek_code', coalesce((x->>'debet_centen')::bigint, 0), coalesce((x->>'credit_centen')::bigint, 0),
         nullif(x->>'vennoot_id', '')::uuid, nullif(left(x->>'omschrijving', 200), '')
  from jsonb_array_elements(p_regels) x;
  return v_id;
end;
$$;

-- Boekjaar afsluiten (alleen de eigenaar): de afsluitpost op 31-12 (resultaat en privé naar de
-- kapitaalrekeningen van de vennoten) en de rij in bk_boekjaren (= het jaar is vergrendeld), in
-- één transactie. De app berekent de regels en controleert de checklist vooraf.
create or replace function public.bk_jaar_afsluiten(
  p_jaar integer,
  p_omschrijving text,
  p_regels jsonb,
  p_samenvatting jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (public.is_teamlid() and public.is_eigenaar()) then
    raise exception using errcode = 'P0001', message = 'geen_eigenaar: alleen de eigenaar sluit een boekjaar af';
  end if;
  if exists (select 1 from public.bk_boekjaren where jaar = p_jaar) then
    raise exception using errcode = '23505', message = 'boekjaar al afgesloten';
  end if;
  if exists (select 1 from public.bk_boekjaren where jaar > p_jaar) then
    raise exception using errcode = 'P0001', message = 'jaar_volgorde: een later jaar is al afgesloten';
  end if;
  if jsonb_typeof(p_regels) <> 'array' or jsonb_array_length(p_regels) > 500 then
    raise exception using errcode = '22023', message = 'ongeldige regels';
  end if;
  if jsonb_array_length(p_regels) > 0 then
    insert into public.bk_memoriaal (datum, omschrijving, soort)
    values (make_date(p_jaar, 12, 31), coalesce(nullif(left(p_omschrijving, 200), ''), 'Jaarafsluiting ' || p_jaar), 'jaarafsluiting')
    returning id into v_id;
    insert into public.bk_memoriaal_regels (memoriaal_id, grootboek_code, debet_centen, credit_centen, vennoot_id, omschrijving)
    select v_id, x->>'grootboek_code', coalesce((x->>'debet_centen')::bigint, 0), coalesce((x->>'credit_centen')::bigint, 0),
           nullif(x->>'vennoot_id', '')::uuid, nullif(left(x->>'omschrijving', 200), '')
    from jsonb_array_elements(p_regels) x;
  end if;
  insert into public.bk_boekjaren (jaar, memoriaal_id, samenvatting)
  values (p_jaar, v_id, coalesce(p_samenvatting, '{}'::jsonb));
  return v_id;
end;
$$;

-- Boekjaar heropenen (alleen de eigenaar; niet als een later jaar al is afgesloten): de rij in
-- bk_boekjaren en de afsluitpost verdwijnen, het jaar is weer open.
create or replace function public.bk_jaar_heropenen(p_jaar integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (public.is_teamlid() and public.is_eigenaar()) then
    raise exception using errcode = 'P0001', message = 'geen_eigenaar: alleen de eigenaar heropent een boekjaar';
  end if;
  if exists (select 1 from public.bk_boekjaren where jaar > p_jaar) then
    raise exception using errcode = 'P0001', message = 'jaar_volgorde: heropen eerst het latere jaar';
  end if;
  delete from public.bk_boekjaren where jaar = p_jaar;
  if not found then
    raise exception using errcode = 'P0001', message = 'jaar_onbekend: dit boekjaar is niet afgesloten';
  end if;
  delete from public.bk_memoriaal where soort = 'jaarafsluiting' and jaar = p_jaar;
end;
$$;

-- Winstverdeling: alle aandelen in één keer (de actieve vennoten moeten samen 100% hebben).
-- Alleen de eigenaar (ook de policy op bk_vennoten).
create or replace function public.bk_vennoten_aandelen(p_aandelen jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_som numeric;
begin
  if not (public.is_teamlid() and public.is_eigenaar()) then
    raise exception using errcode = 'P0001', message = 'geen_eigenaar: alleen de eigenaar wijzigt de winstverdeling';
  end if;
  if jsonb_typeof(p_aandelen) <> 'array' then
    raise exception using errcode = '22023', message = 'ongeldige aandelen';
  end if;
  update public.bk_vennoten v set winstaandeel = (x->>'aandeel')::numeric
  from jsonb_array_elements(p_aandelen) x
  where v.id = (x->>'id')::uuid and v.winstaandeel is distinct from (x->>'aandeel')::numeric;
  select coalesce(sum(winstaandeel), 0) into v_som from public.bk_vennoten where actief;
  if v_som <> 100 then
    raise exception using errcode = 'P0001', message = 'aandelen_niet_100: samen ' || v_som || '%';
  end if;
end;
$$;

revoke all on function public.bk_memoriaal_toevoegen(date, text, text, jsonb) from public, anon;
revoke all on function public.bk_jaar_afsluiten(integer, text, jsonb, jsonb) from public, anon;
revoke all on function public.bk_jaar_heropenen(integer) from public, anon;
revoke all on function public.bk_vennoten_aandelen(jsonb) from public, anon;
grant execute on function public.bk_memoriaal_toevoegen(date, text, text, jsonb) to authenticated, service_role;
grant execute on function public.bk_jaar_afsluiten(integer, text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.bk_jaar_heropenen(integer) to authenticated, service_role;
grant execute on function public.bk_vennoten_aandelen(jsonb) to authenticated, service_role;

revoke all on function public.bk_periode_open(date) from public, anon;
revoke all on function public.bk_weiger_periode(date) from public, anon;
revoke all on function public.bk_systeemrol() from public, anon;
revoke all on function public.bk_rekening_toevoegen(text, text, text, bigint, date) from public, anon;
revoke all on function public.bk_standaard_rekening(uuid) from public, anon;
revoke all on function public.bk_importeer(uuid, text, text, jsonb) from public, anon;
grant execute on function public.bk_periode_open(date) to authenticated, service_role;
grant execute on function public.bk_weiger_periode(date) to authenticated, service_role;
grant execute on function public.bk_systeemrol() to authenticated, service_role;
grant execute on function public.bk_rekening_toevoegen(text, text, text, bigint, date) to authenticated, service_role;
grant execute on function public.bk_standaard_rekening(uuid) to authenticated, service_role;
grant execute on function public.bk_importeer(uuid, text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- RLS: alleen actieve teamleden (gedeeld met het team). anon heeft geen rechten.
-- ---------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['bk_instellingen', 'bk_grootboek', 'bk_rekeningen', 'bk_vennoten', 'bk_imports', 'bk_boekingen',
                           'bk_koppelingen', 'bk_activa', 'bk_bron_extra', 'bk_memoriaal', 'bk_memoriaal_regels',
                           'bk_aangiften', 'bk_boekjaren'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- Lezen, toevoegen en wijzigen: elk teamlid. Verwijderen: alleen waar dat mag.
do $$
declare
  t text;
begin
  foreach t in array array['bk_instellingen', 'bk_grootboek', 'bk_rekeningen', 'bk_vennoten', 'bk_imports', 'bk_boekingen',
                           'bk_koppelingen', 'bk_activa', 'bk_bron_extra', 'bk_memoriaal', 'bk_memoriaal_regels',
                           'bk_aangiften', 'bk_boekjaren'] loop
    execute format('drop policy if exists "teamleden lezen %s" on public.%I', t, t);
    execute format('create policy "teamleden lezen %s" on public.%I for select to authenticated using ((select public.is_teamlid()))', t, t);
    execute format('drop policy if exists "teamleden voegen toe aan %s" on public.%I', t, t);
    execute format('create policy "teamleden voegen toe aan %s" on public.%I for insert to authenticated with check ((select public.is_teamlid()))', t, t);
    execute format('drop policy if exists "teamleden wijzigen %s" on public.%I', t, t);
    execute format('create policy "teamleden wijzigen %s" on public.%I for update to authenticated using ((select public.is_teamlid())) with check ((select public.is_teamlid()))', t, t);
  end loop;
  -- Echt verwijderen mag bij koppelingen, verfijningen, activa, memoriaal en het grootboek
  -- (triggers bewaken de periode en systeemrekeningen). Boekingsregels nooit (bewaarplicht:
  -- markeren als verwijderd), instellingen/rekeningen/vennoten/imports ook niet (deactiveren).
  foreach t in array array['bk_koppelingen', 'bk_bron_extra', 'bk_activa', 'bk_memoriaal', 'bk_memoriaal_regels', 'bk_grootboek'] loop
    execute format('drop policy if exists "teamleden verwijderen %s" on public.%I', t, t);
    execute format('create policy "teamleden verwijderen %s" on public.%I for delete to authenticated using ((select public.is_teamlid()))', t, t);
  end loop;
  -- Een boekjaar afsluiten en de winstverdeling wijzigen: alleen de eigenaar (de policies voor
  -- elk teamlid hierboven worden vervangen).
  execute 'drop policy if exists "teamleden voegen toe aan bk_boekjaren" on public.bk_boekjaren';
  execute 'drop policy if exists "teamleden wijzigen bk_boekjaren" on public.bk_boekjaren';
  execute 'drop policy if exists "eigenaar sluit af bk_boekjaren" on public.bk_boekjaren';
  execute 'create policy "eigenaar sluit af bk_boekjaren" on public.bk_boekjaren for insert to authenticated with check ((select public.is_teamlid()) and (select public.is_eigenaar()))';
  execute 'drop policy if exists "eigenaar wijzigt bk_boekjaren" on public.bk_boekjaren';
  execute 'create policy "eigenaar wijzigt bk_boekjaren" on public.bk_boekjaren for update to authenticated using ((select public.is_teamlid()) and (select public.is_eigenaar())) with check ((select public.is_teamlid()) and (select public.is_eigenaar()))';
  execute 'drop policy if exists "teamleden wijzigen bk_vennoten" on public.bk_vennoten';
  execute 'drop policy if exists "eigenaar wijzigt bk_vennoten" on public.bk_vennoten';
  execute 'create policy "eigenaar wijzigt bk_vennoten" on public.bk_vennoten for update to authenticated using ((select public.is_teamlid()) and (select public.is_eigenaar())) with check ((select public.is_teamlid()) and (select public.is_eigenaar()))';
  -- Een ingediende aangifte of afgesloten boekjaar intrekken (= ontgrendelen): alleen de eigenaar.
  foreach t in array array['bk_aangiften', 'bk_boekjaren'] loop
    execute format('drop policy if exists "eigenaar trekt in %s" on public.%I', t, t);
    execute format('create policy "eigenaar trekt in %s" on public.%I for delete to authenticated using ((select public.is_teamlid()) and (select public.is_eigenaar()))', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------
-- Seed (alleen als het er nog niet is; opnieuw uitvoeren overschrijft niets)
-- ---------------------------------------------------------------------------------
insert into public.bk_instellingen (id, bedrijfsnaam, rechtsvorm) values (1, 'Studio Levant', 'vof')
on conflict (id) do nothing;

insert into public.bk_grootboek (code, naam, soort, rubriek, rgs_code, btw_standaard, hint, systeem, volgorde) values
  ('0200', 'Inventaris', 'activa', 'vaste_activa', 'BMva', '21', null, true, 200),
  ('0209', 'Cum. afschrijving inventaris', 'activa', 'vaste_activa', 'BMva', null, null, true, 209),
  ('0210', 'Computers & apparatuur', 'activa', 'vaste_activa', 'BMva', '21', null, true, 210),
  ('0219', 'Cum. afschrijving computers', 'activa', 'vaste_activa', 'BMva', null, null, true, 219),
  ('0500', 'Kapitaal Daniel', 'eigen_vermogen', 'eigen_vermogen', 'BEiv', null, null, true, 500),
  ('0510', 'Kapitaal Bram', 'eigen_vermogen', 'eigen_vermogen', 'BEiv', null, null, true, 510),
  ('0600', 'Privé Daniel', 'eigen_vermogen', 'eigen_vermogen', 'BEiv', null, null, true, 600),
  ('0610', 'Privé Bram', 'eigen_vermogen', 'eigen_vermogen', 'BEiv', null, null, true, 610),
  ('0900', 'Beginbalans / onverdeeld resultaat', 'eigen_vermogen', 'eigen_vermogen', 'BEiv', null, null, true, 900),
  ('1000', 'Kas', 'activa', 'liquide_middelen', 'BLim', null, null, true, 1000),
  ('1100', 'Bank RegioBank', 'activa', 'liquide_middelen', 'BLim', null, null, true, 1100),
  ('1110', 'Bank Revolut', 'activa', 'liquide_middelen', 'BLim', null, null, true, 1110),
  ('1300', 'Debiteuren', 'activa', 'vorderingen', 'BVor', null, null, true, 1300),
  ('1500', 'Btw te betalen hoog', 'passiva', 'btw', 'BSch', null, null, true, 1500),
  ('1505', 'Btw te betalen laag', 'passiva', 'btw', 'BSch', null, null, true, 1505),
  ('1510', 'Btw verlegd/import te betalen', 'passiva', 'btw', 'BSch', null, null, true, 1510),
  ('1520', 'Voorbelasting', 'activa', 'btw', 'BVor', null, null, true, 1520),
  ('1530', 'Af te dragen btw (aangifte)', 'passiva', 'btw', 'BSch', null, null, true, 1530),
  ('1600', 'Crediteuren', 'passiva', 'schulden', 'BSch', null, null, true, 1600),
  ('1900', 'Vraagposten', 'activa', 'vorderingen', 'BVor', null, null, true, 1900),
  ('2000', 'Kruisposten', 'activa', 'liquide_middelen', 'BLim', null, null, true, 2000),
  ('4000', 'Software & abonnementen', 'kosten', 'kosten', 'WBed', '21', null, true, 4000),
  ('4010', 'Kleine hardware (< € 450)', 'kosten', 'kosten', 'WBed', '21', null, true, 4010),
  ('4100', 'Kantoor & werkplek', 'kosten', 'kosten', 'WBed', '21', null, true, 4100),
  ('4200', 'Reiskosten', 'kosten', 'kosten', 'WBed', '21', null, true, 4200),
  ('4300', 'Marketing & reclame', 'kosten', 'kosten', 'WBed', '21', null, true, 4300),
  ('4400', 'Representatie', 'kosten', 'kosten', 'WBed', '21', 'Fiscaal beperkt aftrekbaar', true, 4400),
  ('4500', 'Opleiding', 'kosten', 'kosten', 'WBed', '21', null, true, 4500),
  ('4600', 'Uitbesteed werk', 'kosten', 'kosten', 'WBed', '21', null, true, 4600),
  ('4700', 'Telefoon & internet', 'kosten', 'kosten', 'WBed', '21', null, true, 4700),
  ('4750', 'Verzekeringen', 'kosten', 'kosten', 'WBed', 'geen', null, true, 4750),
  ('4800', 'Afschrijvingen', 'kosten', 'afschrijvingen', 'WAfs', null, null, true, 4800),
  ('4900', 'Bankkosten', 'kosten', 'kosten', 'WBed', 'geen', null, true, 4900),
  ('4990', 'Overige kosten', 'kosten', 'kosten', 'WBed', '21', null, true, 4990),
  ('8000', 'Omzet', 'opbrengst', 'omzet', 'WOmz', '21', null, true, 8000),
  ('8010', 'Omzet verlegd / buitenland', 'opbrengst', 'omzet', 'WOmz', 'eu_dienst', null, true, 8010),
  ('8090', 'Doorberekende kosten', 'opbrengst', 'omzet', 'WOmz', '21', null, true, 8090),
  ('8900', 'Overige opbrengsten', 'opbrengst', 'overige_opbrengsten', 'WOvb', '21', null, true, 8900)
on conflict (code) do nothing;

-- Rekeningen: RegioBank (standaard) en Revolut. Alleen als er nog geen rekening met die
-- grootboekrekening is; een eerder gekozen andere standaardrekening blijft staan.
insert into public.bk_rekeningen (naam, grootboek_code, standaard, import_formaat, volgorde)
select 'RegioBank', '1100', not exists (select 1 from public.bk_rekeningen where standaard), 'regiobank', 1
where not exists (select 1 from public.bk_rekeningen where grootboek_code = '1100');
insert into public.bk_rekeningen (naam, grootboek_code, standaard, import_formaat, volgorde)
select 'Revolut', '1110', false, 'revolut', 2
where not exists (select 1 from public.bk_rekeningen where grootboek_code = '1110');

-- Vennoten van de VOF: Daniel en Bram, standaard 50/50 (aan te passen in Instellingen).
insert into public.bk_vennoten (naam, winstaandeel, grootboek_kapitaal, grootboek_prive) values
  ('Daniel', 50, '0500', '0600'),
  ('Bram', 50, '0510', '0610')
on conflict (naam) do nothing;

commit;

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe tabellen en functies zijn.
notify pgrst, 'reload schema';

-- Controle: elke regel hoort "ok" te tonen (en daaronder: wie er toegang heeft).
select onderdeel,
       case when aanwezig then 'ok' else 'ONTBREEKT' end as status
from (values
  ('boekhouding: 13 tabellen', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in ('bk_instellingen', 'bk_grootboek', 'bk_rekeningen', 'bk_vennoten', 'bk_imports', 'bk_boekingen', 'bk_koppelingen', 'bk_activa', 'bk_bron_extra', 'bk_memoriaal', 'bk_memoriaal_regels', 'bk_aangiften', 'bk_boekjaren')) = 13),
  ('boekhouding: RLS aan op alle bk-tabellen', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('bk_instellingen', 'bk_grootboek', 'bk_rekeningen', 'bk_vennoten', 'bk_imports', 'bk_boekingen', 'bk_koppelingen', 'bk_activa', 'bk_bron_extra', 'bk_memoriaal', 'bk_memoriaal_regels', 'bk_aangiften', 'bk_boekjaren') and relrowsecurity) = 13),
  ('boekhouding: elke policy vereist teamlid', exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'bk\_%') and not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'bk\_%' and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'is_teamlid\(')),
  ('boekhouding: anon heeft geen rechten', not exists (select 1 from unnest(array['bk_instellingen', 'bk_grootboek', 'bk_rekeningen', 'bk_vennoten', 'bk_imports', 'bk_boekingen', 'bk_koppelingen', 'bk_activa', 'bk_bron_extra', 'bk_memoriaal', 'bk_memoriaal_regels', 'bk_aangiften', 'bk_boekjaren']) t where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'insert') or has_table_privilege('anon', 'public.' || t, 'update') or has_table_privilege('anon', 'public.' || t, 'delete'))),
  ('boekhouding: boekingsregels niet te verwijderen (bewaarplicht)', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bk_boekingen' and cmd in ('DELETE', 'ALL'))),
  ('boekhouding: aangifte/boekjaar intrekken alleen eigenaar', (select count(*) from pg_policies where schemaname = 'public' and tablename in ('bk_aangiften', 'bk_boekjaren') and cmd = 'DELETE' and qual ~ 'is_eigenaar\(') = 2),
  ('boekhouding: vergrendeltriggers', (select count(*) from pg_trigger where not tgisinternal and tgname in ('bk_boekingen_periode', 'bk_memoriaal_periode', 'bk_memoriaal_regels_periode', 'bk_memoriaal_sluit', 'bk_activa_periode', 'bk_grootboek_bewaken', 'bk_koppelingen_controle', 'bk_bron_extra_periode')) = 8),
  ('boekhouding: functies dicht voor anon', not has_function_privilege('anon', 'public.bk_rekening_toevoegen(text,text,text,bigint,date)', 'execute') and not has_function_privilege('anon', 'public.bk_standaard_rekening(uuid)', 'execute') and not has_function_privilege('anon', 'public.bk_periode_open(date)', 'execute') and not has_function_privilege('anon', 'public.bk_importeer(uuid,text,text,jsonb)', 'execute') and not has_function_privilege('anon', 'public.bk_memoriaal_toevoegen(date,text,text,jsonb)', 'execute') and not has_function_privilege('anon', 'public.bk_jaar_afsluiten(integer,text,jsonb,jsonb)', 'execute') and not has_function_privilege('anon', 'public.bk_jaar_heropenen(integer)', 'execute') and not has_function_privilege('anon', 'public.bk_vennoten_aandelen(jsonb)', 'execute')),
  ('boekhouding: boekjaar afsluiten en winstverdeling alleen eigenaar', (select count(*) from pg_policies where schemaname = 'public' and ((tablename = 'bk_boekjaren' and cmd in ('INSERT', 'UPDATE')) or (tablename = 'bk_vennoten' and cmd = 'UPDATE')) and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'is_eigenaar\(') = 3 and not exists (select 1 from pg_policies where schemaname = 'public' and ((tablename = 'bk_boekjaren' and cmd in ('INSERT', 'UPDATE', 'ALL')) or (tablename = 'bk_vennoten' and cmd in ('UPDATE', 'ALL'))) and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'is_eigenaar\(')),
  ('boekhouding: instellingen (één rij)', (select count(*) from public.bk_instellingen) = 1),
  ('boekhouding: standaardgrootboek', (select count(*) from public.bk_grootboek where systeem) >= 38),
  ('boekhouding: RegioBank en Revolut', exists (select 1 from public.bk_rekeningen where grootboek_code = '1100') and exists (select 1 from public.bk_rekeningen where grootboek_code = '1110')),
  ('boekhouding: precies één standaardrekening', (select count(*) from public.bk_rekeningen where standaard) = 1),
  ('boekhouding: winstaandelen vennoten samen 100%', (select coalesce(sum(winstaandeel), 0) from public.bk_vennoten where actief) = 100),
  ('boekhouding: in de back-up (backup_tabellen)', (select count(*) from public.backup_tabellen() t where t in ('bk_instellingen', 'bk_grootboek', 'bk_rekeningen', 'bk_vennoten', 'bk_imports', 'bk_boekingen', 'bk_koppelingen', 'bk_activa', 'bk_bron_extra', 'bk_memoriaal', 'bk_memoriaal_regels', 'bk_aangiften', 'bk_boekjaren')) = 13),
  ('boekhouding: standaardrekening ' || coalesce((select naam from public.bk_rekeningen where standaard), '?') || ', boekingsregels ' || (select count(*) from public.bk_boekingen where verwijderd_op is null) || ', ingediende aangiften ' || (select count(*) from public.bk_aangiften) || ', afgesloten boekjaren ' || (select count(*) from public.bk_boekjaren), true)
) as c(onderdeel, aanwezig)
union all
select 'teamlid: ' || coalesce(p.naam, '?') || ' <' || coalesce(p.email, '?') || '> (' || m.rol || ')',
       case when m.actief then 'actief' else 'gedeactiveerd' end
from public.team_members m
left join public.profiles p on p.id = m.user_id;
