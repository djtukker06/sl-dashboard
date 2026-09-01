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
  totaalWeergave: string;
}

// btwVerlegd: de btw wordt verlegd naar de klant, dus wij rekenen er niets over. Het
// tarief is daarmee effectief 0% — het btw-bedrag is 0 en het totaal is gelijk aan het
// subtotaal. Op de factuur staat in het btw-vakje "Verlegd" in plaats van een bedrag.
export function computeTotals(
  regels: FactuurRegelInvoer[],
  btwPercentage: number,
  btwVerlegd = false
) {
  const effectiefBtwPercentage = btwVerlegd ? 0 : btwPercentage;

  const berekendeRegels: FactuurRegelBerekend[] = regels.map((regel) => ({
    ...regel,
    totaalWeergave: formatEuro(regel.totaal)
  }));

  const subtotaal = regels.reduce((som, regel) => som + regel.totaal, 0);
  const btw = subtotaal * (effectiefBtwPercentage / 100);
  const totaal = subtotaal + btw;

  const omzet = regels.reduce(
    (som, regel) => (regel.teltMeeInOmzet === false ? som : som + regel.totaal),
    0
  );

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
    totaalWeergave: formatEuro(totaal)
  };
}
