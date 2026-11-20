'use client';

import { useState } from 'react';
import { useKlantWijzigen } from './KlantActies';

/** Een afgewezen lead toch weer oppakken: terug naar Leads (met "Ongedaan maken" in de melding). */
export function TerugNaarLeads({ klant }: { klant: { id: string; naam: string } }) {
  const wijzig = useKlantWijzigen();
  const [bezig, setBezig] = useState(false);
  return (
    <button
      type="button"
      className="db-knop kp-knop-stil"
      disabled={bezig}
      onClick={async () => {
        setBezig(true);
        await wijzig(klant.id, { status: 'lead' }, `${klant.naam} staat weer bij de leads`, {
          label: 'Ongedaan maken',
          onClick: () => void wijzig(klant.id, { status: 'afgewezen' }, `${klant.naam} staat weer onder Afgewezen`)
        });
        setBezig(false);
      }}
    >
      Terug naar leads
    </button>
  );
}
