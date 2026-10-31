import type { Metadata } from 'next';
import { FacturenKop } from '@/components/boekhouding/FacturenKop';

export const metadata: Metadata = {
  title: 'Facturen · Studio Levant'
};

// Facturen hoort bij de tab Boekhouding: dezelfde 96px-kop als de andere modules (label
// "Boekhouding") met de subnavigatie Overzicht · Facturen · Bonnetjes. Titel en knoppen per
// scherm staan in FacturenKop; de schermen zelf hebben geen eigen wordmark of grote titel.
// De kop staat in de layout, zodat hij bij wisselen tussen facturenschermen blijft staan.
export default function FacturenLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <FacturenKop />
      {children}
    </>
  );
}
