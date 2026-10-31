import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { InvoiceForm } from '@/components/InvoiceForm';
import { nieuweFactuurBeginwaarden } from '@/lib/invoice/formulier';
import { vandaagNL, volgendFactuurnummer } from '@/lib/invoice/nummer';
import { vereisTeamlidPagina } from '@/lib/auth/team';

export default async function NieuweFactuurPage() {
  // Sessie + teamlidmaatschap (lib/auth/team.ts); verder ongewijzigd.
  await vereisTeamlidPagina('/facturen/nieuwe-factuur');
  const supabase = await createClient();

  const vandaag = vandaagNL();
  const { factuurnummer: volgendNummer } = await volgendFactuurnummer(
    supabase,
    Number(vandaag.slice(0, 4))
  );

  return (
    <div className="wrap">
      <header className="app-header">
        <Link href="/facturen" className="terug">
          &larr; Overzicht
        </Link>
        <h2>Nieuwe factuur</h2>
      </header>

      <InvoiceForm beginwaarden={nieuweFactuurBeginwaarden(volgendNummer, vandaag)} />
    </div>
  );
}
