-- ============================================================================
-- Studio Levant-backoffice — social: elke 5 minuten de planner aanroepen
-- (bij migratie 0041; voer eerst UITVOEREN_0041.sql uit)
-- ============================================================================
--
-- Vercel Hobby kan een cron maar 1× per dag draaien; ingeplande posts moeten stipt op tijd
-- (hooguit 5–10 minuten later). Daarom roept Supabase zelf elke 5 minuten
-- GET <SITE_URL>/api/cron/social aan, met "Authorization: Bearer <CRON_SECRET>":
--   pg_cron  plant de taak ('*/5 * * * *');
--   pg_net   doet het HTTP-verzoek (asynchroon, de database wacht er niet op);
--   Vault    bewaart het CRON_SECRET en het adres versleuteld (niet leesbaar voor de app:
--            vault.decrypted_secrets is alleen voor postgres/service-role).
--
-- VOOR JE DIT UITVOERT, vervang je hieronder twee waarden (in het blok "Instellen"):
--   PLAATS_HIER_JE_CRON_SECRET   precies dezelfde waarde als CRON_SECRET in Vercel
--   https://JOUW-DOMEIN          het publieke adres, zonder / aan het eind
--                                (bv. https://sl-dashboard-delta.vercel.app)
-- Zet het ingevulde bestand NIET terug in git.
--
-- Veilig om opnieuw uit te voeren: bestaande geheimen worden bijgewerkt en de taak met
-- dezelfde naam vervangen. Later een ander secret of adres? Pas de waarden aan en voer het
-- opnieuw uit. Stoppen: select cron.unschedule('sl-social-planner');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- Instellen (vervang de twee waarden) ----------
do $$
declare
  v_secret text := 'PLAATS_HIER_JE_CRON_SECRET';
  v_site text := 'https://JOUW-DOMEIN';
  v_id uuid;
begin
  if v_secret = 'PLAATS_HIER_JE_CRON_SECRET' or length(v_secret) < 16 then
    raise exception 'Vul eerst je CRON_SECRET in (min. 16 tekens), zie de uitleg bovenaan.';
  end if;
  if v_site like '%JOUW-DOMEIN%' or v_site !~ '^https://[^/]+$' then
    raise exception 'Vul eerst het adres van de backoffice in (https://…, zonder / aan het eind).';
  end if;

  select id into v_id from vault.secrets where name = 'sl_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_secret, 'sl_cron_secret', 'CRON_SECRET voor /api/cron/social (pg_cron)');
  else
    perform vault.update_secret(v_id, v_secret, 'sl_cron_secret', 'CRON_SECRET voor /api/cron/social (pg_cron)');
  end if;

  select id into v_id from vault.secrets where name = 'sl_site_url';
  if v_id is null then
    perform vault.create_secret(v_site, 'sl_site_url', 'Adres van de backoffice (pg_cron)');
  else
    perform vault.update_secret(v_id, v_site, 'sl_site_url', 'Adres van de backoffice (pg_cron)');
  end if;
end $$;

-- ---------- De taak ----------
-- Met dezelfde naam opnieuw plannen vervangt de bestaande taak. timeout_milliseconds ruim
-- (de route mag 300 s duren); pg_net wacht asynchroon, er blijft niets hangen.
select cron.schedule(
  'sl-social-planner',
  '*/5 * * * *',
  $job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sl_site_url') || '/api/cron/social',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sl_cron_secret')
      ),
      timeout_milliseconds := 290000
    );
  $job$
);

-- Oude pg_net-antwoorden en cron-logs niet eindeloos bewaren (één keer per nacht opruimen).
select cron.schedule(
  'sl-social-planner-opruimen',
  '17 3 * * *',
  $job$
    delete from cron.job_run_details where end_time < now() - interval '7 days';
  $job$
);

-- Controle: elke regel moet "ok" zijn.
select 'pg_cron aan' as onderdeel,
       case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'ok' else 'ontbreekt' end as status
union all
select 'pg_net aan',
       case when exists (select 1 from pg_extension where extname = 'pg_net') then 'ok' else 'ontbreekt' end
union all
select 'geheimen in Vault',
       case when (select count(*) from vault.secrets where name in ('sl_cron_secret', 'sl_site_url')) = 2 then 'ok' else 'ontbreekt' end
union all
select 'taak elke 5 minuten',
       case when exists (select 1 from cron.job where jobname = 'sl-social-planner' and schedule = '*/5 * * * *' and active) then 'ok' else 'ontbreekt' end;

-- Na ~5 minuten nakijken of het werkt (status_code 200 en "ok":true):
--   select id, status_code, left(content::text, 200) as antwoord, created
--   from net._http_response order by created desc limit 5;
--   select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'sl-social-planner')
--   order by start_time desc limit 5;
