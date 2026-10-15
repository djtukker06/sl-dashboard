'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Eén klik: maakt de restfactuur van een aanbetaling aan (eerstvolgend factuurnummer,
// datum vandaag) en opent meteen de PDF — net als na het aanmaken via het formulier.
export function RestfactuurKnop({
  factuurId,
  volgendNummer,
  restPercentage
}: {
  factuurId: string;
  volgendNummer: string;
  restPercentage: number;
}) {
  const router = useRouter();
  const [bezig, setBezig] = useState(false);

  async function maakRestfactuur() {
    setBezig(true);
    const res = await fetch(`/api/invoices/${factuurId}/restfactuur`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || 'Er ging iets mis bij het maken van de restfactuur.');
      setBezig(false);
      router.refresh();
      return;
    }

    router.refresh();
    router.push(`/api/invoices/${data.id}/pdf`);
  }

  return (
    <button
      type="button"
      className="restfactuur-knop"
      disabled={bezig}
      title={`Maakt factuur ${volgendNummer} aan voor de resterende ${restPercentage}%`}
      onClick={maakRestfactuur}
    >
      {bezig ? 'Bezig…' : `Restfactuur maken (${volgendNummer})`}
    </button>
  );
}
