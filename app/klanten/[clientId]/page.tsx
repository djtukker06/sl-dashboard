import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatDatumNL, formatEuro } from '@/lib/format';

export default async function KlantDetailPage({
  params
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const supabase = await createClient();

  const { data: facturen } = await supabase
    .from('invoices')
    .select('id, invoice_number, client_company_name, issued_at, total')
    .eq('client_id', clientId)
    .order('invoice_number', { ascending: false });

  if (!facturen || facturen.length === 0) {
    notFound();
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="wordmark">
          Studio <span>Levant</span>
        </Link>
        <nav>
          <Link href="/nieuwe-factuur">Nieuwe factuur</Link>
        </nav>
      </div>

      <div className="app-header">
        <Link href="/" className="terug">
          &larr; Alle klanten
        </Link>
        <h1>{facturen[0].client_company_name}</h1>
      </div>

      <ul className="factuur-lijst">
        {facturen.map((factuur) => (
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
    </div>
  );
}
