import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ClientEditForm, type KlantRecord } from '@/components/ClientEditForm';
import { formatDatumNL, formatEuro } from '@/lib/format';

export default async function KlantDetailPage({
  params
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const supabase = await createClient();

  const [{ data: klant }, { data: facturen }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, company_name, contact_name, address, postal_code')
      .eq('id', clientId)
      .maybeSingle(),
    supabase
      .from('invoices')
      .select('id, invoice_number, issued_at, total')
      .eq('client_id', clientId)
      .order('invoice_number', { ascending: false })
  ]);

  if (!klant) {
    notFound();
  }

  const factuurLijst = facturen || [];

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/facturen" className="wordmark">
          Studio <span>Levant</span>
        </Link>
        <nav>
          <Link href="/facturen/nieuwe-factuur">Nieuwe factuur</Link>
        </nav>
      </div>

      <div className="app-header">
        <Link href="/facturen" className="terug">
          &larr; Alle klanten
        </Link>
        <h1>{klant.company_name}</h1>
      </div>

      <ClientEditForm klant={klant as KlantRecord} aantalFacturen={factuurLijst.length} />

      <div className="section-head">
        <h2>Facturen</h2>
      </div>

      {factuurLijst.length === 0 ? (
        <div className="leeg-melding">Nog geen facturen voor deze klant.</div>
      ) : (
        <ul className="factuur-lijst">
          {factuurLijst.map((factuur) => (
            <li key={factuur.id}>
              <a href={`/api/invoices/${factuur.id}/pdf`} target="_blank" rel="noreferrer">
                Factuur {factuur.invoice_number}
              </a>
              <span className="factuur-meta">
                {formatDatumNL(new Date(factuur.issued_at))} &middot; &euro; {formatEuro(factuur.total)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
