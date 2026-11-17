-- ============================================================================
-- Studio Levant-backoffice — terugkerende facturen: eerst akkoord geven (migratie 0038)
-- ============================================================================
--
-- Per terugkerende factuur een vinkje "Eerst akkoord geven voordat hij verstuurd wordt"
-- (standaard aan). Vanaf een week van tevoren vraagt de app in één gebundelde melding om
-- akkoord; op de dag zelf wordt een factuur zonder akkoord wel aangemaakt (nummer en datum
-- kloppen dan), maar niet verstuurd tot je op Versturen klikt.
--
--   terugkerende_facturen.akkoord_vereist   vinkje (standaard true)
--   terugkerende_facturen.akkoord_periode   voor welke geplande datum het akkoord geldt; een
--                                           wijziging van het sjabloon wist het weer
--   terugkerende_facturen.akkoord_door / akkoord_op
--   invoices.wacht_op_akkoord               aangemaakt maar nog niet verstuurd (wacht op jou)
--
-- Veilig om opnieuw uit te voeren. Vereist 0036.

alter table public.terugkerende_facturen add column if not exists akkoord_vereist boolean not null default true;
alter table public.terugkerende_facturen add column if not exists akkoord_periode date;
alter table public.terugkerende_facturen add column if not exists akkoord_door uuid references auth.users (id) on delete set null;
alter table public.terugkerende_facturen add column if not exists akkoord_op timestamptz;

alter table public.invoices add column if not exists wacht_op_akkoord boolean not null default false;
