'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { zoekKlanten, type KlantSuggestie } from '@/lib/agenda/client';

/** Gekozen klant bij een nieuw project; id null = nieuwe klant (wordt bij opslaan aangemaakt). */
export type ProjectKlant = { id: string | null; naam: string } | null;

function netjes(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Klant kiezen bij "+ Project": zoeken in de bestaande klanten (zelfde zoek-API als de
 * facturen, /api/clients/search) en, als de getypte naam nog niet bestaat, onderaan
 * "+ Nieuwe klant ‘X’ aanmaken". Die klant ontstaat pas bij opslaan van het project (de
 * server zoekt dan nog eens hoofdletterongevoelig op naam, dus nooit een dubbele klant) en
 * staat daarna onder Klanten → Actief. `onTekst` geeft de getypte tekst door, zodat
 * "typen en meteen opslaan" ook een klant oplevert.
 */
export function ProjectKlantKiezer({
  waarde,
  onChange,
  onTekst
}: {
  waarde: ProjectKlant;
  onChange: (k: ProjectKlant) => void;
  onTekst?: (t: string) => void;
}) {
  const [tekst, setTekst] = useState('');
  const [lijst, setLijst] = useState<KlantSuggestie[]>([]);
  const [gezocht, setGezocht] = useState('');
  const [open, setOpen] = useState(false);
  const [actief, setActief] = useState(0);
  const lijstId = useId();
  const doos = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = tekst.trim();
    if (!q) return;
    let weg = false;
    const t = setTimeout(async () => {
      const r = await zoekKlanten(q);
      if (!weg) {
        setLijst(r);
        setGezocht(q);
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

  const naam = netjes(tekst);
  // Alleen resultaten van de huidige zoekopdracht tonen (geen verouderde lijst).
  const resultaten = naam && gezocht === tekst.trim() ? lijst : [];
  const bestaat = resultaten.some((k) => netjes(k.company_name).toLowerCase() === naam.toLowerCase());
  const nieuwTonen = !!naam && gezocht === tekst.trim() && !bestaat;
  const opties: ({ soort: 'klant'; klant: KlantSuggestie } | { soort: 'nieuw' })[] = open
    ? [...resultaten.map((klant) => ({ soort: 'klant' as const, klant })), ...(nieuwTonen ? [{ soort: 'nieuw' as const }] : [])]
    : [];

  function zetTekst(t: string) {
    setTekst(t);
    onTekst?.(t);
  }

  function kies(o: (typeof opties)[number]) {
    onChange(o.soort === 'klant' ? { id: o.klant.id, naam: o.klant.company_name } : { id: null, naam });
    zetTekst('');
    setOpen(false);
  }

  if (waarde) {
    return (
      <div className="ag-klant-gekozen">
        <span className="ag-chip ag-chip-klant">{waarde.naam}</span>
        {waarde.id === null && <span className="kp-klant-nieuw">nieuwe klant</span>}
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
        placeholder="Zoek of typ een nieuwe klant…"
        autoComplete="off"
        role="combobox"
        maxLength={200}
        aria-expanded={opties.length > 0}
        aria-controls={lijstId}
        aria-autocomplete="list"
        value={tekst}
        onChange={(e) => {
          zetTekst(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && opties.length) {
            e.stopPropagation();
            setOpen(false);
            return;
          }
          if (e.key === 'Enter' && naam && open && !opties.length) {
            // Nog geen zoekresultaat binnen: niet het formulier versturen; de keuze volgt zo.
            e.preventDefault();
            return;
          }
          if (!opties.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActief((a) => (a + 1) % opties.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActief((a) => (a - 1 + opties.length) % opties.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            kies(opties[actief] ?? opties[0]);
          }
        }}
      />
      {opties.length > 0 && (
        <ul className="ag-suggesties" id={lijstId} role="listbox">
          {opties.map((o, i) => (
            <li key={o.soort === 'klant' ? o.klant.id : 'nieuw'} role="option" aria-selected={i === actief}>
              <button
                type="button"
                className={`ag-suggestie${o.soort === 'nieuw' ? ' kp-suggestie-nieuw' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => kies(o)}
              >
                {o.soort === 'klant' ? (
                  <>
                    {o.klant.company_name}
                    {o.klant.contact_name && <span className="ag-suggestie-sub">t.a.v. {o.klant.contact_name}</span>}
                  </>
                ) : (
                  <>+ Nieuwe klant ‘{naam}’ aanmaken</>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
