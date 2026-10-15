-- Restfactuur: vanuit een aanbetalingsfactuur maak je met één klik een factuur voor het
-- resterende bedrag, met het eerstvolgende factuurnummer. Het is een gewone factuur
-- (deposit_percentage is leeg; line_items bevat de resterende bedragen per regel), met
-- daarnaast een verwijzing naar de aanbetaling voor de vermelding op de PDF.
--
--   - remainder_of_invoice_id: de aanbetalingsfactuur. Per aanbetaling kan er maar één
--     restfactuur zijn; verwijder je de restfactuur, dan kun je hem opnieuw maken.
--   - remainder_percentage en remainder_of_number: een snapshot voor de PDF, zodat de
--     vermelding blijft kloppen, ook als de aanbetaling later wordt aangepast of
--     verwijderd.

alter table public.invoices
  add column if not exists remainder_of_invoice_id uuid
    references public.invoices(id) on delete set null,
  add column if not exists remainder_percentage smallint
    check (remainder_percentage between 5 and 95),
  add column if not exists remainder_of_number text;

create unique index if not exists invoices_remainder_of_invoice_id_key
  on public.invoices (remainder_of_invoice_id)
  where remainder_of_invoice_id is not null;

comment on column public.invoices.remainder_of_invoice_id is
  'Restfactuur: de aanbetalingsfactuur waarvan dit het resterende bedrag is. Maximaal één restfactuur per aanbetaling.';
comment on column public.invoices.remainder_percentage is
  'Restfactuur: het resterende percentage van de opdracht (100 - aanbetalingspercentage), voor op de PDF.';
comment on column public.invoices.remainder_of_number is
  'Restfactuur: het factuurnummer van de aanbetaling, voor op de PDF.';
