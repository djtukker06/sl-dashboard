-- Elke factuur krijgt een eigen naam, standaard "Factuur JJ-NNN" met eventueel een
-- eigen omschrijving erachter. De naam wordt alleen gebruikt als bestandsnaam van de
-- PDF-download — op de factuur zelf is er niets van te zien.

alter table public.invoices
  add column if not exists name text;

-- Bestaande facturen: de standaardnaam op basis van het factuurnummer.
update public.invoices set name = 'Factuur ' || invoice_number where name is null;

comment on column public.invoices.name is
  'Naam van de factuur, gebruikt als bestandsnaam bij het downloaden van de PDF. Staat niet op de factuur zelf.';
