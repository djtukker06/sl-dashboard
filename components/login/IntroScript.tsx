'use client';

import { useSyncExternalStore } from 'react';

// Het inline script van de openingsanimatie (zie app/login/page.tsx). Alleen in de server-HTML
// en tijdens de hydratie (daar draait het al tijdens het parsen); bij een client-navigatie naar
// /login (Link, redirect na uitloggen) zou React een <script> aanmaken dat toch nooit draait en
// daarover een console-fout geven. Dan speelt de animatie ook niet, net als bij een verwijzing
// van dezelfde site.
const geenAbonnement = () => () => {};

export function IntroScript({ code, nonce }: { code: string; nonce?: string }) {
  const tijdensHydratie = useSyncExternalStore(
    geenAbonnement,
    () => false,
    () => true
  );
  if (!tijdensHydratie) return null;
  return <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: code }} />;
}
