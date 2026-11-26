'use client';

import { useRef, useState } from 'react';

// "Inzien": de eerstvolgende factuur van een terugkerende factuur als PDF in een venster, precies
// zoals hij op de geplande dag wordt, zonder iets aan te maken of te versturen
// (/api/terugkerend/[id]/voorbeeld). Het nummer erop is het eerstvolgende vrije nummer van nú;
// bij het echte aanmaken krijgt hij het eerstvolgende nummer van dat moment.
export function FactuurInzien({ id, naam, klein = false, label = 'Inzien' }: { id: string; naam: string; klein?: boolean; label?: string }) {
  const venster = useRef<HTMLDialogElement>(null);
  // Elke keer een vers voorbeeld (een gewijzigde prijs of klant zie je meteen terug).
  const [src, setSrc] = useState<string | null>(null);
  const url = `/api/terugkerend/${id}/voorbeeld`;

  function open() {
    setSrc(`${url}?t=${Date.now()}`);
    venster.current?.showModal();
  }
  function sluit() {
    venster.current?.close();
    setSrc(null);
  }

  return (
    <>
      <button type="button" className={`db-knop${klein ? ' db-knop-klein' : ''}`} onClick={open} title="De eerstvolgende factuur bekijken, zonder hem aan te maken of te versturen">
        {label}
      </button>
      <dialog
        ref={venster}
        className="tk-inzien"
        aria-label={`Voorbeeld van de eerstvolgende factuur: ${naam}`}
        onClose={() => setSrc(null)}
        onClick={(e) => {
          if (e.target === venster.current) sluit();
        }}
      >
        <div className="tk-inzien-kop">
          <div>
            <strong>{naam}</strong>
            <span>Voorbeeld van de eerstvolgende factuur. Er wordt niets aangemaakt of verstuurd; het nummer is voorlopig (bij het aanmaken wordt het eerstvolgende nummer van dat moment gebruikt).</span>
          </div>
          <div className="tk-inzien-knoppen">
            {src && (
              <a className="db-knop" href={src} target="_blank" rel="noreferrer">
                Openen in nieuw tabblad
              </a>
            )}
            <button type="button" className="db-knop" onClick={sluit} aria-label="Sluiten">
              Sluiten
            </button>
          </div>
        </div>
        <div className="tk-inzien-pdf">
          <p className="tk-inzien-laden" aria-hidden="true">
            Voorbeeld maken…
          </p>
          {src && <iframe src={src} title={`Voorbeeld ${naam}`} />}
        </div>
      </dialog>
    </>
  );
}
