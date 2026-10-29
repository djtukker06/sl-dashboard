'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { KlantKiezer } from '@/components/agenda/KlantKiezer';
import { ProjectKiezer, type ProjectKeuze } from '@/components/taken/ProjectKiezer';
import type { NotitieSamenvatting } from '@/lib/notities/kern';

export type Koppeling = { klant: NotitieSamenvatting['klant']; project: NotitieSamenvatting['project'] };

// Een notitie koppelen aan een klant (ook een lead) en/of een project, met de bestaande
// kiezers van de taken (zoeken; "+ Nieuw project" kan ook). Een project bij een klant vult de
// klant vanzelf in. De chips linken naar de klant- en projectpagina.
export function Koppelen({
  waarde,
  onWijzig,
  uitgeschakeld = false
}: {
  waarde: Koppeling;
  onWijzig: (k: Koppeling) => void;
  uitgeschakeld?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const doos = useRef<HTMLDivElement>(null);
  const { klant, project } = waarde;

  useEffect(() => {
    if (!open) return;
    function buiten(e: MouseEvent) {
      // De suggestielijsten van de kiezers vallen binnen de doos.
      if (doos.current && !doos.current.contains(e.target as Node)) setOpen(false);
    }
    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', buiten);
    document.addEventListener('keydown', toets);
    return () => {
      document.removeEventListener('mousedown', buiten);
      document.removeEventListener('keydown', toets);
    };
  }, [open]);

  const projectKeuze: ProjectKeuze | null = project
    ? { id: project.id, naam: project.naam, klantId: klant?.id ?? null, klantNaam: klant?.naam ?? null }
    : null;

  return (
    <div className="sp-koppel" ref={doos}>
      {klant && (
        <Link className="ag-chip ag-chip-klant sp-chip" href={`/klanten/${klant.id}`} title={`Naar ${klant.naam}`}>
          {klant.naam}
          {klant.lead && <span className="sp-chip-lead">lead</span>}
        </Link>
      )}
      {project && (
        <Link className="ag-chip tk-chip-project sp-chip" href={`/projecten/${project.id}`} title={`Naar project ${project.naam}`}>
          {project.naam}
        </Link>
      )}
      <button
        type="button"
        className="sp-meta-knop"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={uitgeschakeld}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
        {klant || project ? 'Koppeling' : 'Koppelen'}
      </button>
      {open && (
        <div className="sp-pop sp-koppel-pop" role="dialog" aria-label="Koppelen aan klant of project">
          <div className="ag-label">
            Klant of lead
            <KlantKiezer
              waarde={klant ? { id: klant.id, naam: klant.naam } : null}
              onChange={(k) =>
                onWijzig({
                  klant: k ? { id: k.id, naam: k.naam, lead: false } : null,
                  // Een project van een andere klant past dan niet meer.
                  project: k && project && klant && klant.id !== k.id ? null : project
                })
              }
            />
          </div>
          <div className="ag-label">
            Project
            <ProjectKiezer
              waarde={projectKeuze}
              klant={klant ? { id: klant.id, naam: klant.naam } : null}
              onChange={(p) =>
                onWijzig({
                  project: p ? { id: p.id, naam: p.naam } : null,
                  klant: p?.klantId ? { id: p.klantId, naam: p.klantNaam ?? 'Klant', lead: klant?.id === p.klantId ? klant.lead : false } : klant
                })
              }
            />
          </div>
          {(klant || project) && (
            <button type="button" className="ag-link-knop" onClick={() => onWijzig({ klant: null, project: null })}>
              Koppeling weghalen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
