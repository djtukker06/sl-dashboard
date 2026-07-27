-- Per factuurregel is voortaan aan te vinken of die meetelt in de omzetstatistiek
-- (standaard aan, uit te zetten bij bijvoorbeeld een doorlopende post). Dat is puur
-- een interne cijfer-instelling: op de factuur en de PDF verandert er niets, en het
-- factuurtotaal blijft altijd de som van álle regels.
--
-- De uitkomst wordt vastgelegd in een eigen kolom, zodat het jaaroverzicht niet elke
-- keer alle regels van alle facturen hoeft door te rekenen.

alter table public.invoices
  add column if not exists revenue_subtotal numeric(12,2);

-- Bestaande facturen: alles telde mee, dus gelijk aan het subtotaal.
update public.invoices set revenue_subtotal = subtotal where revenue_subtotal is null;

alter table public.invoices
  alter column revenue_subtotal set not null;

comment on column public.invoices.revenue_subtotal is
  'Subtotaal excl. btw van alleen de regels die meetellen in de omzetstatistiek. Nooit gebruiken voor het factuurbedrag zelf — dat is subtotal/total.';

drop function if exists public.create_invoice(
  int, int, timestamptz, uuid, text, text, text, text, text, jsonb, numeric, numeric, numeric, numeric
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
  p_revenue_subtotal numeric,
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
    mid_column_label, line_items, subtotal, revenue_subtotal, vat_percentage, vat_amount,
    total, created_by
  ) values (
    v_number, p_year, p_sequence_number, coalesce(p_issued_at, now()), p_client_id,
    p_client_company_name, p_client_contact_name, p_client_address, p_client_postal_code,
    p_mid_column_label, p_line_items, p_subtotal, coalesce(p_revenue_subtotal, p_subtotal),
    p_vat_percentage, p_vat_amount, p_total, auth.uid()
  ) returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Factuurnummer % bestaat al.', v_number;
end;
$$;
