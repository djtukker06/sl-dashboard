'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import type { Project, ProjectInvoer } from '@/lib/agenda/types';
import { useToast } from '@/components/agenda/Toast';
import { VoorWieKiezer } from '@/components/taken/VoorWieKiezer';
import { InlineTitel } from './InlineVeld';
import { ProjectKlantKiezer } from './ProjectKlantKiezer';
import { DeadlineBadge } from './ProjectRegels';
import { Voortgang } from './StatusPil';

type Klant = { id: string; naam: string } | null;

function useProjectWijzigen(projectId: string) {
  const router = useRouter();
  const toast = useToast();
  return async (b: ProjectInvoer & { klantNaam?: string }, melding?: string): Promise<Klant | false> => {
    try {
      const r = await agendaApi.wijzigProject(projectId, b);
      if (melding) toast(r.klantAangemaakt ? `Nieuwe klant ${r.klantAangemaakt.naam} aangemaakt en gekoppeld` : melding);
      router.refresh();
      return r.project.klantId ? { id: r.project.klantId, naam: r.project.klantNaam ?? 'Klant' } : null;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Niet gelukt.', { fout: true });
      return false;
    }
  };
}

/** De projectnaam als paginatitel, direct te hernoemen. */
export function ProjectTitel({ id, naam }: { id: string; naam: string }) {
  const wijzig = useProjectWijzigen(id);
  return <InlineTitel key={naam} waarde={naam} label="Projectnaam" max={120} onBewaar={async (v) => (await wijzig({ naam: v }, 'Naam opgeslagen')) !== false} />;
}

/**
 * De gegevens van een project op één regel, allemaal direct bewerkbaar (slaat per veld
 * op): klant, deadline, eigenaren en de voortgang van de taken. De status staat erboven
 * (StatusStappen), de naam is de paginatitel.
 */
export function ProjectKop({ project, vandaag }: { project: Project; vandaag: string }) {
  const wijzig = useProjectWijzigen(project.id);
  const [klant, setKlant] = useState<Klant>(project.klantId ? { id: project.klantId, naam: project.klantNaam ?? 'Klant' } : null);
  const [klantKiezen, setKlantKiezen] = useState(false);
  const [deadline, setDeadline] = useState(project.deadline ?? '');
  const [eigenaren, setEigenaren] = useState(project.eigenaren);

  return (
    <dl className="kp-velden">
      <div className="kp-veld">
        <dt>Klant</dt>
        <dd>
          {klantKiezen ? (
            // Bestaande klant kiezen of een nieuwe naam typen: die klant wordt dan aangemaakt
            // (status actief) en staat daarna onder Klanten.
            <ProjectKlantKiezer
              waarde={klant}
              onChange={async (k) => {
                const oud = klant;
                setKlant(k && k.id ? { id: k.id, naam: k.naam } : null);
                setKlantKiezen(false);
                const r = await wijzig(
                  k ? (k.id ? { klantId: k.id } : { klantNaam: k.naam }) : { klantId: null },
                  k ? `Gekoppeld aan ${k.naam}` : 'Klant losgekoppeld'
                );
                setKlant(r === false ? oud : r);
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
        </dd>
      </div>
      <div className="kp-veld">
        <dt>Deadline</dt>
        <dd className="kp-deadlineveld">
          <input
            className="ag-veld"
            type="date"
            value={deadline}
            aria-label="Deadline"
            onChange={async (e) => {
              const oud = deadline;
              const d = e.target.value;
              setDeadline(d);
              if ((await wijzig({ deadline: d || null })) === false) setDeadline(oud);
            }}
          />
          <DeadlineBadge project={{ deadline: deadline || null, status: project.status }} vandaag={vandaag} />
        </dd>
      </div>
      <div className="kp-veld">
        <dt>Voortgang</dt>
        <dd className="kp-voortgangveld">
          {project.totaalTaken ? (
            <>
              <Voortgang open={project.openTaken} totaal={project.totaalTaken} />
              <span className="kp-zacht">{project.openTaken ? `${project.openTaken} open` : 'alles af'}</span>
            </>
          ) : (
            <span className="kp-zacht">Nog geen taken</span>
          )}
        </dd>
      </div>
      <div className="kp-veld">
        <dt>Eigenaar</dt>
        <dd>
          <VoorWieKiezer
            label="Eigenaar"
            waarde={eigenaren.length ? eigenaren : []}
            onChange={async (ids) => {
              const oud = eigenaren;
              setEigenaren(ids);
              if ((await wijzig({ eigenaren: ids })) === false) setEigenaren(oud);
            }}
          />
        </dd>
      </div>
    </dl>
  );
}
