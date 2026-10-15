import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InvoiceForm } from '@/components/InvoiceForm';
import { beginwaardenVanPrijsopgave, type PrijsopgaveRecord } from '@/lib/invoice/formulier';

export default async function PrijsopgaveBewerkenPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: prijsopgave } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!prijsopgave) {
    notFound();
  }

  const titel = prijsopgave.quote_number
    ? `Prijsopgave ${prijsopgave.quote_number} aanpassen`
    : 'Prijsopgave aanpassen';

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="wordmark">
          Studio <span>Levant</span>
        </Link>
        <nav>
          <Link href="/prijsopgaven/nieuw">Nieuwe prijsopgave</Link>
        </nav>
      </div>

      <header className="app-header">
        <Link href="/prijsopgaven" className="terug">
          &larr; Prijsopgaven
        </Link>
        <h1>{titel}</h1>
        <span className="factuurnummer-preview">
          <a href={`/api/quotes/${id}/pdf`} target="_blank" rel="noreferrer">
            Huidige PDF bekijken
          </a>
        </span>
      </header>

      <InvoiceForm
        soort="prijsopgave"
        factuurId={id}
        beginwaarden={beginwaardenVanPrijsopgave(prijsopgave as PrijsopgaveRecord)}
      />
    </div>
  );
}
