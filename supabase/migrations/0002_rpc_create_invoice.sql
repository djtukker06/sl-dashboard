-- Kent atomair het eerstvolgende factuurnummer toe (race-veilig via een rij-lock op de
-- teller-rij van dit jaar) en maakt de factuur aan in dezelfde transactie. Als de insert
-- om welke reden dan ook faalt, rolt de tellerverhoging automatisch mee terug — er wordt
-- dus nooit een nummer "verbruikt" zonder bijbehorende factuur.
create or replace function public.create_invoice(
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
  v_year int := extract(year from now())::int;
  v_seq  int;
  v_row  public.invoices;
begin
  insert into invoice_counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update set last_number = invoice_counters.last_number + 1
  returning last_number into v_seq;

  insert into invoices (
    invoice_number, year, sequence_number, client_id,
    client_company_name, client_contact_name, client_address, client_postal_code,
    mid_column_label, line_items, subtotal, vat_percentage, vat_amount, total, created_by
  ) values (
    right(v_year::text, 2) || '-' || lpad(v_seq::text, 3, '0'), v_year, v_seq, p_client_id,
    p_client_company_name, p_client_contact_name, p_client_address, p_client_postal_code,
    p_mid_column_label, p_line_items, p_subtotal, p_vat_percentage, p_vat_amount, p_total, auth.uid()
  ) returning * into v_row;

  return v_row;
end;
$$;
