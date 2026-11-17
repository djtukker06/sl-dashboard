'use client';

import { useState } from 'react';
import { bkApi, BkApiFout } from '@/lib/boekhouding/client';
import { formatCenten, type Centen } from '@/lib/boekhouding/kern/geld';
import type { Datum } from '@/lib/boekhouding/kern/periode';

export type BankKeuze = { id: string; naam: string; standaard: boolean };

/** Gaat af na elke geboekte betaling, zodat het overzicht en de betaalcheck elkaar bijhouden. */
export const BETAALD_EVENT = 'sl-factuur-betaald';

// "Betaald op …": datum (standaard vandaag, niet later) en, bij meer dan één rekening, de
// rekening. Boeken gaat via de boekhouding (POST /api/boekhouding/koppelingen/betaald): die
// maakt de bankregel voor het openstaande bedrag en koppelt hem meteen aan de factuur.
export function BetaalFormulier({
  factuurId,
  open,
  rekeningen,
  vandaag,
  onGeboekt,
  onAnnuleer,
  annuleerLabel = 'Annuleren'
}: {
  factuurId: string;
  open: Centen;
  rekeningen: BankKeuze[];
  vandaag: Datum;
  onGeboekt: () => void;
  onAnnuleer: () => void;
  annuleerLabel?: string;
}) {
  const [datum, setDatum] = useState<Datum>(vandaag);
  const [rekeningId, setRekeningId] = useState(() => (rekeningen.find((x) => x.standaard) ?? rekeningen[0])?.id ?? '');
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const terug = open < 0;

  async function boek(e: React.FormEvent) {
    e.preventDefault();
    if (!datum || datum > vandaag) {
      setFout('Kies een datum tot en met vandaag.');
      return;
    }
    setBezig(true);
    setFout(null);
    try {
      await bkApi('/api/boekhouding/koppelingen/betaald', { method: 'POST', body: { bron: 'factuur', bronId: factuurId, datum, rekeningId: rekeningId || null } });
    } catch (err) {
      // Intussen al betaald geboekt (bv. in een ander tabblad): dan is het doel bereikt.
      if (!(err instanceof BkApiFout && err.code === 'bestaat_al')) {
        setFout((err as Error).message);
        setBezig(false);
        return;
      }
    }
    window.dispatchEvent(new CustomEvent(BETAALD_EVENT, { detail: { id: factuurId } }));
    setBezig(false);
    onGeboekt();
  }

  return (
    <form className="betaal-form" onSubmit={boek}>
      <div className="betaal-form-velden">
        <label className="bh-veld">
          <span className="bh-label">{terug ? 'Terugbetaald op' : 'Betaald op'}</span>
          <input type="date" className="ag-veld" value={datum} max={vandaag} required onChange={(e) => setDatum(e.target.value)} />
        </label>
        {rekeningen.length > 1 && (
          <label className="bh-veld">
            <span className="bh-label">Rekening</span>
            <select className="ag-veld" value={rekeningId} onChange={(e) => setRekeningId(e.target.value)}>
              {rekeningen.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.naam}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {fout && (
        <p className="betaal-fout" role="alert">
          {fout}
        </p>
      )}
      <div className="betaal-form-knoppen">
        <button type="submit" className="db-knop db-knop-primair" disabled={bezig || !datum}>
          {bezig ? 'Bezig…' : `Boeken · ${formatCenten(Math.abs(open))}`}
        </button>
        <button type="button" className="db-knop" onClick={onAnnuleer} disabled={bezig}>
          {annuleerLabel}
        </button>
      </div>
    </form>
  );
}
