import type { MetadataRoute } from 'next';

// Web-app-manifest (/manifest.webmanifest): de backoffice als app op het beginscherm van de
// telefoon. Kleuren = --sl-bg uit public/shell/shell.css. De iconen staan in public/brand/app/
// (gemaakt uit public/brand/merk-licht.png); brand/ slaat de proxy over, zodat de browser ze
// ook zonder sessiecookie kan ophalen (een manifest wordt zonder cookies opgevraagd).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Studio Levant',
    short_name: 'Levant',
    description: 'Interne backoffice van Studio Levant',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'nl',
    background_color: '#232323',
    theme_color: '#232323',
    icons: [
      { src: '/brand/app/icoon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/app/icoon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/app/icoon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
