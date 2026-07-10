alter table public.clients enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_counters enable row level security;

-- Gedeeld archief voor het hele (kleine) team: geen per-gebruiker eigenaarschap nodig,
-- alleen "is dit een ingelogde gebruiker".
create policy "authenticated read/write clients"
  on public.clients for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

create policy "authenticated read invoices"
  on public.invoices for select
  using ((select auth.uid()) is not null);

-- Schrijven naar invoices verloopt via create_invoice() (SECURITY DEFINER) en de
-- service-role client in de API-routes (met een verplichte sessie-check daarvoor) —
-- geen directe INSERT/UPDATE/DELETE-policy nodig voor de authenticated-rol.

create policy "authenticated read counters"
  on public.invoice_counters for select
  using ((select auth.uid()) is not null);
