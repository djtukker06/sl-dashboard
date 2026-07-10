import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Factuur overzicht Studio Levant',
  description: 'Interne facturatietool voor Studio Levant'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
