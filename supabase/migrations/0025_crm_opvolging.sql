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
