'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Project, ProjectStatus } from '@/lib/agenda/types';
import { VoorWieKiezer } from '@/components/taken/VoorWieKiezer';
import { useTeam } from '@/components/team/TeamProvider';
import { CrmDialoog, crmApi } from './CrmDialoog';
import { ProjectKlantKiezer, type ProjectKlant } from './ProjectKlantKiezer';

type Klant = { id: string; naam: string } | null;

/**
 * "+ Project": naam, klant, status (standaard Voorbereiding), deadline (optioneel) en
 * eigenaar(s) (standaard jij). Na opslaan ga je naar de projectpagina. Een nieuw project
 * bij een afgeronde klant zet die klant weer op Actief (de server doet dat; de popup
 * zegt het vooraf). Een klantnaam die nog niet bestaat ("+ Nieuwe klant ‘X’ aanmaken", of
 * gewoon getypt en opslaan) wordt bij opslaan een nieuwe actieve klant met dit project; de
 * server voorkomt dubbelen (hoofdletterongevoelig op naam).
 */
export function NieuwProject({
  klant: vasteKlant = null,
  klasse = 'db-knop db-knop-primair',
  label = '+ Project',
  klantAfgerond = false
}: {
  klant?: Klant;
  klasse?: string;
  label?: string;
  /** De vaste klant staat op afgerond. */
  klantAfgerond?: boolean;
}) {
  const router = useRouter();
  const { mijnId } = useTeam();
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState('');
  const [klant, setKlant] = useState<ProjectKlant>(vasteKlant);
  const [klantTekst, setKlantTekst] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('voorbereiding');
  const [deadline, setDeadline] = useState('');
  const [eigenaren, setEigenaren] = useState<string[]>([mijnId]);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');

  function openen() {
    setNaam('');
    setKlant(vasteKlant);
    setKlantTekst('');
    setStatus('voorbereiding');
    setDeadline('');
    setEigenaren([mijnId]);
    setFout('');
    setOpen(true);
  }

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    if (!naam.trim()) {
      setFout('Geef het project een naam.');
      return;
    }
    setBezig(true);
    setFout('');
    try {
      // Getypt maar niet gekozen: die naam (bestaande klant of een nieuwe).
      const gekozen = klant ?? (klantTekst.trim() ? { id: null, naam: klantTekst.replace(/\s+/g, ' ').trim() } : null);
      const { project } = await crmApi<{ project: Project }>('/api/projecten', 'POST', {
        naam,
        klantId: gekozen?.id ?? null,
        ...(gekozen && !gekozen.id ? { klantNaam: gekozen.naam } : {}),
        status,
        deadline: deadline || null,
        eigenaren
      });
      router.push(`/projecten/${project.id}`);
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan mislukt.');
      setBezig(false);
    }
  }

  return (
    <>
      <button type="button" className={klasse} onClick={openen}>
        {label}
      </button>
      {open && (
        <CrmDialoog titel="Nieuw project" onSluit={() => setOpen(false)}>
          <form className="kp-form" onSubmit={opslaan} noValidate>
            <label className="ag-label">
              Naam
              <input className="ag-veld" value={naam} maxLength={120} placeholder="Bijv. Huisstijl 2027" onChange={(e) => setNaam(e.target.value)} />
            </label>
            <div className="ag-label">
              <span>Klant (optioneel)</span>
              <ProjectKlantKiezer waarde={klant} onChange={setKlant} onTekst={setKlantTekst} />
            </div>
            <div className="kp-form-rij">
              <div className="ag-label">
                <span>Status</span>
                <div className="ag-segment" role="group" aria-label="Status">
                  {(['voorbereiding', 'bezig'] as const).map((s) => (
                    <button key={s} type="button" aria-pressed={status === s} className={status === s ? 'is-aan' : ''} onClick={() => setStatus(s)}>
                      {s === 'voorbereiding' ? 'Voorbereiding' : 'Bezig'}
                    </button>
                  ))}
                </div>
              </div>
              <label className="ag-label">
                Deadline (optioneel)
                <input className="ag-veld" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </label>
            </div>
            <div className="ag-label">
              <span>Eigenaar</span>
              <VoorWieKiezer waarde={eigenaren} onChange={setEigenaren} label="Eigenaar" />
            </div>
            {klantAfgerond && klant?.id === vasteKlant?.id && (
              <p className="kp-uitleg">{vasteKlant?.naam} staat op afgerond; met dit project wordt de klant weer Actief.</p>
            )}
            {klant && klant.id === null && (
              <p className="kp-uitleg">
                <strong>{klant.naam}</strong> wordt bij opslaan een nieuwe klant (Actief) met dit project.
              </p>
            )}
            {fout && (
              <p className="ag-fout" role="alert">
                {fout}
              </p>
            )}
            <div className="kp-form-acties">
              <button type="button" className="db-knop" onClick={() => setOpen(false)}>
                Annuleren
              </button>
              <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
                {bezig ? 'Bezig…' : 'Project maken'}
              </button>
            </div>
          </form>
        </CrmDialoog>
      )}
    </>
  );
}
