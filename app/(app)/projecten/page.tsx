import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { projectenLijst } from '@/lib/agenda/repo';
import type { Project } from '@/lib/agenda/types';
import { isNietIngericht } from '@/lib/crm/repo';
import { CrmKop, CrmNietIngericht } from '@/components/crm/CrmKop';
import { CrmProviders } from '@/components/crm/CrmProviders';
import { NieuwProject } from '@/components/crm/NieuwProject';
import { ProjectenBord } from '@/components/crm/ProjectenBord';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Projecten · Studio Levant' };

// Projecten (gedeeld met het team) als bord: Voorbereiding, Bezig, Wachten op goedkeuring
// en Afgerond (laatste 30 dagen), of als compacte lijst op deadline.
//   ?weergave=bord|lijst   kiest de weergave (en onthoudt die), bv. vanaf het dashboard
export default async function ProjectenPage({ searchParams }: { searchParams: Promise<{ weergave?: string }> }) {
  const lid = await vereisTeamlidPagina('/projecten');
  if (lid.overgang) return <CrmNietIngericht actief="projecten" />;

  const sp = await searchParams;
  let projecten: Project[];
  try {
    projecten = await projectenLijst(bronVan(lid), { selectie: 'alle', strikt: true });
  } catch (e) {
    if (isNietIngericht(e)) return <CrmNietIngericht actief="projecten" />;
    throw e;
  }
  const weergave = sp.weergave === 'bord' || sp.weergave === 'lijst' ? sp.weergave : undefined;

  return (
    <CrmProviders>
      <CrmKop actief="projecten">
        <NieuwProject />
      </CrmKop>
      <div className="kp kp-breed">
        {projecten.length === 0 ? (
          <div className="db-melding">
            <p className="db-melding-titel">Nog geen projecten</p>
            <p className="db-melding-tekst">
              Maak een project met “+ Project”, of direct vanuit de taak-popup (veld Project). Een project hangt (optioneel) aan een klant.
            </p>
          </div>
        ) : (
          <ProjectenBord projecten={projecten} vandaag={vandaagNL()} nu={new Date().toISOString()} startWeergave={weergave} />
        )}
      </div>
    </CrmProviders>
  );
}
