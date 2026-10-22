-- Mail: privé-bucket voor het tijdelijk klaarzetten van grote bijlagen (> 4 MB).
-- Een Vercel-respons mag max. 4,5 MB zijn; grotere bijlagen gaan daarom eerst hierheen
-- en de browser downloadt ze via een signed URL van 60 seconden. Bestanden ouder dan
-- 15 minuten ruimt de app zelf op (lib/mail/opslag.ts).
--
-- Geen policies: alleen de service-role (in de API-route, ná de sessiecheck) gebruikt
-- deze bucket. Idempotent: twee keer uitvoeren geeft geen fout.
insert into storage.buckets (id, name, public, file_size_limit)
values ('mail-tmp', 'mail-tmp', false, 26214400)
on conflict (id) do nothing;
