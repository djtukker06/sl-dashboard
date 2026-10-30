import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Studio Levant',
  description: 'Interne backoffice van Studio Levant',
  // Als web-app op het beginscherm (app/manifest.ts). Op iOS: schermvullend, met de
  // statusbalk over de donkere achtergrond (de shell houdt rekening met de safe areas).
  applicationName: 'Studio Levant',
  appleWebApp: { capable: true, title: 'Levant', statusBarStyle: 'black-translucent' },
  icons: { apple: [{ url: '/brand/app/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }] },
  formatDetection: { telephone: false }
};

// viewport-fit=cover: de inhoud loopt door tot onder de notch en de thuisbalk; vaste balken
// (tabbalk onderaan, panelen) gebruiken env(safe-area-inset-*). Zoomen blijft toegestaan.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#232323',
  colorScheme: 'dark'
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
