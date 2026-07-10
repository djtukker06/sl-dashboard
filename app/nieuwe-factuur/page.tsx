import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { InvoiceForm } from '@/components/InvoiceForm';

export default async function NieuweFactuurPage() {
  const supabase = await createClient();
  const huidigJaar = new Date().getFullYear();

  const { data: counter } = await supabase
    .from('invoice_counters')
    .select('last_number')
    .eq('year', huidigJaar)
    .maybeSingle();

  const volgendVolgnummer = (counter?.last_number || 0) + 1;
  const volgendFactuurnummer = `${String(huidigJaar).slice(-2)}-${String(volgendVolgnummer).padStart(3, '0')}`;

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="wordmark">
          Studio <span>Levant</span>
        </Link>
        <nav>
          <Link href="/">Overzicht</Link>
        </nav>
      </div>

      <header className="app-header">
        <Link href="/" className="terug">
          &larr; Overzicht
        </Link>
        <h1>Nieuwe factuur</h1>
        <div className="factuurnummer-preview">
          Eerstvolgend nummer: <strong>{volgendFactuurnummer}</strong>
        </div>
      </header>

      <InvoiceForm volgendFactuurnummer={volgendFactuurnummer} />
    </div>
  );
}
