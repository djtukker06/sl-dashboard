-- ============================================================================
-- Studio Levant-backoffice — herhalende afspraken in de agenda (migratie 0034)
-- ============================================================================
--
-- Een herhalende afspraak is ÉÉN rij in calendar_events met een herhaalregel. starts_at /
-- ends_at zijn die van het eerste voorkomen; de app vouwt de reeks bij het ophalen voor het
-- gevraagde bereik uit tot losse voorkomens (lib/agenda/herhaling.ts, Europe/Amsterdam: een
-- afspraak om 09:00 blijft 09:00, ook na de zomertijdwissel). De agenda-link (ICS) krijgt
-- één VEVENT met een RRULE.
--
--   herhaling               null = eenmalig; anders dagelijks, werkdagen (ma–vr), wekelijks,
--                           tweewekelijks, vierwekelijks, maandelijks (op de 29e–31e in kortere
--                           maanden de laatste dag) of jaarlijks (29 feb → 28 feb)
--   herhaal_tot             laatste dag waarop de reeks nog begint (inclusief); null = geen einde
--   herhaal_uitzonderingen  datums (van het oorspronkelijke voorkomen) die niet meer meedoen:
--                           "alleen deze" verwijderd, of losgemaakt als eigen afspraak
--   herhaal_van             bij zo'n losgemaakte afspraak: de rij van de reeks. Bewust zonder
--                           foreign key (de back-up herstelt rijen in willekeurige volgorde); de
--                           app verwijdert ze mee met de reeks.
--
-- De bestaande RLS van calendar_events (0021/0022) geldt ook voor de nieuwe kolommen.
-- Zolang deze migratie niet is uitgevoerd, werkt de agenda gewoon zonder herhalen.
-- Veilig om opnieuw uit te voeren.

alter table public.calendar_events add column if not exists herhaling text;
alter table public.calendar_events add column if not exists herhaal_tot date;
alter table public.calendar_events add column if not exists herhaal_uitzonderingen date[] not null default '{}';
alter table public.calendar_events add column if not exists herhaal_van uuid;

alter table public.calendar_events drop constraint if exists calendar_events_herhaling_check;
alter table public.calendar_events add constraint calendar_events_herhaling_check
  check (herhaling is null or herhaling in
    ('dagelijks', 'werkdagen', 'wekelijks', 'tweewekelijks', 'vierwekelijks', 'maandelijks', 'jaarlijks'));

alter table public.calendar_events drop constraint if exists calendar_events_herhaal_tot_check;
alter table public.calendar_events add constraint calendar_events_herhaal_tot_check
  check (herhaal_tot is null or (herhaling is not null and herhaal_tot >= (starts_at at time zone 'Europe/Amsterdam')::date));

alter table public.calendar_events drop constraint if exists calendar_events_herhaal_uitzonderingen_check;
alter table public.calendar_events add constraint calendar_events_herhaal_uitzonderingen_check
  check (cardinality(herhaal_uitzonderingen) <= 2000);

-- Een losgemaakt voorkomen herhaalt zelf niet.
alter table public.calendar_events drop constraint if exists calendar_events_herhaal_van_check;
alter table public.calendar_events add constraint calendar_events_herhaal_van_check
  check (herhaal_van is null or herhaling is null);

-- Reeksen worden apart opgehaald (ze kunnen lang vóór het bereik begonnen zijn).
create index if not exists calendar_events_reeks_idx
  on public.calendar_events (starts_at) where herhaling is not null;
create index if not exists calendar_events_herhaal_van_idx
  on public.calendar_events (herhaal_van) where herhaal_van is not null;

notify pgrst, 'reload schema';

-- Controle: alles 'ok'?
select 'kolommen herhalen' as onderdeel,
       case when (select count(*) from information_schema.columns
                  where table_schema = 'public' and table_name = 'calendar_events'
                    and column_name in ('herhaling', 'herhaal_tot', 'herhaal_uitzonderingen', 'herhaal_van')) = 4
            then 'ok' else 'ontbreekt' end as status
union all
select 'regel herhaling',
       case when exists (select 1 from pg_constraint where conname = 'calendar_events_herhaling_check') then 'ok' else 'ontbreekt' end;
