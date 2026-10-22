import type { Metadata } from 'next';
import Link from 'next/link';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { ProjectenApp } from '@/components/taken/ProjectenApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Projecten · Studio Levant' };

// Projecten: een simpele lijst om taken aan te koppelen (optioneel per klant). Aanmaken,
// hernoemen, klant koppelen, archiveren en terugzetten. Gedeeld met het hele team.
export default async function ProjectenPage() {
  const lid = await vereisTeamlidPagina('/agenda/projecten');

  if (lid.overgang) {
    return (
      <>
        <ModuleKop label="Planning" titel="Projecten" />
        <div className="ag-setup">
          <div className="db-melding db-melding-setup">
            <p className="db-melding-titel">Projecten nog niet ingericht</p>
            <p className="db-melding-tekst">
              Projecten, taken op naam en subtaken werken zodra migratie 0021 is uitgevoerd. Voer in Supabase (SQL Editor){' '}
              <code>supabase/UITVOEREN_0021_TEAM.sql</code> uit en ververs daarna deze pagina.
            </p>
            <div className="db-melding-actie">
              <Link className="db-knop" href="/agenda">
                Naar de agenda
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return <ProjectenApp />;
}
