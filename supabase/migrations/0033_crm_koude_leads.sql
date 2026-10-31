-- ============================================================================
-- Studio Levant-backoffice — "Op de radar" (koude leads) bij Klanten (migratie 0033)
-- ============================================================================
--
-- Naast 'lead' (iemand die we gesproken hebben of binnenkort benaderen) komt de status
-- 'koud', in de app "Op de radar": een bedrijf dat we niet willen vergeten en misschien
-- ooit benaderen. Op de radar telt niet mee voor de dashboardkaart "Opvolgen" (dat filter
-- zit in de app) en heeft een eigen tab in het klantenoverzicht.
--
--   - clients.status: check-constraint met 'koud' erbij (koud / lead / actief / afgerond);
--   - de factuur-trigger (0022) zet nu ook 'koud' → 'actief' zodra er een factuur voor de
--     klant bestaat (en eenmalig: koude leads die al facturen hebben).
--
-- Alleen de constraint en de triggerfunctie veranderen; RLS (is_teamlid, 0021) en de
-- facturen-functionaliteit blijven ongemoeid. De app werkt vóór en na deze migratie: vóór
-- 0033 geeft "Op de radar" kiezen een nette melding. Vereist 0022. Veilig om opnieuw uit
-- te voeren.

-- Status: de oude check (zonder 'koud') weg, dan de nieuwe. De naam van de oude check is
-- automatisch gegeven (clients_status_check), daarom zoeken op de inhoud.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.clients'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%''lead''%'
      and pg_get_constraintdef(oid) not ilike '%''koud''%'
  loop
    execute format('alter table public.clients drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clients'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%''koud''%'
  ) then
    alter table public.clients add constraint clients_status_check
      check (status in ('koud', 'lead', 'actief', 'afgerond'));
  end if;
end
$$;

-- Een lead of koude lead met een factuur is een actieve klant (zelfde trigger als 0022,
-- alleen 'koud' erbij). SECURITY DEFINER zodat het ook lukt als de factuur via een RPC of
-- de service-role ontstaat; hij wijzigt alleen 'lead'/'koud' → 'actief' van díe klant.
create or replace function public.klant_actief_na_factuur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.clients set status = 'actief' where id = new.client_id and status in ('lead', 'koud');
  return new;
end;
$$;
revoke all on function public.klant_actief_na_factuur() from public, anon, authenticated;

drop trigger if exists invoices_klant_actief on public.invoices;
create trigger invoices_klant_actief
  after insert or update of client_id on public.invoices
  for each row execute function public.klant_actief_na_factuur();

-- Eenmalig (en onschadelijk bij opnieuw uitvoeren): (koude) leads die al facturen hebben.
update public.clients c set status = 'actief'
where c.status in ('lead', 'koud') and exists (select 1 from public.invoices i where i.client_id = c.id);

notify pgrst, 'reload schema';
