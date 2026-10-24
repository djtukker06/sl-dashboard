import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Studio Levant',
  description: 'Interne backoffice van Studio Levant'
};

// Elke pagina wordt per verzoek gerenderd: de Content-Security-Policy (proxy.ts) werkt met
// een nonce per verzoek, en Next.js zet die alleen op scripts van dynamisch gerenderde
// pagina's. (Bijna alles was al dynamisch vanwege de sessiecheck.)
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await headers();
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
