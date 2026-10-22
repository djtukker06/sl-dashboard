'use client';

import { useRouter } from 'next/navigation';

// "+ Taak" in de kop van het dashboard: zet de focus op de snelinvoer (of opent de agenda
// als die er niet is, bv. zolang de agenda nog niet is ingericht).
export function TaakKnop() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="db-knop db-knop-primair"
      title="Nieuwe taak (n)"
      onClick={() => {
        const veld = document.getElementById('snelinvoer');
        if (veld instanceof HTMLInputElement) {
          veld.scrollIntoView({ block: 'center', behavior: 'smooth' });
          veld.focus({ preventScroll: true });
        } else {
          router.push('/agenda');
        }
      }}
    >
      + Taak
    </button>
  );
}
