'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCenten } from '@/lib/boekhouding/kern/geld';
import { korteDatum, type Datum } from '@/lib/boekhouding/kern/periode';
import type { BetaalInfo } from '@/lib/boekhouding/kern/betaalcheck';
import { BetaalFormulier, type BankKeuze } from './BetaalFormulier';

// Betaalstatus in de facturentabel: "Betaald 12 nov 2026", "Deels betaald · nog € …" of
// "Niet betaald". Een klik op een open factuur opent een klein venster om de betaling te boeken.
// Het venster is een <dialog> (bovenste laag), zodat de scrollende tabel hem niet afknipt.
export function BetaalStatus({
  factuurId,
  nummer,
  info,
  rekeningen,
  vandaag
}: {
  factuurId: string;
  nummer: string;
  info: BetaalInfo;
  rekeningen: BankKeuze[];
  vandaag: Datum;
}) {
  const router = useRouter();
  const venster = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  if (info.stand === 'betaald') {
    if (info.totaal === 0) return null;
    return (
      <span className="betaal-pill is-betaald" title="Gekoppeld aan een betaling in de boekhouding">
        {info.betaaldOp ? `Betaald ${korteDatum(info.betaaldOp)}` : 'Betaald'}
      </span>
    );
  }

  const label = info.stand === 'deels' ? `Deels betaald · nog ${formatCenten(Math.abs(info.open))}` : info.open < 0 ? 'Niet terugbetaald' : 'Niet betaald';

  function openen() {
    setOpen(true);
    venster.current?.showModal();
  }
  function sluiten() {
    venster.current?.close();
  }

  return (
    <>
      <button type="button" className={`betaal-pill is-${info.stand}`} onClick={openen} title="Betaling boeken">
        {label}
      </button>
      <dialog ref={venster} className="betaal-venster" aria-labelledby={`betaal-titel-${factuurId}`} onClose={() => setOpen(false)}
        // Klik op de achtergrond (buiten het venster) sluit hem, net als Esc.
        onClick={(e) => {
          if (e.target === e.currentTarget) sluiten();
        }}
      >
        {open && (
          <div className="betaal-venster-inhoud">
            <h3 id={`betaal-titel-${factuurId}`} className="betaal-titel">
              Factuur {nummer} betaald
            </h3>
            <p className="betaal-sub">De betaling komt in de boekhouding (Bank &amp; boekingen) en wordt aan deze factuur gekoppeld.</p>
            <BetaalFormulier
              factuurId={factuurId}
              open={info.open}
              rekeningen={rekeningen}
              vandaag={vandaag}
              onAnnuleer={sluiten}
              onGeboekt={() => {
                sluiten();
                router.refresh();
              }}
            />
          </div>
        )}
      </dialog>
    </>
  );
}
