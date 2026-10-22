'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import type { Project } from '@/lib/agenda/types';

export type ProjectKeuze = { id: string; naam: string; klantId: string | null; klantNaam: string | null };

/**
 * Project kiezen (combobox). Met een gekozen klant: de projecten van die klant en de
 * projecten zonder klant. "+ Nieuw project ‘X’" maakt het project direct aan (bij de
 * gekozen klant). Een project bij een klant vult een lege klant in (dat doet de ouder
 * via onChange: het gekozen project heeft klantId/klantNaam).
 */
export function ProjectKiezer({
  waarde,
  klant,
  onChange,
  uitgeschakeld = false
}: {
  waarde: ProjectKeuze | null;
  klant: { id: string; naam: string } | null;
  onChange: (p: ProjectKeuze | null) => void;
  uitgeschakeld?: boolean;
}) {
  const [alle, setAlle] = useState<Project[] | null>(null);
  const [laadFout, setLaadFout] = useState('');
  const [tekst, setTekst] = useState('');
  const [open, setOpen] = useState(false);
  const [actief, setActief] = useState(0);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const lijstId = useId();
  const doos = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let weg = false;
    agendaApi
      .projecten('actief')
      .then((r) => !weg && setAlle(r.projecten))
      .catch((e) => !weg && setLaadFout(e instanceof Error ? e.message : 'Projecten niet geladen.'));
    return () => {
      weg = true;
    };
  }, []);

  useEffect(() => {
    function buiten(e: MouseEvent) {
      if (doos.current && !doos.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', buiten);
    return () => document.removeEventListener('mousedown', buiten);
  }, []);

  const q = tekst.trim().toLowerCase();
  const passend = (alle ?? [])
    .filter((p) => !klant || !p.klantId || p.klantId === klant.id)
    .filter((p) => !q || p.naam.toLowerCase().includes(q) || (p.klantNaam ?? '').toLowerCase().includes(q))
    // Projecten van de gekozen klant eerst.
    .sort((a, b) => Number(!!b.klantId) - Number(!!a.klantId) || a.naam.localeCompare(b.naam, 'nl'))
    .slice(0, 8);
  const exact = (alle ?? []).some(
    (p) => p.naam.toLowerCase() === q && (p.klantId ?? null) === (klant?.id ?? null)
  );
  const kanNieuw = q.length > 0 && !exact && !laadFout;
  const opties = passend.length + (kanNieuw ? 1 : 0);
  const zichtbaar = open && (passend.length > 0 || kanNieuw);

  function kies(p: Project) {
    onChange({ id: p.id, naam: p.naam, klantId: p.klantId, klantNaam: p.klantNaam });
    setTekst('');
    setOpen(false);
  }

  async function maakNieuw() {
    const naam = tekst.replace(/\s+/g, ' ').trim();
    if (!naam || bezig) return;
    setBezig(true);
    setFout('');
    try {
      const { project } = await agendaApi.maakProject({ naam, klantId: klant?.id ?? null });
      setAlle((l) => [...(l ?? []), project]);
      kies(project);
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Project aanmaken mislukt.');
    } finally {
      setBezig(false);
    }
  }

  if (waarde) {
    return (
      <div className="ag-klant-gekozen">
        <span className="ag-chip tk-chip-project" title={waarde.klantNaam ? `${waarde.naam} · ${waarde.klantNaam}` : waarde.naam}>
          {waarde.naam}
        </span>
        {!uitgeschakeld && (
          <button type="button" className="ag-link-knop" onClick={() => onChange(null)}>
            Wijzigen
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ag-klant" ref={doos}>
      <input
        type="text"
        className="ag-veld"
        placeholder={laadFout ? 'Projecten niet beschikbaar' : klant ? `Project van ${klant.naam}…` : 'Zoek of maak een project…'}
        autoComplete="off"
        role="combobox"
        aria-expanded={zichtbaar}
        aria-controls={lijstId}
        aria-autocomplete="list"
        disabled={uitgeschakeld || !!laadFout}
        value={tekst}
        maxLength={120}
        onChange={(e) => {
          setTekst(e.target.value);
          setOpen(true);
          setActief(0);
          setFout('');
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!zichtbaar || !opties) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActief((a) => (a + 1) % opties);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActief((a) => (a - 1 + opties) % opties);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (actief < passend.length) kies(passend[actief]);
            else void maakNieuw();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {zichtbaar && (
        <ul className="ag-suggesties" id={lijstId} role="listbox">
          {passend.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === actief}>
              <button type="button" className="ag-suggestie" onMouseDown={(e) => e.preventDefault()} onClick={() => kies(p)}>
                {p.naam}
                {p.klantNaam && <span className="ag-suggestie-sub">{p.klantNaam}</span>}
              </button>
            </li>
          ))}
          {kanNieuw && (
            <li role="option" aria-selected={actief === passend.length}>
              <button
                type="button"
                className="ag-suggestie tk-nieuw-project"
                disabled={bezig}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void maakNieuw()}
              >
                {bezig ? 'Aanmaken…' : `+ Nieuw project ‘${tekst.trim()}’`}
                {klant && <span className="ag-suggestie-sub">bij {klant.naam}</span>}
              </button>
            </li>
          )}
        </ul>
      )}
      {fout && (
        <p className="ag-fout" role="alert">
          {fout}
        </p>
      )}
    </div>
  );
}
