'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import type { Project, ProjectInvoer } from '@/lib/agenda/types';
import { KlantKiezer } from '@/components/agenda/KlantKiezer';
import { useToast } from '@/components/agenda/Toast';
import { VoorWieKiezer } from '@/components/taken/VoorWieKiezer';

type Klant = { id: string; naam: string } | null;

/** De gegevens van een project, allemaal direct bewerkbaar (slaat per veld op). De status staat erboven (StatusStappen). */
export function ProjectKop({ project }: { project: Project }) {
  const router = useRouter();
  const toast = useToast();
  const [naam, setNaam] = useState(project.naam);
  const [klant, setKlant] = useState<Klant>(project.klantId ? { id: project.klantId, naam: project.klantNaam ?? 'Klant' } : null);
  const [klantKiezen, setKlantKiezen] = useState(false);
  const [deadline, setDeadline] = useState(project.deadline ?? '');
  const [eigenaren, setEigenaren] = useState(project.eigenaren);

  async function bewaar(b: ProjectInvoer, herstel: () => void, melding?: string) {
    try {
      await agendaApi.wijzigProject(project.id, b);
      if (melding) toast(melding);
      router.refresh();
    } catch (e) {
      herstel();
      toast(e instanceof Error ? e.message : 'Niet gelukt.', { fout: true });
    }
  }

  function naamOpslaan() {
    const n = naam.replace(/\s+/g, ' ').trim();
    if (!n) {
      setNaam(project.naam);
      return;
    }
    if (n !== project.naam) void bewaar({ naam: n }, () => setNaam(project.naam), 'Naam opgeslagen');
  }

  return (
    <div className="kp-velden">
      <label className="ag-label kp-veld-breed">
        Naam
        <input
          className="ag-veld kp-naamveld"
          value={naam}
          maxLength={120}
          onChange={(e) => setNaam(e.target.value)}
          onBlur={naamOpslaan}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setNaam(project.naam);
          }}
        />
      </label>
      <label className="ag-label">
        Deadline
        <input
          className="ag-veld"
          type="date"
          value={deadline}
          onChange={(e) => {
            const oud = deadline;
            const d = e.target.value;
            setDeadline(d);
            void bewaar({ deadline: d || null }, () => setDeadline(oud));
          }}
        />
      </label>
      <div className="ag-label">
        <span>Klant</span>
        {klantKiezen ? (
          <KlantKiezer
            waarde={klant}
            onChange={(k) => {
              const oud = klant;
              setKlant(k);
              setKlantKiezen(false);
              void bewaar({ klantId: k?.id ?? null }, () => setKlant(oud), k ? `Gekoppeld aan ${k.naam}` : 'Klant losgekoppeld');
            }}
          />
        ) : (
          <span className="kp-klantregel">
            {klant ? <Link href={`/klanten/${klant.id}`}>{klant.naam}</Link> : <span className="kp-zacht">Geen klant</span>}
            <button type="button" className="kp-linkknop" onClick={() => setKlantKiezen(true)}>
              {klant ? 'Wijzigen' : 'Kiezen'}
            </button>
          </span>
        )}
      </div>
      <div className="ag-label kp-veld-breed">
        <span>Eigenaar</span>
        <VoorWieKiezer
          label="Eigenaar"
          waarde={eigenaren.length ? eigenaren : []}
          onChange={(ids) => {
            const oud = eigenaren;
            setEigenaren(ids);
            void bewaar({ eigenaren: ids }, () => setEigenaren(oud));
          }}
        />
      </div>
    </div>
  );
}
