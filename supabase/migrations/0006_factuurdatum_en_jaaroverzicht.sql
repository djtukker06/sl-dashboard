-- Twee wijzigingen:
--   1. De factuurdatum is voortaan zelf te kiezen (was: altijd "nu"), zodat oudere
--      facturen met hun echte datum ingevoerd kunnen worden.
--   2. De ondergrens voor 2026 wordt vrijgegeven. De facturen 001 t/m 007 van vóór dit
--      systeem worden alsnog ingevoerd, dus die nummers moeten weer beschikbaar zijn.
--      Vanaf nu bewaakt alleen nog de unieke index op invoice_number dat een nummer
--      niet dubbel gebruikt wordt — per jaar, want het jaartal zit in het nummer.

update public.invoice_counters set last_number = 0 where year = 2026;

comment on table public.invoice_counters is
  'Ondergrens per jaar: nummers t/m last_number zijn buiten dit systeem om vergeven en worden geweigerd. Staat op 0 zodra alle papieren facturen zijn ingevoerd.';

drop function if exists public.create_invoice(
  int, int, uuid, text, text, text, text, text, jsonb, numeric, numeric, numeric, numeric
);

create or replace function public.create_invoice(
  p_year int,
  p_sequence_number int,
  p_issued_at timestamptz,
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
    invoice_number, year, sequence_number, issued_at, client_id,
    client_company_name, client_contact_name, client_address, client_postal_code,
    mid_column_label, line_items, subtotal, vat_percentage, vat_amount, total, created_by
  ) values (
    v_number, p_year, p_sequence_number, coalesce(p_issued_at, now()), p_client_id,
    p_client_company_name, p_client_contact_name, p_client_address, p_client_postal_code,
    p_mid_column_label, p_line_items, p_subtotal, p_vat_percentage, p_vat_amount, p_total, auth.uid()
  ) returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Factuurnummer % bestaat al.', v_number;
end;
$$;
