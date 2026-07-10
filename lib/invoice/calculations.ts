import { formatEuro } from '@/lib/format';

export interface FactuurRegelInvoer {
  beschrijving: string;
  midden?: string;
  totaal: number;
}

export interface FactuurRegelBerekend extends FactuurRegelInvoer {
  totaalWeergave: string;
}

export function computeTotals(regels: FactuurRegelInvoer[], btwPercentage: number) {
  const berekendeRegels: FactuurRegelBerekend[] = regels.map((regel) => ({
    ...regel,
    totaalWeergave: formatEuro(regel.totaal)
  }));

  const subtotaal = regels.reduce((som, regel) => som + regel.totaal, 0);
  const btw = subtotaal * (btwPercentage / 100);
  const totaal = subtotaal + btw;

  return {
    regels: berekendeRegels,
    subtotaal,
    subtotaalWeergave: formatEuro(subtotaal),
    btw,
    btwWeergave: formatEuro(btw),
    totaal,
    totaalWeergave: formatEuro(totaal)
  };
}
