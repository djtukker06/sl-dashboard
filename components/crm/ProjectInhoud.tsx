import Link from 'next/link';
import type { Project, Taak } from '@/lib/agenda/types';
import type { DriveStatus } from '@/lib/drive/types';
import { BestandenBlok } from '@/components/bestanden/BestandenBlok';
import { NotitiesBlok } from '@/components/notities/NotitiesBlok';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { ProjectKop, ProjectTitel } from './ProjectKop';
import { ProjectNotitie } from './ProjectNotitie';
import { StatusStappen } from './StatusStappen';
import { TakenBlok } from './TakenBlok';

/** De projectpagina zelf (zonder data ophalen): kop, status en gegevens, taken, notities, Scratchpad, bestanden. */
export function ProjectInhoud({ project, taken, vandaag, drive, nu }: { project: Project; taken: Taak[]; vandaag: string; drive: DriveStatus | null; nu: string }) {
  return (
    <>
      <ModuleKop
        label={
          <>
            <Link href="/projecten">← Projecten</Link>
            {project.klantId && (
              <>
                <span aria-hidden="true"> · </span>
                <Link href={`/klanten/${project.klantId}`}>{project.klantNaam ?? 'Klant'}</Link>
              </>
            )}
          </>
        }
        titel={<ProjectTitel id={project.id} naam={project.naam} />}
      />
      <div className="kp kp-detail">
        <section className="db-kaart kp-projectkop" aria-label="Status en gegevens">
          <div className="db-kaart-inhoud">
            <StatusStappen
              key={`${project.id}-${project.status}`}
              projectId={project.id}
              status={project.status}
              statusSinds={project.statusSinds}
              nu={nu}
            />
            <ProjectKop key={`${project.id}-${project.klantId}-${project.deadline}`} project={project} vandaag={vandaag} />
          </div>
        </section>
        <div className="kp-hoofd">
          <section className="db-kaart" aria-labelledby="kp-taken">
            <header className="db-kaart-kop">
              <h2 id="kp-taken" className="db-label">
                Taken
              </h2>
              <span className="kp-kop-teller">{project.totaalTaken ? `${project.totaalTaken - project.openTaken} van ${project.totaalTaken} klaar` : ''}</span>
            </header>
            <div className="db-kaart-inhoud">
              <TakenBlok
                taken={taken}
                vandaag={vandaag}
                leeg={project.totaalTaken ? 'Alle taken zijn af.' : 'Nog geen taken. Zet het werk op een rij met “+ Taak” (of n).'}
                standaard={{ project: { id: project.id, naam: project.naam, klantId: project.klantId, klantNaam: project.klantNaam } }}
              />
            </div>
          </section>
        </div>
        <aside className="kp-zij">
          <section className="db-kaart" aria-labelledby="kp-notitie">
            <header className="db-kaart-kop">
              <h2 id="kp-notitie" className="db-label">
                Notities
              </h2>
            </header>
            <div className="db-kaart-inhoud">
              <ProjectNotitie projectId={project.id} start={project.notitie} />
            </div>
          </section>
          <NotitiesBlok koppeling={{ project: project.id }} />
          <BestandenBlok status={drive} start={{ project: project.id }} />
        </aside>
      </div>
    </>
  );
}
