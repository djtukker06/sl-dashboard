import type { Metadata } from 'next';
import Link from 'next/link';
import { ModuleKop } from '@/components/shell/ModuleKop';

export const metadata: Metadata = {
  title: 'Factuur overzicht Studio Levant'
};

// Facturen wordt alleen ingebed in de gedeelde shell: dezelfde 96px-kop als de andere
// modules (op één lijn met het rail-logo). De schermen zelf blijven ongewijzigd; de eigen
// tekst-wordmark wordt binnen de shell verborgen (zie app.css), het rail-logo gaat naar '/'.
export default function FacturenLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <ModuleKop
        label="Administratie"
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
