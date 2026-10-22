import type { Metadata } from 'next';
import Link from 'next/link';
import { BoekhoudingKop } from '@/components/boekhouding/BoekhoudingKop';

export const metadata: Metadata = {
  title: 'Factuur overzicht Studio Levant'
};

// Facturen hoort bij de tab Boekhouding: dezelfde 96px-kop als de andere modules (label
// "Boekhouding") met de subnavigatie Overzicht · Facturen · Bonnetjes. De schermen zelf
// blijven ongewijzigd; de eigen tekst-wordmark wordt binnen de shell verborgen (zie app.css).
export default function FacturenLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <BoekhoudingKop
        titel={
          <Link href="/facturen" className="sl-kop-link">
            Facturen
          </Link>
        }
      />
      {children}
    </>
  );
}
