'use client';

import { useTaakDialoog } from '@/components/taken/TakenProvider';

// "+ Taak" in de kop van het dashboard en de agenda: opent de taak-popup (sneltoets n).
export function TaakKnop({ className = 'db-knop db-knop-primair' }: { className?: string }) {
  const { nieuw } = useTaakDialoog();
  return (
    <button type="button" className={className} title="Nieuwe taak (n)" aria-keyshortcuts="n" onClick={() => nieuw()}>
      + Taak
    </button>
  );
}
