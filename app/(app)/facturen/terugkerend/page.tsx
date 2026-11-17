import Link from 'next/link';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { laadBeheer, NA_0036 } from '@/lib/invoice/terugkerend-beheer';
import { TerugkerendLijst } from '@/components/facturen/TerugkerendLijst';
import { vandaagNL } from '@/lib/invoice/nummer';

export const dynamic = 'force-dynamic';

// Terugkerende facturen (migratie 0036): het overzicht. Aanmaken gebeurt automatisch door de
// dagelijkse cron (lib/invoice/terugkerend.ts).
export default async function TerugkerendPage() {
  const lid = await vereisTeamlidPagina('/facturen/terugkerend');
  const data = await laadBeheer(createServiceRoleClient(lid.bewijs));

  return (
    <div className="wrap">
      <header className="app-header">
        <Link href="/facturen" className="terug">
          &larr; Facturen
        </Link>
        <h2>Terugkerende facturen</h2>
      </header>
      {data ? (
        <>
          <p className="tk-intro">
            Deze facturen worden op de ingestelde dag automatisch aangemaakt met het eerstvolgende factuurnummer en, als dat aan staat, per e-mail
            verstuurd. Ze verschijnen gewoon bij je facturen en in de boekhouding.
          </p>
          <TerugkerendLijst sjablonen={data.sjablonen} vandaag={vandaagNL()} />
        </>
      ) : (
        <div className="foutmelding">{NA_0036}</div>
      )}
    </div>
  );
}
