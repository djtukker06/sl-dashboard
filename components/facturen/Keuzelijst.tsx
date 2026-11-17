'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface KeuzeOptie<T extends string | number> {
  waarde: T;
  label: string;
  /** Kleine tweede regel, bijv. het e-mailadres van een inbox. */
  sub?: string;
}

// Een eigen keuzelijst in plaats van <select>: dezelfde look als de invoervelden (geen
// systeempijltje dat er buiten valt), een lijst eronder in de stijl van de klant-combobox.
// Toetsenbord: Enter/spatie/↓ opent, ↑/↓ kiest, Enter bevestigt, Esc sluit, typen springt naar
// de eerste optie die zo begint.
export function Keuzelijst<T extends string | number>({
  waarde,
  opties,
  onChange,
  label,
  leeg = 'Kies…'
}: {
  waarde: T | '';
  opties: KeuzeOptie<T>[];
  onChange: (w: T) => void;
  label: string;
  leeg?: string;
}) {
  const [open, setOpen] = useState(false);
  const [actief, setActief] = useState(0);
  const doos = useRef<HTMLDivElement>(null);
  const lijst = useRef<HTMLUListElement>(null);
  const knop = useRef<HTMLButtonElement>(null);
  const id = useId();
  const gekozen = opties.find((o) => o.waarde === waarde);

  useEffect(() => {
    if (!open) return;
    const buiten = (e: MouseEvent) => {
      if (doos.current && !doos.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', buiten);
    return () => document.removeEventListener('mousedown', buiten);
  }, [open]);

  useEffect(() => {
    if (open) lijst.current?.querySelector<HTMLElement>(`[data-index="${actief}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, actief]);

  function openen() {
    setActief(Math.max(0, opties.findIndex((o) => o.waarde === waarde)));
    setOpen(true);
  }

  function kies(i: number) {
    const o = opties[i];
    if (!o) return;
    onChange(o.waarde);
    setOpen(false);
    knop.current?.focus();
  }

  function toets(e: React.KeyboardEvent) {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openen();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActief((a) => Math.min(opties.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActief((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      kies(actief);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1) {
      const i = opties.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActief(i);
    }
  }

  return (
    <div className="keuzelijst" ref={doos}>
      <button
        ref={knop}
        type="button"
        className={`keuzelijst-knop${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openen())}
        onKeyDown={toets}
      >
        <span className={gekozen ? 'keuzelijst-waarde' : 'keuzelijst-waarde is-leeg'}>
          {gekozen ? gekozen.label : leeg}
          {gekozen?.sub && <span className="keuzelijst-sub"> · {gekozen.sub}</span>}
        </span>
        <svg className="keuzelijst-pijl" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="combobox-lijst keuzelijst-lijst" role="listbox" id={id} ref={lijst} aria-label={label}>
          {opties.map((o, i) => (
            <li
              key={String(o.waarde)}
              role="option"
              data-index={i}
              aria-selected={o.waarde === waarde}
              className={`combobox-optie${i === actief ? ' is-actief' : ''}${o.waarde === waarde ? ' is-gekozen' : ''}`}
              onMouseEnter={() => setActief(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => kies(i)}
            >
              {o.label}
              {o.sub && <span className="sub">{o.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
