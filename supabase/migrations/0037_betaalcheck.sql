-- ============================================================================
-- Studio Levant-backoffice — betaalcheck: "Is factuur … betaald?" (migratie 0037)
-- ============================================================================
--
-- Een week na versturen (invoices.verzonden_op, anders de factuurdatum) vraagt de app in een
-- pop-up of een factuur betaald is. Ja boekt de betaling in de boekhouding (bk_koppelingen,
-- zoals "Betaald boeken" bij Openstaand). Nee vraagt het over 7 dagen opnieuw:
--
--   invoices.betaalcheck_na   vanaf deze dag opnieuw vragen. Leeg = de standaardregel
--                             (een week na versturen). Alleen de server schrijft hem
--                             (service-role, na de teamcheck); lezen valt onder de
--                             bestaande select-policy van invoices.
--
-- Veilig om opnieuw uit te voeren. De app werkt ook vóór 0037 ("Nee" wordt dan alleen op
-- het apparaat onthouden).

alter table public.invoices add column if not exists betaalcheck_na date;

comment on column public.invoices.betaalcheck_na is
  'Betaalcheck: vanaf deze dag opnieuw vragen of de factuur betaald is (na "Nee"). Leeg = een week na versturen.';

-- PostgREST de nieuwe kolom laten zien.
notify pgrst, 'reload schema';
