-- Privé-bucket voor de social media-module:
--   <project-id>/<bestand>             aangeleverd beeldmateriaal (uploads)
--   exports/<project-id>/<ts>-<naam>   tijdelijke exports (ZIP/PDF/PNG) die via
--                                      een kortlevende signed URL worden gedownload
insert into storage.buckets (id, name, public)
values ('social-assets', 'social-assets', false);

-- Ingelogde gebruikers mogen lezen en schrijven (o.a. nodig voor uploads via een
-- signed upload-URL). De API-routes gebruiken de service-role client, altijd ná
-- een sessie-check in de route zelf.
create policy "authenticated read social assets"
  on storage.objects for select
  using (bucket_id = 'social-assets' and (select auth.uid()) is not null);

create policy "authenticated insert social assets"
  on storage.objects for insert
  with check (bucket_id = 'social-assets' and (select auth.uid()) is not null);

create policy "authenticated update social assets"
  on storage.objects for update
  using (bucket_id = 'social-assets' and (select auth.uid()) is not null)
  with check (bucket_id = 'social-assets' and (select auth.uid()) is not null);

create policy "authenticated delete social assets"
  on storage.objects for delete
  using (bucket_id = 'social-assets' and (select auth.uid()) is not null);
