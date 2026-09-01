-- Twee wijzigingen:
--   1. Btw verlegd: per factuur is aan te vinken dat de btw verlegd wordt. Er komt dan
--      geen btw-bedrag op de factuur (het vakje toont "Verlegd") en het totaal is gelijk
--      aan het subtotaal. De reden komt als extra regel onderaan de PDF te staan.
--   2. Een bestaande factuur is voortaan te bewerken via update_invoice(). Die functie
--      bewaakt dezelfde regels als create_invoice: een geldig volgnummer, boven de
--      ondergrens van invoice_counters, en geen dubbel factuurnummer.

alter table public.invoices
  add column if not exists vat_reverse_charged boolean not null default false,
  add column if not exists vat_reverse_charge_reason text;

comment on column public.invoices.vat_reverse_charged is
  'Btw verlegd: er staat geen btw-bedrag op de factuur. vat_percentage en vat_amount zijn dan 0, en total is gelijk aan subtotal.';
comment on column public.invoices.vat_reverse_charge_reason is
  'Toelichting die als extra regel onderaan de PDF komt, boven de vaste footerteksten. Alleen ingevuld bij een verlegde btw.';

-- De signatuur wijzigt (btw verlegd erbij), dus de oude functie moet expliciet weg.
drop function if exists public.create_invoice(
  int, int, timestamptz, uuid, text, text, text, text, text, jsonb,
  numeric, numeric, numeric, numeric, numeric
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
  p_total numeric,
  p_vat_reverse_charged boolean default false,
  p_vat_reverse_charge_reason text default null
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
    total, vat_reverse_charged, vat_reverse_charge_reason, created_by
  ) values (
    v_number, p_year, p_sequence_number, coalesce(p_issued_at, now()), p_client_id,
    p_client_company_name, p_client_contact_name, p_client_address, p_client_postal_code,
    p_mid_column_label, p_line_items, p_subtotal, coalesce(p_revenue_subtotal, p_subtotal),
    p_vat_percentage, p_vat_amount, p_total,
    coalesce(p_vat_reverse_charged, false), p_vat_reverse_charge_reason, auth.uid()
  ) returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Factuurnummer % bestaat al.', v_number;
end;
$$;

-- Bewerken van een bestaande factuur. Bewust géén nieuwe rij en géén nieuw id: het gaat
-- om dezelfde factuur, alleen met gecorrigeerde gegevens. pdf_path blijft hier ongemoeid
-- — die wordt pas bijgewerkt als de nieuwe PDF ook echt in de opslag staat.
create or replace function public.update_invoice(
  p_id uuid,
  p_year int,
  p_sequence_number int,
  p_issued_at timestamptz,
  p_name text,
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
  p_total numeric,
  p_vat_reverse_charged boolean default false,
  p_vat_reverse_charge_reason text default null
) returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number  text := right(p_year::text, 2) || '-' || lpad(p_sequence_number::text, 3, '0');
  v_floor   int;
  v_bestaat boolean;
  v_row     public.invoices;
begin
  if p_sequence_number < 1 or p_sequence_number > 999 then
    raise exception 'Ongeldig volgnummer: %.', p_sequence_number;
  end if;

  select true into v_bestaat from invoices where id = p_id;
  if v_bestaat is null then
    raise exception 'Factuur bestaat niet (meer).';
  end if;

  select last_number into v_floor from invoice_counters where year = p_year;
  if p_sequence_number <= coalesce(v_floor, 0) then
    raise exception 'Factuurnummer % is al gebruikt buiten dit systeem om.', v_number;
  end if;

  update invoices set
    invoice_number = v_number,
    year = p_year,
    sequence_number = p_sequence_number,
    issued_at = coalesce(p_issued_at, issued_at),
    name = p_name,
    client_id = p_client_id,
    client_company_name = p_client_company_name,
    client_contact_name = p_client_contact_name,
    client_address = p_client_address,
    client_postal_code = p_client_postal_code,
    mid_column_label = p_mid_column_label,
    line_items = p_line_items,
    subtotal = p_subtotal,
    revenue_subtotal = coalesce(p_revenue_subtotal, p_subtotal),
    vat_percentage = p_vat_percentage,
    vat_amount = p_vat_amount,
    total = p_total,
    vat_reverse_charged = coalesce(p_vat_reverse_charged, false),
    vat_reverse_charge_reason = p_vat_reverse_charge_reason
  where id = p_id
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Factuurnummer % bestaat al.', v_number;
end;
$$;
