import type { Metadata } from 'next';
import Link from 'next/link';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { dagTekst, vandaag as vandaagNL } from '@/lib/agenda/datum';
import { projectenLijst } from '@/lib/agenda/repo';
import type { Project, ProjectStatus } from '@/lib/agenda/types';
import { isNietIngericht } from '@/lib/crm/repo';
import { Persoon } from '@/components/team/Persoon';
import { CrmKop, CrmNietIngericht } from '@/components/crm/CrmKop';
import { CrmProviders } from '@/components/crm/CrmProviders';
import { NieuwProject } from '@/components/crm/NieuwProject';
import { Voortgang } from '@/components/crm/StatusPil';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Projecten · Studio Levant' };

const GROEPEN: [ProjectStatus, string][] = [
  ['bezig', 'Bezig'],
  ['gepland', 'Gepland'],
  ['afgerond', 'Afgerond']
];

// Projecten (gedeeld met het team): Bezig, Gepland en (ingeklapt) Afgerond, met klant,
// eigenaar(s), deadline en voortgang van de taken.
export default async function ProjectenPage() {
  const lid = await vereisTeamlidPagina('/projecten');
  if (lid.overgang) return <CrmNietIngericht actief="projecten" />;

  let projecten: Project[];
  try {
    projecten = await projectenLijst(bronVan(lid), { selectie: 'alle', strikt: true });
  } catch (e) {
    if (isNietIngericht(e)) return <CrmNietIngericht actief="projecten" />;
    throw e;
  }
  const vandaag = vandaagNL();
  // Eerstvolgende deadline eerst; zonder deadline achteraan (op naam).
  const volgorde = (a: Project, b: Project) =>
    (a.deadline ?? '9999') < (b.deadline ?? '9999') ? -1 : (a.deadline ?? '9999') > (b.deadline ?? '9999') ? 1 : a.naam.localeCompare(b.naam, 'nl');

  return (
    <CrmProviders>
      <CrmKop actief="projecten">
        <NieuwProject />
      </CrmKop>
      <div className="kp">
        {projecten.length === 0 ? (
          <div className="db-melding">
            <p className="db-melding-titel">Nog geen projecten</p>
            <p className="db-melding-tekst">
              Maak een project met “+ Project”, of direct vanuit de taak-popup (veld Project). Een project hangt (optioneel) aan een klant.
            </p>
          </div>
        ) : (
          GROEPEN.map(([status, titel]) => {
            const lijst = projecten.filter((p) => p.status === status).sort(volgorde);
            if (!lijst.length) return null;
            const inhoud = (
              <ul className="kp-lijst">
                {lijst.map((p) => (
                  <li key={p.id}>
                    <Link className={`kp-rij kp-rij-project${p.status === 'afgerond' ? ' is-af' : ''}`} href={`/projecten/${p.id}`}>
                      <span className="kp-rij-hoofd">
                        <span className="kp-rij-titel">{p.naam}</span>
                        <span className="kp-rij-sub">{p.klantNaam ?? 'Zonder klant'}</span>
                      </span>
                      <span className="kp-rij-meta">
                        <span className="kp-eigenaren">
                          {p.eigenaren.map((u) => (
                            <Persoon key={u} id={u} compact voorvoegsel="eigenaar" />
                          ))}
                        </span>
                        {p.deadline && (
                          <span className={p.status !== 'afgerond' && p.deadline < vandaag ? 'is-telaat' : ''}>{dagTekst(p.deadline, vandaag)}</span>
                        )}
                        <Voortgang open={p.openTaken} totaal={p.totaalTaken} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            );
            return status === 'afgerond' ? (
              <details key={status} className="kp-groep kp-klaar">
                <summary className="kp-groep-kop">
                  {titel} <span>{lijst.length}</span>
                </summary>
                {inhoud}
              </details>
            ) : (
              <section key={status} className="kp-groep" aria-label={titel}>
                <h2 className="kp-groep-kop">
                  {titel} <span>{lijst.length}</span>
                </h2>
                {inhoud}
              </section>
            );
          })
        )}
      </div>
    </CrmProviders>
  );
}
