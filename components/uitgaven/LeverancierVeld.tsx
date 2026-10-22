'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { categorieLabel, type Leverancier } from '@/lib/uitgaven/model';

/** Leverancier met autocomplete op eerder gebruikte leveranciers (meest gebruikt eerst). */
export function LeverancierVeld({
  waarde,
  leveranciers,
  onChange,
  onKies,
  className
}: {
  waarde: string;
  leveranciers: Leverancier[];
  onChange: (v: string) => void;
  /** Gekozen uit de lijst (of exact getypt en het veld verlaten). */
  onKies: (l: Leverancier) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [actief, setActief] = useState(0);
  const lijstId = useId();
  const veld = useRef<HTMLInputElement>(null);

  const suggesties = useMemo(() => {
    const q = waarde.trim().toLowerCase();
    if (!q) return [];
    const begint = leveranciers.filter((l) => l.naam.toLowerCase().startsWith(q));
    const bevat = leveranciers.filter((l) => !l.naam.toLowerCase().startsWith(q) && l.naam.toLowerCase().includes(q));
    const alles = [...begint, ...bevat];
    // Precies de getypte naam: geen lijst meer nodig.
    return alles.length === 1 && alles[0].naam.toLowerCase() === q ? [] : alles.slice(0, 8);
  }, [waarde, leveranciers]);
  const zichtbaar = open ? suggesties : [];

  function kies(l: Leverancier) {
    onChange(l.naam);
    onKies(l);
    setOpen(false);
  }

  return (
    <div className="ag-klant">
      <input
        ref={veld}
        type="text"
        className={className ?? 'ag-veld'}
        value={waarde}
        maxLength={200}
        placeholder="Bijv. Adobe, NS, Albert Heijn"
        autoComplete="off"
        role="combobox"
        aria-expanded={zichtbaar.length > 0}
        aria-controls={lijstId}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActief(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          const exact = leveranciers.find((l) => l.naam.toLowerCase() === waarde.trim().toLowerCase());
          if (exact) onKies(exact);
        }}
        onKeyDown={(e) => {
          if (!zichtbaar.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActief((a) => (a + 1) % zichtbaar.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActief((a) => (a - 1 + zichtbaar.length) % zichtbaar.length);
          } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            kies(zichtbaar[actief] ?? zichtbaar[0]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {zichtbaar.length > 0 && (
        <ul className="ag-suggesties" id={lijstId} role="listbox">
          {zichtbaar.map((l, i) => (
            <li key={l.naam} role="option" aria-selected={i === actief}>
              <button type="button" className="ag-suggestie" onMouseDown={(e) => e.preventDefault()} onClick={() => kies(l)}>
                {l.naam}
                <span className="ag-suggestie-sub">
                  {[categorieLabel(l.categorie), `${l.aantal}×`].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
