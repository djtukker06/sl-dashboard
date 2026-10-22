'use client';

import { useId, useMemo, useState } from 'react';
import { adresVol } from '@/lib/mail/client';
import type { Adres } from '@/lib/mail/types';

// Adresveld (Aan/Cc/Bcc): gewone tekst met komma's, plus suggesties uit recente
// afzenders en ontvangers voor het adres dat je nu typt. ↑/↓ kiezen, Enter/Tab invullen.
export function AdresVeld({
  label,
  waarde,
  onChange,
  suggesties,
  autoFocus,
  inputRef
}: {
  label: string;
  waarde: string;
  onChange: (v: string) => void;
  suggesties: Adres[];
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [actief, setActief] = useState(0);

  // Het stuk na de laatste komma is wat je nu typt.
  const laatsteKomma = Math.max(waarde.lastIndexOf(','), waarde.lastIndexOf(';'));
  const huidig = waarde.slice(laatsteKomma + 1).trim().toLowerCase();

  const treffers = useMemo(() => {
    if (huidig.length < 1) return [];
    const al = new Set(
      waarde
        .toLowerCase()
        .split(/[,;]/)
        .map((s) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim())
    );
    return suggesties
      .filter(
        (a) =>
          !al.has(a.adres) &&
          (a.adres.toLowerCase().includes(huidig) || a.naam.toLowerCase().split(/\s+/).some((w) => w.startsWith(huidig)) || a.naam.toLowerCase().startsWith(huidig))
      )
      .slice(0, 6);
  }, [huidig, suggesties, waarde]);

  const toon = open && treffers.length > 0;

  const kies = (a: Adres) => {
    const voor = laatsteKomma >= 0 ? waarde.slice(0, laatsteKomma + 1) + ' ' : '';
    onChange(`${voor}${adresVol(a)}, `);
    setOpen(false);
    setActief(0);
  };

  return (
    <div className="ml-veld-rij">
      <label className="ml-veld-label" htmlFor={id}>
        {label}
      </label>
      <div className="ml-adres">
        <input
          id={id}
          ref={inputRef}
          className="ml-veld"
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={waarde}
          role="combobox"
          aria-expanded={toon}
          aria-controls={`${id}-lijst`}
          aria-autocomplete="list"
          aria-activedescendant={toon ? `${id}-${actief}` : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActief(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!toon) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActief((i) => (i + 1) % treffers.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActief((i) => (i - 1 + treffers.length) % treffers.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              if (e.key === 'Enter' || huidig) {
                e.preventDefault();
                kies(treffers[actief]);
              }
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {toon && (
          <ul className="ml-suggesties" id={`${id}-lijst`} role="listbox" aria-label={`Suggesties voor ${label}`}>
            {treffers.map((a, i) => (
              <li
                key={a.adres}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === actief}
                className="ml-suggestie"
                onMouseDown={(e) => {
                  e.preventDefault();
                  kies(a);
                }}
                onMouseEnter={() => setActief(i)}
              >
                <span className="ml-suggestie-naam">{a.naam || a.adres}</span>
                {a.naam && <span className="ml-suggestie-adres">{a.adres}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
