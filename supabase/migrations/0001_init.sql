create extension if not exists pgcrypto;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  company_name_normalized text generated always as (lower(trim(company_name))) stored,
  contact_name text,
  address text,
  postal_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index clients_company_name_normalized_key
  on public.clients (company_name_normalized);

create table public.invoice_counters (
  year int primary key,
  last_number int not null default 0
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  year int not null,
  sequence_number int not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  -- Snapshot van de klantgegevens op het moment van factureren: een latere adreswijziging
  -- van de klant mag oude facturen nooit met terugwerkende kracht veranderen.
  client_company_name text not null,
  client_contact_name text,
  client_address text,
  client_postal_code text,
  mid_column_label text,
  line_items jsonb not null,
  subtotal numeric(12,2) not null,
  vat_percentage numeric(5,2) not null default 21,
  vat_amount numeric(12,2) not null,
  total numeric(12,2) not null,
  issued_at timestamptz not null default now(),
  pdf_path text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index invoices_client_id_idx on public.invoices (client_id);
create index invoices_year_idx on public.invoices (year);

-- Eenmalige historische basis: er zijn dit jaar (2026) al 7 facturen geweest buiten dit
-- systeem om, dus de eerste factuur die dit systeem genereert moet 26-008 worden.
insert into public.invoice_counters (year, last_number) values (2026, 7);
