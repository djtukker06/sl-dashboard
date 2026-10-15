-- Prijsopgaven: dezelfde opzet als een factuur, maar los van het factuurarchief.
--
--   - Eigen tabel, zodat een prijsopgave nooit meetelt in de omzet, het aantal facturen
--     of de factuurnummering.
--   - Bijna alles is optioneel: nummer, klantnaam, t.a.v., adres en postcode mogen leeg.
--   - Geen koppeling met clients: een bestaande klant kiezen vult alleen de velden in,
--     en een nieuw ingetypte naam wordt bewust níet als klant aangemaakt. De klantgegevens
--     staan dus alleen hier, als snapshot op de prijsopgave zelf.

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text,
  name text,
  issued_at timestamptz not null default now(),
  client_company_name text,
  client_contact_name text,
  client_address text,
  client_postal_code text,
  mid_column_label text,
  line_items jsonb not null,
  subtotal numeric(12,2) not null,
  vat_percentage numeric(5,2) not null default 21,
  vat_amount numeric(12,2) not null,
  total numeric(12,2) not null,
  vat_reverse_charged boolean not null default false,
  vat_reverse_charge_display text not null default 'verlegd'
    check (vat_reverse_charge_display in ('verlegd', 'nvt')),
  vat_reverse_charge_reason text,
  pdf_path text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotes_issued_at_idx on public.quotes (issued_at desc);

comment on table public.quotes is
  'Prijsopgaven. Los van invoices: telt niet mee in omzet of factuurnummering, en maakt nooit een klant aan.';

alter table public.quotes enable row level security;

-- Net als bij invoices: lezen mag elke ingelogde gebruiker, schrijven gaat uitsluitend
-- via de service-role client in de API-routes (met een verplichte sessie-check daarvoor).
drop policy if exists "authenticated read quotes" on public.quotes;
create policy "authenticated read quotes"
  on public.quotes for select
  using ((select auth.uid()) is not null);

-- De PDF's komen in de bestaande privé-bucket "invoices", onder de map prijsopgaven/.
-- De leespolicy op die bucket (0004_storage.sql) dekt dat al.
