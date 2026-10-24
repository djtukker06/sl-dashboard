import Link from 'next/link';
import type { Teamlid } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { opvolgLijst, type OpvolgRegel } from '@/lib/crm/repo';
import { OpvolgBadge } from '@/components/crm/StatusPil';
import { Kaart } from './Kaart';

const MAX = 5;

// "Opvolgen": leads en klanten met een opvolgdatum van vandaag of eerder (gedeeld met het
// team). Kost alleen ruimte als er iets is: zonder te-late opvolgingen, vóór migratie 0025
// of bij een fout verschijnt de kaart niet (de rest van het dashboard merkt er niets van).
export async function OpvolgenWidget({ lid }: { lid: Teamlid }) {
  if (lid.overgang) return null;
  const vandaag = vandaagNL();
  let lijst: OpvolgRegel[] | null;
  try {
    lijst = await opvolgLijst(bronVan(lid), vandaag);
  } catch (e) {
    console.error('[dashboard] opvolgen', (e as Error)?.message ?? e);
    return null;
  }
  if (!lijst || lijst.length === 0) return null;
  return <OpvolgenKaart lijst={lijst} vandaag={vandaag} />;
}

/** De kaart zelf (zonder data ophalen). */
export function OpvolgenKaart({ lijst, vandaag }: { lijst: OpvolgRegel[]; vandaag: string }) {
  const alleenLeads = lijst.every((k) => k.status === 'lead');
  const href = alleenLeads ? '/klanten?tab=leads' : '/klanten';
  return (
    <Kaart label="Opvolgen" href={href} linkTekst={alleenLeads ? 'Leads' : 'Klanten'} className="db-opvolgen">
      <ul className="db-opvolg">
        {lijst.slice(0, MAX).map((k) => (
          <li key={k.id}>
            <Link className="db-opvolg-rij" href={`/klanten/${k.id}`}>
              <span className="db-opvolg-hoofd">
                <span className="db-opvolg-naam">{k.naam}</span>
                <span className="db-opvolg-stap">{k.volgendeStap || (k.status === 'lead' ? 'Lead opvolgen' : 'Klant opvolgen')}</span>
              </span>
              <OpvolgBadge datum={k.opvolgenOp} vandaag={vandaag} />
            </Link>
          </li>
        ))}
      </ul>
      {lijst.length > MAX && (
        <Link className="db-kaart-link db-opvolg-meer" href={href}>
          Nog {lijst.length - MAX} →
        </Link>
      )}
    </Kaart>
  );
}
