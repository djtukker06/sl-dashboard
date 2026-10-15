import { formatEuro } from '@/lib/format';

export interface FactuurRegelInvoer {
  beschrijving: string;
  midden?: string;
  totaal: number;
  // Alleen voor de eigen omzetstatistiek: staat dit uit (bijv. bij een doorlopende post),
  // dan telt de regel niet mee in de omzet. Op de factuur zelf verandert er niets — het
  // factuurtotaal blijft altijd de som van álle regels.
  teltMeeInOmzet?: boolean;
}

export interface FactuurRegelBerekend extends FactuurRegelInvoer {
  // Wat er op de PDF bij de regel staat. Bij een aanbetaling is dat het deel van de regel
  // dat nu gefactureerd wordt; "totaal" blijft de volledige prijs zoals ingevuld.
  totaalWeergave: string;
  // Alleen bij een aanbetaling: het bedrag van deze regel dat nu gefactureerd wordt.
  gefactureerd?: number;
}

const opCenten = (bedrag: number) => Math.round((bedrag + Number.EPSILON) * 100) / 100;

// btwVerlegd: de btw wordt verlegd naar de klant, dus wij rekenen er niets over. Het
// tarief is daarmee effectief 0% — het btw-bedrag is 0 en het totaal is gelijk aan het
// subtotaal. Op de factuur staat in het btw-vakje "Verlegd" of "N.v.t." (per factuur te
// kiezen) in plaats van een bedrag.
//
// aanbetalingPercentage: bij een aanbetaling worden de volledige prijzen ingevuld en
// factureert deze factuur daar een percentage van. Elke regel wordt op dat percentage
// gezet en op centen afgerond, zodat de regels op de PDF precies optellen tot het
// subtotaal. Subtotaal, btw, totaal en omzet zijn dan die van de aanbetaling; de
// volledige bedragen en het restant komen er los bij, voor de regel onderaan de PDF.
export function computeTotals(
  regels: FactuurRegelInvoer[],
  btwPercentage: number,
  btwVerlegd = false,
  aanbetalingPercentage: number | null = null
) {
  const effectiefBtwPercentage = btwVerlegd ? 0 : btwPercentage;
  const gefactureerd = (regel: FactuurRegelInvoer) =>
    aanbetalingPercentage === null
      ? regel.totaal
      : opCenten((regel.totaal * aanbetalingPercentage) / 100);

  const berekendeRegels: FactuurRegelBerekend[] = regels.map((regel) => ({
    ...regel,
    totaalWeergave: formatEuro(gefactureerd(regel)),
    ...(aanbetalingPercentage === null ? {} : { gefactureerd: gefactureerd(regel) })
  }));

  const subtotaal = regels.reduce((som, regel) => som + gefactureerd(regel), 0);
  const btw = subtotaal * (effectiefBtwPercentage / 100);
  const totaal = subtotaal + btw;

  const omzet = regels.reduce(
    (som, regel) => (regel.teltMeeInOmzet === false ? som : som + gefactureerd(regel)),
    0
  );

  const volledigSubtotaal = regels.reduce((som, regel) => som + regel.totaal, 0);

  return {
    regels: berekendeRegels,
    omzet,
    subtotaal,
    subtotaalWeergave: formatEuro(subtotaal),
    btwVerlegd,
    btwPercentage: effectiefBtwPercentage,
    btw,
    btwWeergave: formatEuro(btw),
    totaal,
    totaalWeergave: formatEuro(totaal),
    aanbetalingPercentage,
    // Beide excl. btw: zo staan ze in de regel onderaan de PDF.
    volledigSubtotaalWeergave: formatEuro(volledigSubtotaal),
    restantWeergave: formatEuro(volledigSubtotaal - subtotaal)
  };
}
