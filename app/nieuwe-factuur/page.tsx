import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { InvoiceForm } from '@/components/InvoiceForm';

export default async function NieuweFactuurPage() {
  const supabase = await createClient();
  const huidigJaar = new Date().getFullYear();

  // Voorstel: hoogste bestaande factuur van dit jaar + 1. Verwijder je de laatste
  // factuur, dan komt dat nummer dus weer vrij. invoice_counters dient alleen nog als
  // ondergrens voor nummers die buiten dit systeem om zijn uitgegeven (zie migratie 0005).
  const [{ data: counter }, { data: hoogste }] = await Promise.all([
    supabase
      .from('invoice_counters')
      .select('last_number')
      .eq('year', huidigJaar)
      .maybeSingle(),
    supabase
      .from('invoices')
      .select('sequence_number')
      .eq('year', huidigJaar)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const volgendVolgnummer = Math.max(counter?.last_number || 0, hoogste?.sequence_number || 0) + 1;
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
      </header>

      <InvoiceForm volgendFactuurnummer={volgendFactuurnummer} />
    </div>
  );
}
