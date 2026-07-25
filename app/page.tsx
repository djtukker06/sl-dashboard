import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/LogoutButton';
import { InvoicesTable, type InvoiceRow } from '@/components/InvoicesTable';
import { ClientsList, type ClientRow } from '@/components/ClientsList';
import { BASELINE_INVOICES } from '@/lib/config';

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: invoices }, { data: klantRecords }] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, client_id, client_company_name, issued_at, total, year')
      .order('invoice_number', { ascending: false }),
    supabase.from('clients').select('id, company_name').order('company_name')
  ]);

  const alleFacturen = (invoices || []) as (InvoiceRow & { client_id: string; year: number })[];

  const huidigJaar = new Date().getFullYear();
  const facturenDitJaar = alleFacturen.filter((f) => f.year === huidigJaar).length;
  const basis = BASELINE_INVOICES.jaar === huidigJaar ? BASELINE_INVOICES.aantal : 0;

  // De klantenlijst komt uit de clients-tabel (niet uit de factuur-snapshots), zodat een
  // hernoemde klant meteen goed staat en een klant zonder facturen ook zichtbaar — en dus
  // te bewerken of te verwijderen — is.
  const statistiek = new Map<string, { invoiceCount: number; totalAmount: number }>();
  for (const f of alleFacturen) {
    const bestaand = statistiek.get(f.client_id) || { invoiceCount: 0, totalAmount: 0 };
    bestaand.invoiceCount += 1;
    bestaand.totalAmount += f.total;
    statistiek.set(f.client_id, bestaand);
  }

  const klanten: ClientRow[] = (klantRecords || []).map((k) => ({
    id: k.id,
    company_name: k.company_name,
    invoiceCount: statistiek.get(k.id)?.invoiceCount || 0,
    totalAmount: statistiek.get(k.id)?.totalAmount || 0
  }));

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="wordmark">
          Studio <span>Levant</span>
        </Link>
        <nav>
          <Link href="/nieuwe-factuur">Nieuwe factuur</Link>
          <LogoutButton />
        </nav>
      </div>

      <div className="hero">
        <h1>Factuur overzicht Studio Levant</h1>
        <p>
          Overzicht van alle facturen van Studio Levant. Maak hier een nieuwe factuur aan,
          of bekijk en verwijder een bestaande.
        </p>
        <Link href="/nieuwe-factuur" className="btn-pil">
          + Nieuwe factuur
        </Link>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="n">{basis + facturenDitJaar}</div>
          <div className="l">Facturen dit jaar</div>
        </div>
      </div>

      <div className="section-head">
        <h2>Facturen</h2>
      </div>
      <InvoicesTable invoices={alleFacturen} />

      <div className="section-head" style={{ marginTop: 40 }}>
        <h2>Klanten</h2>
        <span className="section-hint">Klik op een klant om gegevens aan te passen</span>
      </div>
      <ClientsList clients={klanten} />
    </div>
  );
}
