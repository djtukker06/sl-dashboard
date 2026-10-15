import ejs from 'ejs';
import { FACTUUR_TEMPLATE } from './template';
import { bedrijf } from '@/lib/config';
import { formatDatumNL } from '@/lib/format';
import type { FactuurRegelBerekend } from './calculations';
import type { DocumentSoort } from './formulier';

export interface FactuurVoorRender {
  // Standaard een factuur. Een prijsopgave krijgt een andere titel, geen bankgegevens
  // en geen betaalregel, en laat lege klantregels weg.
  soort?: DocumentSoort;
  // Bij een prijsopgave mag dit leeg zijn; dan staat er geen nummer op de PDF.
  factuurnummer: string;
  datum: Date;
  klant: {
    bedrijfsnaam: string;
    tav: string;
    adres: string;
    postcode: string;
  };
  middenKolomLabel: string;
  regels: FactuurRegelBerekend[];
  subtotaalWeergave: string;
  // Het percentage van deze factuur zelf (0 bij verlegde btw), niet dat uit config —
  // zo klopt het label ook op een factuur waarop geen btw is gerekend.
  btwPercentage: number;
  btwVerlegd: boolean;
  // De tekst in het btw-vakje bij een verlegde btw: "Verlegd" of "N.v.t.".
  btwVerlegdTekst: string;
  btwVerlegdReden: string;
  btwWeergave: string;
  totaalWeergave: string;
  // Alleen bij een aanbetalingsfactuur: het percentage, en de volledige opdracht en het
  // restant (incl. btw) voor de regel onderaan de PDF.
  aanbetalingPercentage?: number | null;
  volledigTotaalWeergave?: string;
  restantWeergave?: string;
}

export function renderInvoiceHtml(factuur: FactuurVoorRender): string {
  const soort = factuur.soort ?? 'factuur';
  const { bedrijfsnaam, tav, adres, postcode } = factuur.klant;

  // Op een factuur staan altijd alle vier de regels (de velden zijn daar verplicht).
  // Op een prijsopgave alleen wat is ingevuld; is er niets ingevuld, dan vervalt het
  // hele "Aan:"-blok.
  const aanRegels =
    soort === 'factuur'
      ? [bedrijfsnaam, `t.a.v. ${tav}`, adres, postcode]
      : [bedrijfsnaam, tav ? `t.a.v. ${tav}` : '', adres, postcode].filter((r) => r !== '');

  return ejs.render(FACTUUR_TEMPLATE, {
    factuur: {
      ...factuur,
      soort,
      aanRegels,
      aanbetalingPercentage: factuur.aanbetalingPercentage ?? null,
      datumWeergave: formatDatumNL(factuur.datum)
    },
    bedrijf
  });
}
