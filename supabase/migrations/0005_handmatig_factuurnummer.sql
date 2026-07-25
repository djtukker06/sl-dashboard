-- Factuurnummers worden voortaan voorgesteld op basis van de hoogste bestaande factuur
-- (verwijder je de laatste factuur, dan komt dat nummer dus weer vrij) en zijn bij het
-- aanmaken handmatig aan te passen.
--
-- invoice_counters verandert daarmee van betekenis: last_number is niet langer een
-- doorlopende teller, maar de ondergrens per jaar — het hoogste factuurnummer dat ooit
-- BUITEN dit systeem om is uitgegeven. Nummers op of onder die grens mogen nooit
-- (her)gebruikt worden; daarboven bepaalt de invoices-tabel zelf wat bezet is.

comment on table public.invoice_counters is
  'Ondergrens per jaar: het hoogste factuurnummer dat buiten dit systeem om is uitgegeven. Nieuwe nummers moeten hierboven liggen.';

-- Terug naar de historische basis van 2026: facturen 001 t/m 007 bestaan op papier
-- (zie 0001_init.sql). De teller is sindsdien meegelopen met aangemaakte facturen,
-- maar die zijn nu allemaal zelf in de invoices-tabel terug te vinden.
update public.invoice_counters set last_number = 7 where year = 2026;

-- De signatuur wijzigt (jaar + volgnummer als parameters), dus de oude functie moet
-- expliciet weg — anders blijven beide varianten naast elkaar bestaan.
drop function if exists public.create_invoice(
  uuid, text, text, text, text, text, jsonb, numeric, numeric, numeric, numeric
);

create or replace function public.create_invoice(
  p_year int,
  p_sequence_number int,
  p_client_id uuid,
  p_client_company_name text,
  p_client_contact_name text,
  p_client_address text,
  p_client_postal_code text,
  p_mid_column_label text,
  p_line_items jsonb,
  p_subtotal numeric,
  p_vat_percentage numeric,
  p_vat_amount numeric,
  p_total numeric
) returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number text := right(p_year::text, 2) || '-' || lpad(p_sequence_number::text, 3, '0');
  v_floor  int;
  v_row    public.invoices;
begin
  if p_sequence_number < 1 or p_sequence_number > 999 then
    raise exception 'Ongeldig volgnummer: %.', p_sequence_number;
  end if;

  select last_number into v_floor from invoice_counters where year = p_year;
  if p_sequence_number <= coalesce(v_floor, 0) then
    raise exception 'Factuurnummer % is al gebruikt buiten dit systeem om.', v_number;
  end if;

  insert into invoices (
    invoice_number, year, sequence_number, client_id,
    client_company_name, client_contact_name, client_address, client_postal_code,
    mid_column_label, line_items, subtotal, vat_percentage, vat_amount, total, created_by
  ) values (
    v_number, p_year, p_sequence_number, p_client_id,
    p_client_company_name, p_client_contact_name, p_client_address, p_client_postal_code,
    p_mid_column_label, p_line_items, p_subtotal, p_vat_percentage, p_vat_amount, p_total, auth.uid()
  ) returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Factuurnummer % bestaat al.', v_number;
end;
$$;
