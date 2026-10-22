'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { zoekKlanten, type KlantSuggestie } from '@/lib/agenda/client';

// Klant kiezen uit de bestaande klanten (zelfde zoek-API als de klant-combobox van
// facturen: /api/clients/search). Alleen bestaande klanten; nieuwe klanten ontstaan in facturen.
export function KlantKiezer({
  waarde,
  onChange
}: {
  waarde: { id: string; naam: string } | null;
  onChange: (k: { id: string; naam: string } | null) => void;
}) {
  const [tekst, setTekst] = useState('');
  const [lijst, setLijst] = useState<KlantSuggestie[]>([]);
  const [open, setOpen] = useState(false);
  const [actief, setActief] = useState(0);
  const lijstId = useId();
  const doos = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tekst.trim()) return;
    let weg = false;
    const t = setTimeout(async () => {
      const r = await zoekKlanten(tekst);
      if (!weg) {
        setLijst(r);
        setActief(0);
      }
    }, 180);
    return () => {
      weg = true;
      clearTimeout(t);
    };
  }, [tekst]);

  useEffect(() => {
    function buiten(e: MouseEvent) {
      if (doos.current && !doos.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', buiten);
    return () => document.removeEventListener('mousedown', buiten);
  }, []);

  const zichtbaar = open && tekst.trim() ? lijst : [];

  function kies(k: KlantSuggestie) {
    onChange({ id: k.id, naam: k.company_name });
    setTekst('');
    setOpen(false);
  }

  if (waarde) {
    return (
      <div className="ag-klant-gekozen">
        <span className="ag-chip ag-chip-klant">{waarde.naam}</span>
        <button type="button" className="ag-link-knop" onClick={() => onChange(null)}>
          Wijzigen
        </button>
      </div>
    );
  }

  return (
    <div className="ag-klant" ref={doos}>
      <input
        type="text"
        className="ag-veld"
        placeholder="Zoek een klant…"
        autoComplete="off"
        role="combobox"
        aria-expanded={zichtbaar.length > 0}
        aria-controls={lijstId}
        aria-autocomplete="list"
        value={tekst}
        onChange={(e) => {
          setTekst(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!zichtbaar.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActief((a) => (a + 1) % zichtbaar.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActief((a) => (a - 1 + zichtbaar.length) % zichtbaar.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            kies(zichtbaar[actief] ?? zichtbaar[0]);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {zichtbaar.length > 0 && (
        <ul className="ag-suggesties" id={lijstId} role="listbox">
          {zichtbaar.map((k, i) => (
            <li key={k.id} role="option" aria-selected={i === actief}>
              <button
                type="button"
                className="ag-suggestie"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => kies(k)}
              >
                {k.company_name}
                {k.contact_name && <span className="ag-suggestie-sub">t.a.v. {k.contact_name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
