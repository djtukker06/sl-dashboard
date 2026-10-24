import Link from 'next/link';
import { dagTekst } from '@/lib/agenda/datum';
import type { Project } from '@/lib/agenda/types';
import { deadlineStand } from '@/lib/crm/projectstatus';
import { Persoon } from '@/components/team/Persoon';
import { StatusPil, Voortgang } from './StatusPil';

/** Deadline als badge: rood = te laat, oker = binnen 7 dagen, anders rustig. Zonder deadline: niets (of `leeg`). */
export function DeadlineBadge({ project, vandaag, leeg }: { project: Pick<Project, 'deadline' | 'status'>; vandaag: string; leeg?: string }) {
  const stand = deadlineStand(project.deadline, vandaag, project.status);
  if (!project.deadline || !stand) return leeg ? <span className="kp-badge is-geen">{leeg}</span> : null;
  const tekst = stand === 'telaat' ? `te laat · ${dagTekst(project.deadline, vandaag)}` : dagTekst(project.deadline, vandaag);
  return (
    <span className={`kp-badge is-${stand === 'later' ? 'later' : stand}`} title={`Deadline ${project.deadline}`}>
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      {tekst}
    </span>
  );
}

export function Eigenaren({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <span className="kp-eigenaren">
      {ids.map((u) => (
        <Persoon key={u} id={u} compact voorvoegsel="eigenaar" />
      ))}
    </span>
  );
}

/** Compacte projectregels (klantpagina): naam + deadline, voortgang, eigenaren en status. */
export function ProjectRegels({ projecten, vandaag }: { projecten: Project[]; vandaag: string }) {
  return (
    <ul className="kp-lijst kp-lijst-compact kp-projregels">
      {projecten.map((p) => (
        <li key={p.id}>
          <Link className={`kp-rij${p.status === 'afgerond' ? ' is-af' : ''}`} href={`/projecten/${p.id}`}>
            <span className="kp-rij-hoofd">
              <span className="kp-rij-titel">{p.naam}</span>
              <span className="kp-rij-badges">
                <DeadlineBadge project={p} vandaag={vandaag} />
                {p.totaalTaken > 0 && <Voortgang open={p.openTaken} totaal={p.totaalTaken} />}
              </span>
            </span>
            <span className="kp-rij-meta">
              <Eigenaren ids={p.eigenaren} />
              <StatusPil status={p.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
