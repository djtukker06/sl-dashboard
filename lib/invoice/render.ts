import ejs from 'ejs';
import { FACTUUR_TEMPLATE } from './template';
import { bedrijf } from '@/lib/config';
import { formatDatumNL } from '@/lib/format';
import type { FactuurRegelBerekend } from './calculations';

export interface FactuurVoorRender {
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
  btwVerlegdReden: string;
  btwWeergave: string;
  totaalWeergave: string;
}

export function renderInvoiceHtml(factuur: FactuurVoorRender): string {
  return ejs.render(FACTUUR_TEMPLATE, {
    factuur: {
      ...factuur,
      datumWeergave: formatDatumNL(factuur.datum)
    },
    bedrijf
  });
}
