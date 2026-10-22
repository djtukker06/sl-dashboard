import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InvoiceForm } from '@/components/InvoiceForm';
import { beginwaardenVanFactuur, type FactuurRecord } from '@/lib/invoice/formulier';
import { vereisTeamlidPagina } from '@/lib/auth/team';

export default async function FactuurBewerkenPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  // Sessie + teamlidmaatschap (lib/auth/team.ts); verder ongewijzigd.
  await vereisTeamlidPagina();
  const { id } = await params;
  const supabase = await createClient();

  // Bewust alle kolommen: draait de deploy even voor op de migratie die de btw-verlegd-
  // kolommen toevoegt, dan blijft het bewerkscherm gewoon werken.
  const { data: factuur } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle();

  if (!factuur) {
    notFound();
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="wordmark">
          Studio <span>Levant</span>
        </Link>
        <nav>
          <Link href="/facturen/nieuwe-factuur">Nieuwe factuur</Link>
        </nav>
      </div>

      <header className="app-header">
        <Link href="/facturen" className="terug">
          &larr; Overzicht
        </Link>
        <h1>Factuur {factuur.invoice_number} aanpassen</h1>
        <span className="factuurnummer-preview">
          <a href={`/api/invoices/${id}/pdf`} target="_blank" rel="noreferrer">
            Huidige PDF bekijken
          </a>
        </span>
      </header>

      <InvoiceForm
        factuurId={id}
        beginwaarden={beginwaardenVanFactuur(factuur as FactuurRecord)}
      />
    </div>
  );
}
