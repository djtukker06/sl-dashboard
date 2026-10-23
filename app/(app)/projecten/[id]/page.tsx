import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { vereisTeamlidPagina, type Teamlid } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isUuid } from '@/lib/agenda/invoer';
import { isNietIngericht, projectPagina } from '@/lib/crm/repo';
import { driveStatus } from '@/lib/drive/koppeling';
import type { DriveStatus } from '@/lib/drive/types';
import { BestandenBlok } from '@/components/bestanden/BestandenBlok';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { CrmNietIngericht } from '@/components/crm/CrmKop';
import { CrmProviders } from '@/components/crm/CrmProviders';
import { ProjectKop } from '@/components/crm/ProjectKop';
import { ProjectNotitie } from '@/components/crm/ProjectNotitie';
import { StatusStappen } from '@/components/crm/StatusStappen';
import { Voortgang } from '@/components/crm/StatusPil';
import { TakenBlok } from '@/components/crm/TakenBlok';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Project · Studio Levant' };

async function bestandenStatus(lid: Teamlid): Promise<DriveStatus | null> {
  try {
    return await driveStatus(lid);
  } catch (e) {
    console.error('[bestanden] status', (e as Error)?.message ?? e);
    return null;
  }
}

// Projectpagina: statusbalk (Voorbereiding → Bezig → Wachten op goedkeuring → Afgerond, met
// sinds wanneer), gegevens (naam, klant, deadline, eigenaren; direct bewerkbaar),
// alle taken van het project met voortgang (ook die van een ander: dit is de gedeelde
// werkplek, niet "mijn lijst") en één notitieveld dat vanzelf opslaat.
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lid = await vereisTeamlidPagina(`/projecten/${id}`);
  if (lid.overgang) return <CrmNietIngericht actief="projecten" />;
  if (!isUuid(id)) notFound();

  let data;
  const drive = bestandenStatus(lid);
  try {
    data = await projectPagina(bronVan(lid), id);
  } catch (e) {
    if (isNietIngericht(e)) return <CrmNietIngericht actief="projecten" />;
    throw e;
  }
  if (!data) notFound();
  const { project, taken } = data;
  const vandaag = vandaagNL();
  const driveSt = await drive;

  return (
    <CrmProviders>
      <ModuleKop label={<Link href="/projecten">← Projecten</Link>} titel={project.naam} />
      <div className="kp kp-detail">
        <div className="kp-hoofd">
          <section className="db-kaart" aria-label="Projectgegevens">
            <div className="db-kaart-inhoud">
              <StatusStappen
                key={`${project.id}-${project.status}`}
                projectId={project.id}
                status={project.status}
                statusSinds={project.statusSinds}
                nu={new Date().toISOString()}
              />
              <ProjectKop key={`${project.id}-${project.naam}`} project={project} />
            </div>
          </section>
          <section className="db-kaart" aria-labelledby="kp-taken">
            <header className="db-kaart-kop">
              <h2 id="kp-taken" className="db-label">
                Taken
              </h2>
              <Voortgang open={project.openTaken} totaal={project.totaalTaken} />
            </header>
            <div className="db-kaart-inhoud">
              <TakenBlok
                taken={taken}
                vandaag={vandaag}
                leeg={project.totaalTaken ? 'Alle taken zijn af.' : 'Nog geen taken in dit project.'}
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
          <BestandenBlok status={driveSt} start={{ project: project.id }} />
        </aside>
      </div>
    </CrmProviders>
  );
}
