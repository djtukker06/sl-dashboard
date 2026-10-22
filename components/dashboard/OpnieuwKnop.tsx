'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

// Haalt de server-widgets opnieuw op zonder de hele pagina te verversen.
export function OpnieuwKnop() {
  const router = useRouter();
  const [bezig, start] = useTransition();
  return (
    <button type="button" className="db-knop" disabled={bezig} onClick={() => start(() => router.refresh())}>
      {bezig ? 'Bezig…' : 'Opnieuw'}
    </button>
  );
}
