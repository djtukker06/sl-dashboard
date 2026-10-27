'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { bkApi } from '@/lib/boekhouding/client';

// Altijd zichtbaar in de demo-modus (alleen met BOEKHOUDING_DEMO=1; nooit vanzelf in productie):
// de boekhouding toont voorbeeldgegevens en slaat niets op in de database.
export function DemoBanner() {
  const router = useRouter();
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function herstel() {
    setBezig(true);
    setFout(null);
    try {
      await bkApi('/api/boekhouding/demo/herstel', { method: 'POST' });
      router.refresh();
      window.location.reload();
    } catch (e) {
      setFout((e as Error).message);
      setBezig(false);
    }
  }

  return (
    <div className="bh-demo" role="status">
      <span className="bh-demo-label">Demo</span>
      <p className="bh-demo-tekst">
        <strong>Demo — voorbeeldgegevens, er wordt niets opgeslagen.</strong>{' '}
        <span
          className="bh-demo-uitleg"
          title="Wijzigingen blijven maximaal 4 uur in het geheugen van de server staan en kunnen op Vercel tussendoor verdwijnen (een andere serverinstantie heeft een eigen geheugen)."
        >
          De demo staat aan (BOEKHOUDING_DEMO=1).
        </span>
        {fout && <span className="bh-demo-fout"> {fout}</span>}
      </p>
      <button type="button" className="db-knop bh-demo-knop" onClick={herstel} disabled={bezig}>
        {bezig ? 'Bezig…' : 'Demo herstellen'}
      </button>
    </div>
  );
}
