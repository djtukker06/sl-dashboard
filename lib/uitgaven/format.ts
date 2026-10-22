// Opmaak die zowel server- als client-componenten gebruiken (geen 'use client').

/** Euro-bedrag voor de weergave: "€ 1.234,50" (andere valuta: "USD 12,00"). */
export function euro(n: number | null | undefined, valuta = 'EUR'): string {
  if (n === null || n === undefined) return '—';
  const s = n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return valuta === 'EUR' ? `€ ${s}` : `${valuta} ${s}`;
}
