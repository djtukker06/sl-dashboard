insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false);

-- Alleen lezen voor ingelogde gebruikers (nodig om een signed URL te kunnen aanvragen).
-- Uploaden/verwijderen gebeurt uitsluitend via de service-role client in de API-routes.
create policy "authenticated read invoice pdfs"
  on storage.objects for select
  using (bucket_id = 'invoices' and (select auth.uid()) is not null);
