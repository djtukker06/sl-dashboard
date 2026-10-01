-- Bij een verlegde btw is per factuur te kiezen wat er in het btw-vakje op de PDF komt
-- (tussen subtotaal en totaal): "Verlegd" of "N.v.t.". Verder werkt het precies als
-- voorheen — geen btw-bedrag, totaal gelijk aan subtotaal, de reden onderaan de PDF.
--
-- Bestaande facturen krijgen 'verlegd', zodat hun PDF bij opnieuw opslaan niet verandert.

alter table public.invoices
  add column if not exists vat_reverse_charge_display text not null default 'verlegd'
    check (vat_reverse_charge_display in ('verlegd', 'nvt'));

comment on column public.invoices.vat_reverse_charge_display is
  'Wat er bij een verlegde btw in het btw-vakje op de PDF staat: ''verlegd'' (Verlegd) of ''nvt'' (N.v.t.). Alleen van betekenis als vat_reverse_charged true is.';
