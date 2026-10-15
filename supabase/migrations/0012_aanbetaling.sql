-- Aanbetalingsfactuur: bij het aanmaken kies je een reguliere factuur of een aanbetaling.
-- Bij een aanbetaling vul je de volledige prijzen in en kies je een percentage (5 t/m 95,
-- per 5%). Op de PDF staan de regels en totalen op dat percentage, met een vermelding
-- dat het om een aanbetaling gaat en dat het restant later volgt.
--
--   - deposit_percentage is null bij een reguliere factuur.
--   - line_items bewaart de volledige prijzen zoals ingevuld (zodat bewerken gewoon werkt).
--   - subtotal, vat_amount, total en revenue_subtotal zijn de bedragen van de aanbetaling
--     zelf: dat is wat er gefactureerd wordt en dus wat meetelt in de omzet.

alter table public.invoices
  add column if not exists deposit_percentage smallint
    check (deposit_percentage between 5 and 95 and deposit_percentage % 5 = 0);

comment on column public.invoices.deposit_percentage is
  'Aanbetaling: percentage van de volledige opdracht dat deze factuur betreft (5-95, per 5). Null bij een reguliere factuur. line_items bevat de volledige prijzen; subtotal/vat_amount/total zijn de aanbetalingsbedragen.';
