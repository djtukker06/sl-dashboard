'use client';

import { useEffect, useRef, useState } from 'react';

export interface ClientSuggestion {
  id: string;
  company_name: string;
  contact_name: string | null;
  address: string | null;
  postal_code: string | null;
  email?: string | null;
}

interface ClientComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onSelectClient: (client: ClientSuggestion) => void;
  required?: boolean;
  label?: string;
}

export function ClientCombobox({
  value,
  onChange,
  onSelectClient,
  required = true,
  label = 'Bedrijfsnaam klant'
}: ClientComboboxProps) {
  const [suggesties, setSuggesties] = useState<ClientSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [actief, setActief] = useState(-1);
  const containerRef = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    if (value.trim().length === 0) {
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/clients/search?q=${encodeURIComponent(value.trim())}`);
      if (!res.ok) return;
      const data: ClientSuggestion[] = await res.json();
      setSuggesties(data);
      setActief(-1);
    }, 200);
    return () => clearTimeout(timer);
  }, [value]);

  // Afgeleid i.p.v. apart bijgehouden: zodra het veld leeg is, zijn er per definitie
  // geen suggesties te tonen, ongeacht wat de laatste fetch nog in state had staan.
  const zichtbareSuggesties = value.trim().length === 0 ? [] : suggesties;

  useEffect(() => {
    function onClickBuiten(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickBuiten);
    return () => document.removeEventListener('mousedown', onClickBuiten);
  }, []);

  return (
    <label ref={containerRef}>
      {label}
      <input
        type="text"
        name="klantBedrijfsnaam"
        required={required}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          // Pijltjes kiezen een suggestie, Enter neemt hem over (en verstuurt het formulier niet), Esc sluit.
          if (!open || zichtbareSuggesties.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActief((a) => Math.min(zichtbareSuggesties.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActief((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && actief >= 0) {
            e.preventDefault();
            onSelectClient(zichtbareSuggesties[actief]);
            setOpen(false);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && zichtbareSuggesties.length > 0 && (
        <div className="combobox-lijst">
          {zichtbareSuggesties.map((klant, i) => (
            <button
              key={klant.id}
              type="button"
              className={`combobox-optie${i === actief ? ' is-actief' : ''}`}
              onClick={() => {
                onSelectClient(klant);
                setOpen(false);
              }}
            >
              {klant.company_name}
              {klant.contact_name && <span className="sub">t.a.v. {klant.contact_name}</span>}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}
