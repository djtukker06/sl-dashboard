-- Uitgaven: bonnetjes en betaalde facturen.
--   expenses       één uitgave (concept na een upload, of "verwerkt" = doorgegeven aan de boekhouder)
--   expense_files  de bestanden (foto's/PDF's) van een uitgave, in de privé-bucket "uitgaven"
--   buckets        "uitgaven" (bonnetjes, max. 25 MB, jpeg/png/webp/heic/pdf) en
--                  "uitgaven-export" (tijdelijke ZIP's voor de boekhouder, max. 50 MB)
-- Idempotent: veilig om (nogmaals) uit te voeren in de Supabase SQL Editor.
-- De facturen-tabellen worden alleen gelezen (klant koppelen, btw-overzicht), nooit gewijzigd.

create extension if not exists pgcrypto;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date,                                   -- datum op het bonnetje/de factuur
  supplier text not null default '' check (length(supplier) <= 200),
  description text not null default '' check (length(description) <= 500),
  category text check (category in (
    'software', 'hardware', 'kantoor', 'reiskosten', 'marketing', 'representatie',
    'opleiding', 'uitbesteed', 'telefoon', 'bankkosten', 'overig'
  )),
  total_amount numeric(12,2) check (total_amount between -1000000 and 1000000),  -- incl. btw
  vat_amount numeric(12,2) check (vat_amount between -1000000 and 1000000),
  vat_rate text check (vat_rate in ('21', '9', '0', 'verlegd', 'geen')),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  invoice_number text not null default '' check (length(invoice_number) <= 100),
  payment_method text check (payment_method in ('zakelijk', 'prive', 'creditcard', 'contant')),
  client_id uuid references public.clients (id) on delete set null,
  project_note text not null default '' check (length(project_note) <= 300),
  notes text not null default '' check (length(notes) <= 10000),
  status text not null default 'concept' check (status in ('concept', 'verwerkt')),
  -- Velden die door het automatisch uitlezen zijn ingevuld en nog niet door de gebruiker
  -- zijn aangepast (de app markeert ze subtiel).
  ai_fields text[] not null default '{}',
  ai_status text not null default 'geen' check (ai_status in ('geen', 'klaar', 'mislukt')),
  ai_message text not null default '' check (length(ai_message) <= 500),
  source text not null default 'upload' check (source in ('upload', 'mail', 'handmatig')),
  source_ref text not null default '' check (length(source_ref) <= 500),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "Verwerkt" kan pas met een datum en een bedrag.
  constraint expenses_verwerkt_compleet
    check (status = 'concept' or (expense_date is not null and total_amount is not null))
);

create index if not exists expenses_date_idx on public.expenses (expense_date desc nulls first);
create index if not exists expenses_status_idx on public.expenses (status) where status = 'concept';
create index if not exists expenses_supplier_idx on public.expenses (lower(supplier));
create index if not exists expenses_created_idx on public.expenses (created_at desc);

create table if not exists public.expense_files (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  storage_path text not null unique check (length(storage_path) <= 300),
  file_name text not null default '' check (length(file_name) <= 200),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'
  )),
  size_bytes bigint check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists expense_files_expense_idx on public.expense_files (expense_id, created_at);

-- updated_at automatisch bijwerken (functie uit 0018; hier opnieuw, zodat 0020 los kan draaien).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- RLS: gedeeld voor het hele (kleine) team, net als tasks (0018): alleen "is dit een
-- ingelogde gebruiker". De API-routes gebruiken de gebruikerscliënt; alleen Storage gaat
-- via de service-role (ná de sessiecheck in de route).
alter table public.expenses enable row level security;
alter table public.expense_files enable row level security;

drop policy if exists "authenticated read/write expenses" on public.expenses;
create policy "authenticated read/write expenses"
  on public.expenses for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "authenticated read/write expense_files" on public.expense_files;
create policy "authenticated read/write expense_files"
  on public.expense_files for all
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

-- Storage. Geen policies: alleen de service-role gebruikt deze buckets. Uploads gaan via
-- een signed upload-URL (buiten de 4,5 MB-limiet van Vercel om); Storage weigert zelf
-- bestanden boven de limiet of van een ander type.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uitgaven', 'uitgaven', false, 26214400, -- 25 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do nothing;

-- Exports (ZIP met bonnetjes + CSV) zijn groter dan een Vercel-respons: ze gaan hierheen en
-- de browser downloadt ze via een signed URL. De app ruimt exports ouder dan 15 min op.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uitgaven-export', 'uitgaven-export', false, 52428800, array['application/zip']) -- 50 MB
on conflict (id) do nothing;
