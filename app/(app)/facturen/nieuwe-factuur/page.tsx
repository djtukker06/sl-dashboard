import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { InvoiceForm } from '@/components/InvoiceForm';
import { nieuweFactuurBeginwaarden } from '@/lib/invoice/formulier';
import { vandaagNL, volgendFactuurnummer } from '@/lib/invoice/nummer';

export default async function NieuweFactuurPage() {
  const supabase = await createClient();

  const vandaag = vandaagNL();
  const { factuurnummer: volgendNummer } = await volgendFactuurnummer(
    supabase,
    Number(vandaag.slice(0, 4))
  );

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="wordmark">
          Studio <span>Levant</span>
        </Link>
        <nav>
          <Link href="/facturen">Overzicht</Link>
        </nav>
      </div>

      <header className="app-header">
        <Link href="/facturen" className="terug">
          &larr; Overzicht
        </Link>
        <h1>Nieuwe factuur</h1>
      </header>

      <InvoiceForm beginwaarden={nieuweFactuurBeginwaarden(volgendNummer, vandaag)} />
    </div>
  );
}
