-- Grenzen voor de privé-bucket 'social-assets' (zie 0015_social_storage.sql).
--
-- Zonder deze grenzen kon een signed upload-URL (/api/social/projects/[id]/assets/upload-url)
-- een bestand van elke grootte en elk type in <project-id>/<bestand> zetten; de controle in
-- POST /assets kwam pas achteraf. Storage weigert nu zelf alles wat hierbuiten valt.
--
-- De limiet geldt voor de hele bucket, dus ook voor de tijdelijke exports onder
-- exports/<project-id>/ (ZIP met PNG's, PDF), die groter kunnen zijn dan een upload.
-- Daarom 50 MB (het standaard-maximum per bestand van Supabase). Uploads van
-- beeldmateriaal worden in de app strenger begrensd (MAX_UPLOAD_BYTES, 25 MB).
update storage.buckets
set file_size_limit = 52428800, -- 50 MB
    allowed_mime_types = array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'application/zip',
      'application/pdf'
    ]
where id = 'social-assets';
