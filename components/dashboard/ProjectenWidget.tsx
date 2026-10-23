import Link from 'next/link';
import type { Teamlid } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { BORD_STATUSSEN, PROJECT_STATUS_KORT, PROJECT_STATUS_LABEL, RECENT_AFGEROND_DAGEN } from '@/lib/crm/projectstatus';
import { isNietIngericht, projectTellers, type ProjectTellers } from '@/lib/crm/repo';
import { Kaart, KaartMelding } from './Kaart';
import { OpnieuwKnop } from './OpnieuwKnop';

// "Projecten": vier tellers (Voorbereiding, Bezig, Wachten, Afgerond in de laatste 30
// dagen) die elk naar die kolom op het bord gaan, plus hoeveel lopende projecten te laat
// zijn. Gedeeld met het team; gebruikerscliënt (RLS) ná de teamcheck van het dashboard.
export async function ProjectenWidget({ lid }: { lid: Teamlid }) {
  let t: ProjectTellers;
  try {
    t = await projectTellers(bronVan(lid), vandaagNL());
  } catch (e) {
    const nietIngericht = lid.overgang || isNietIngericht(e);
    return (
      <Kaart label="Projecten" href="/projecten" className="db-projecten">
        <KaartMelding toon={nietIngericht ? 'setup' : 'fout'} titel={nietIngericht ? 'Projecten nog niet ingericht' : 'Projecten nu niet bereikbaar'} actie={<OpnieuwKnop />}>
          {nietIngericht ? 'Voer in Supabase supabase/UITVOEREN_0022.sql en daarna UITVOEREN_0023.sql uit.' : 'De gegevens konden niet worden opgehaald. Probeer het zo opnieuw.'}
        </KaartMelding>
      </Kaart>
    );
  }

  return (
    <Kaart label="Projecten" href="/projecten?weergave=bord" linkTekst="Bord" className="db-projecten">
      <ul className="db-projtel">
        {BORD_STATUSSEN.map((s) => (
          <li key={s}>
            <Link
              href={`/projecten?weergave=bord#kolom-${s}`}
              className={`db-projtel-vak db-projtel-${s}`}
              title={s === 'afgerond' ? `Afgerond in de laatste ${RECENT_AFGEROND_DAGEN} dagen` : PROJECT_STATUS_LABEL[s]}
            >
              <span className="db-projtel-n">{t.perStatus[s]}</span>
              <span className="db-projtel-label">{PROJECT_STATUS_KORT[s]}</span>
            </Link>
          </li>
        ))}
      </ul>
      {t.teLaat > 0 && (
        <p className="db-projtel-telaat">
          {t.teLaat === 1 ? '1 project is over de deadline' : `${t.teLaat} projecten zijn over de deadline`}
        </p>
      )}
    </Kaart>
  );
}
