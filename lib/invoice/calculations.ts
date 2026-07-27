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

export function computeTotals(regels: FactuurRegelInvoer[], btwPercentage: number) {
  const berekendeRegels: FactuurRegelBerekend[] = regels.map((regel) => ({
    ...regel,
    totaalWeergave: formatEuro(regel.totaal)
  }));

  const subtotaal = regels.reduce((som, regel) => som + regel.totaal, 0);
  const btw = subtotaal * (btwPercentage / 100);
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
    btw,
    btwWeergave: formatEuro(btw),
    totaal,
    totaalWeergave: formatEuro(totaal)
  };
}
