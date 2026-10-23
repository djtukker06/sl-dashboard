'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import type { ProjectStatus } from '@/lib/agenda/types';
import { KlantKiezer } from '@/components/agenda/KlantKiezer';
import { VoorWieKiezer } from '@/components/taken/VoorWieKiezer';
import { useTeam } from '@/components/team/TeamProvider';
import { CrmDialoog } from './CrmDialoog';

type Klant = { id: string; naam: string } | null;

/**
 * "+ Project": naam, klant, status (standaard Voorbereiding), deadline (optioneel) en
 * eigenaar(s) (standaard jij). Na opslaan ga je naar de projectpagina. Een nieuw project
 * bij een afgeronde klant zet die klant weer op Actief (de server doet dat; de popup
 * zegt het vooraf).
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
  const [klant, setKlant] = useState<Klant>(vasteKlant);
  const [status, setStatus] = useState<ProjectStatus>('voorbereiding');
  const [deadline, setDeadline] = useState('');
  const [eigenaren, setEigenaren] = useState<string[]>([mijnId]);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');

  function openen() {
    setNaam('');
    setKlant(vasteKlant);
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
      const { project } = await agendaApi.maakProject({
        naam,
        klantId: klant?.id ?? null,
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
              <KlantKiezer waarde={klant} onChange={setKlant} />
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
