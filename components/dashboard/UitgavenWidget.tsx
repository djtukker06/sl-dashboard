import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { UitgavenFout } from '@/lib/uitgaven/api';
import { laatsteUitgaven } from '@/lib/uitgaven/repo';
import type { Uitgave } from '@/lib/uitgaven/model';
import { BonnetjeKnop } from '@/components/uitgaven/BonnetjeKnop';
import { RecenteBonnetjes } from '@/components/uitgaven/RecenteBonnetjes';
import { Kaart, KaartMelding } from './Kaart';
import { OpnieuwKnop } from './OpnieuwKnop';

// "Laatste bonnetjes": de vier nieuwste uploads van het hele team, met wie ze uploadde.
// Leest met de gebruikerscliënt (RLS), ná de teamlidcontrole van de dashboardpagina.
export async function UitgavenWidget() {
  const sb = await createClient();
  let recent: Uitgave[];
  try {
    recent = await laatsteUitgaven(sb, 4);
  } catch (e) {
    const nietIngericht = e instanceof UitgavenFout && e.code === 'tabel_ontbreekt';
    return (
      <Kaart label="Laatste bonnetjes" href="/boekhouding/bonnetjes" className="db-smal db-uitgaven">
        <KaartMelding
          toon={nietIngericht ? 'setup' : 'fout'}
          titel={nietIngericht ? 'Bonnetjes nog niet ingericht' : 'Bonnetjes nu niet bereikbaar'}
          actie={<OpnieuwKnop />}
        >
          {nietIngericht
            ? 'Voer in Supabase supabase/UITVOEREN_0020_UITGAVEN.sql uit.'
            : 'De gegevens konden niet worden opgehaald. Probeer het zo opnieuw.'}
        </KaartMelding>
      </Kaart>
    );
  }

  return (
    <Kaart label="Laatste bonnetjes" href="/boekhouding/bonnetjes" className="db-smal db-uitgaven">
      {recent.length === 0 ? (
        <KaartMelding titel="Nog geen bonnetjes" actie={<BonnetjeKnop className="db-knop" label="Bonnetje uploaden" />}>
          Maak een foto van een bonnetje of upload een inkoopfactuur (PDF).
        </KaartMelding>
      ) : (
        <>
          <RecenteBonnetjes uitgaven={recent} />
          <p className="ug-widget-voet">
            <Link className="db-kaart-link" href="/boekhouding/bonnetjes">
              Zoeken in alle bonnetjes <span aria-hidden="true">→</span>
            </Link>
          </p>
        </>
      )}
    </Kaart>
  );
}
