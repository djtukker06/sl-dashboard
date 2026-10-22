import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Factuur overzicht Studio Levant'
};

export default function FacturenLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
