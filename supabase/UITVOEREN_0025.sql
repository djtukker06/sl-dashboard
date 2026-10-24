-- ============================================================================
-- Studio Levant-backoffice — opvolgen van leads en klanten (migratie 0025)
-- ============================================================================
--
-- Wat dit doet (alleen toevoegen; RLS en de facturen-functionaliteit ongewijzigd):
--   - clients.volgende_stap (korte tekst, max. 200 tekens) en clients.opvolgen_op (datum):
--     voor de tab Leads, "vandaag/te laat" en de dashboardkaart "Opvolgen".
--   - client_notes.soort: 'notitie' (zelf geschreven, alle bestaande notities) of 'status'
--     (automatisch bij een statuswijziging, bv. "Lead → Actief") voor de tijdlijn.
--   - index voor de opvolglijst.
--
-- Vereist 0022 (klanten & projecten). Nog niet uitgevoerd? Gebruik dan het grote
-- UITVOEREN_0021_TEAM.sql (bevat 0021 t/m 0025).
--
-- Zo voer je het uit:
--   1. Supabase-dashboard -> je project -> SQL Editor -> "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Onderaan: elke regel moet "ok" tonen, en daaronder staat wie er toegang heeft.
--
-- Veilig om nogmaals uit te voeren; alles draait in één transactie (gaat er iets mis, dan
-- wordt niets half doorgevoerd). De app werkt vóór en na dit bestand: vóór 0025 zijn
-- "volgende stap" en "opvolgen op" verborgen.
--
-- Gegenereerd met scripts/genereer-sql-editor.mjs uit supabase/migrations/0025_crm_opvolging.sql.
-- Niet met de hand aanpassen; pas de migratie aan en genereer opnieuw.
-- ============================================================================

begin;

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

-- PostgREST (de API van Supabase) direct laten weten dat er nieuwe kolommen zijn.
notify pgrst, 'reload schema';

-- Controle: elke regel hoort "ok" te tonen (en daaronder: wie er toegang heeft).
select onderdeel,
       case when aanwezig then 'ok' else 'ONTBREEKT' end as status
from (values
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
