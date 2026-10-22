import Link from 'next/link';
import { Persoon } from '@/components/team/Persoon';
import { korteDatumNL, soortLabel, type Uitgave } from '@/lib/uitgaven/model';
import { euro } from '@/lib/uitgaven/format';
import { UgIcoon } from './Iconen';

/** Naam waaronder een upload te herkennen is: leverancier, anders de bestandsnaam. */
export function uploadNaam(u: Pick<Uitgave, 'leverancier' | 'bestanden'>): string {
  return u.leverancier || u.bestanden[0]?.naam || 'Zonder bestand';
}

// De laatste uploads (dashboard-widget en /boekhouding): naam, datum, soort, bedrag en wie
// het uploadde. Geen totalen: dit is een archief, geen boekhoudpakket.
export function RecenteBonnetjes({ uitgaven }: { uitgaven: Uitgave[] }) {
  return (
    <ul className="db-lijst">
      {uitgaven.map((u) => (
        <li key={u.id}>
          <Link className="db-rij ug-recent" href={`/boekhouding/bonnetjes?uitgave=${u.id}`}>
            <span className="ug-recent-icoon" aria-hidden="true">
              <UgIcoon naam={u.bestanden[0]?.type === 'application/pdf' ? 'pdf' : u.bestanden.length ? 'beeld' : 'bon'} grootte={16} />
            </span>
            <span className="db-rij-hoofd">
              <span className="db-rij-titel">{uploadNaam(u)}</span>
              <span className="db-rij-meta">
                {[u.datum ? korteDatumNL(u.datum) : `geüpload ${korteDatumNL(u.aangemaakt.slice(0, 10))}`, soortLabel(u.soort)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span className="ug-recent-rechts">
              {u.totaal !== null && <span className="db-rij-bedrag">{euro(u.totaal, u.valuta)}</span>}
              <Persoon id={u.aangemaaktDoor} compact voorvoegsel="geüpload door" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
