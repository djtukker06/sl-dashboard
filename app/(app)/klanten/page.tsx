import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { isNietIngericht, klantenLijst } from '@/lib/crm/repo';
import { CrmKop, CrmNietIngericht } from '@/components/crm/CrmKop';
import { KlantenLijst } from '@/components/crm/KlantenLijst';
import { SnelKlant } from '@/components/crm/SnelKlant';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Klanten · Studio Levant' };

// Klanten (gedeeld met het team): zoeken, filteren op lead/actief/afgerond en snel een
// klant toevoegen. Dezelfde klanten als in de facturen.
//   ?nieuw=1   opent direct "Nieuwe klant"
export default async function KlantenPage({ searchParams }: { searchParams: Promise<{ nieuw?: string }> }) {
  const lid = await vereisTeamlidPagina('/klanten');
  if (lid.overgang) return <CrmNietIngericht actief="klanten" />;

  const sp = await searchParams;
  let klanten;
  try {
    klanten = await klantenLijst(bronVan(lid));
  } catch (e) {
    if (isNietIngericht(e)) return <CrmNietIngericht actief="klanten" />;
    throw e;
  }

  return (
    <>
      <CrmKop actief="klanten">
        <SnelKlant startOpen={sp.nieuw === '1'} />
      </CrmKop>
      <div className="kp">
        <KlantenLijst klanten={klanten} />
      </div>
    </>
  );
}
