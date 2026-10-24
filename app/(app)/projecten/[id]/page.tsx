import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { vereisTeamlidPagina, type Teamlid } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isUuid } from '@/lib/agenda/invoer';
import { isNietIngericht, projectPagina } from '@/lib/crm/repo';
import { driveStatus } from '@/lib/drive/koppeling';
import type { DriveStatus } from '@/lib/drive/types';
import { CrmNietIngericht } from '@/components/crm/CrmKop';
import { CrmProviders } from '@/components/crm/CrmProviders';
import { ProjectInhoud } from '@/components/crm/ProjectInhoud';

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

// Projectpagina: naam als titel (inline te hernoemen) met de klant erboven; statusbalk
// (Voorbereiding → Bezig → Wachten op goedkeuring → Afgerond, met sinds wanneer), gegevens
// op één regel (klant, deadline, voortgang, eigenaren; direct bewerkbaar),
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
      <ProjectInhoud project={project} taken={taken} vandaag={vandaag} drive={driveSt} nu={new Date().toISOString()} />
    </CrmProviders>
  );
}
