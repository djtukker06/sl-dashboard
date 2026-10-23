'use client';

import { useEffect, useRef, useState } from 'react';
import type { DriveItem } from '@/lib/drive/types';
import { isGoogleDocument, soortVan } from '@/lib/drive/weergave';
import { BsIcoon } from './Iconen';
import { inhoudUrl } from './driveApi';

// Kleine dialogen van Bestanden op basis van <dialog> (Esc sluit, focus blijft erin).

function useModaal(onSluit: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const sluit = useRef(onSluit);
  useEffect(() => {
    sluit.current = onSluit;
  });
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    const opAnnuleer = (e: Event) => {
      e.preventDefault();
      sluit.current();
    };
    d.addEventListener('cancel', opAnnuleer);
    return () => d.removeEventListener('cancel', opAnnuleer);
  }, []);
  return ref;
}

export function BevestigDialoog({
  titel,
  tekst,
  knop,
  gevaar = false,
  onJa,
  onNee
}: {
  titel: string;
  tekst: string;
  knop: string;
  gevaar?: boolean;
  onJa: () => void;
  onNee: () => void;
}) {
  const ref = useModaal(onNee);
  return (
    <dialog ref={ref} className="bs-dialoog" aria-labelledby="bs-bevestig-titel" onClick={(e) => e.target === ref.current && onNee()}>
      <div className="bs-dialoog-inhoud">
        <h2 id="bs-bevestig-titel" className="bs-dialoog-titel">
          {titel}
        </h2>
        <p className="bs-uitleg">{tekst}</p>
        <div className="bs-dialoog-acties">
          <button type="button" className="db-knop" onClick={onNee}>
            Annuleren
          </button>
          <button type="button" className={`db-knop ${gevaar ? 'bs-gevaar-vol' : 'db-knop-primair'}`} onClick={onJa} autoFocus>
            {knop}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function NaamDialoog({
  titel,
  label,
  start = '',
  knop,
  onOk,
  onAnnuleer
}: {
  titel: string;
  label: string;
  start?: string;
  knop: string;
  onOk: (naam: string) => Promise<void>;
  onAnnuleer: () => void;
}) {
  const ref = useModaal(onAnnuleer);
  const [naam, setNaam] = useState(start);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const invoer = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = invoer.current;
    if (!el) return;
    el.focus();
    // Bij hernoemen: alleen de naam zonder extensie selecteren.
    const punt = start.lastIndexOf('.');
    el.setSelectionRange(0, punt > 0 ? punt : start.length);
  }, [start]);

  async function verstuur(e: React.FormEvent) {
    e.preventDefault();
    if (!naam.trim()) return;
    setBezig(true);
    setFout(null);
    try {
      await onOk(naam.trim());
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Niet gelukt.');
      setBezig(false);
    }
  }

  return (
    <dialog ref={ref} className="bs-dialoog" aria-labelledby="bs-naam-titel" onClick={(e) => e.target === ref.current && onAnnuleer()}>
      <form className="bs-dialoog-inhoud" onSubmit={verstuur}>
        <h2 id="bs-naam-titel" className="bs-dialoog-titel">
          {titel}
        </h2>
        <label className="bs-veldlabel">
          {label}
          <input ref={invoer} className="ag-veld" value={naam} maxLength={200} onChange={(e) => setNaam(e.target.value)} />
        </label>
        {fout && (
          <p className="bs-fouttekst" role="alert">
            {fout}
          </p>
        )}
        <div className="bs-dialoog-acties">
          <button type="button" className="db-knop" onClick={onAnnuleer}>
            Annuleren
          </button>
          <button type="submit" className="db-knop db-knop-primair" disabled={bezig || !naam.trim()}>
            {bezig ? 'Bezig…' : knop}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Voorbeeld van een afbeelding of PDF (Google-documenten als PDF), via de proxy-route. */
export function Voorbeeld({ item, onSluit }: { item: DriveItem; onSluit: () => void }) {
  const ref = useModaal(onSluit);
  const soort = soortVan(item.mime, item.naam);
  const url = inhoudUrl(item.id);
  return (
    <dialog ref={ref} className="bs-dialoog bs-voorbeeld" aria-label={`Voorbeeld van ${item.naam}`} onClick={(e) => e.target === ref.current && onSluit()}>
      <div className="bs-voorbeeld-kop">
        <p className="bs-voorbeeld-naam" title={item.naam}>
          {item.naam}
        </p>
        <a className="db-knop" href={inhoudUrl(item.id, true)} download>
          <BsIcoon naam="download" grootte={16} /> Downloaden
        </a>
        {item.link && (
          <a className="db-knop" href={item.link} target="_blank" rel="noopener noreferrer" title="Alleen voor wie met het Google-account van Studio Levant is ingelogd">
            <BsIcoon naam="extern" grootte={16} /> Open in Google Drive
          </a>
        )}
        <button type="button" className="bs-icoonknop" aria-label="Sluiten" onClick={onSluit}>
          <BsIcoon naam="sluit" />
        </button>
      </div>
      <div className="bs-voorbeeld-vlak">
        {soort === 'afbeelding' ? (
          // eslint-disable-next-line @next/next/no-img-element -- bestand uit Drive via de eigen proxy
          <img src={url} alt={item.naam} />
        ) : (
          <iframe src={url} title={item.naam} />
        )}
      </div>
      {isGoogleDocument(item.mime) && <p className="bs-uitleg bs-voorbeeld-voet">Google-document, getoond als PDF.</p>}
    </dialog>
  );
}
