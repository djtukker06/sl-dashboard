import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/LogoutButton';
import { InvoicesTable, type InvoiceRow } from '@/components/InvoicesTable';
import { ClientsList, type ClientRow } from '@/components/ClientsList';
import { BASELINE_INVOICES } from '@/lib/config';

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, client_id, client_company_name, issued_at, total, year')
    .order('invoice_number', { ascending: false });

  const alleFacturen = (invoices || []) as (InvoiceRow & { client_id: string; year: number })[];

  const huidigJaar = new Date().getFullYear();
  const facturenDitJaar = alleFacturen.filter((f) => f.year === huidigJaar).length;
  const basis = BASELINE_INVOICES.jaar === huidigJaar ? BASELINE_INVOICES.aantal : 0;

  const klantenMap = new Map<string, ClientRow>();
  for (const f of alleFacturen) {
    const bestaand = klantenMap.get(f.client_id);
    if (bestaand) {
      bestaand.invoiceCount += 1;
      bestaand.totalAmount += f.total;
    } else {
      klantenMap.set(f.client_id, {
        id: f.client_id,
        company_name: f.client_company_name,
        invoiceCount: 1,
        totalAmount: f.total
      });
    }
  }
  const klanten = Array.from(klantenMap.values()).sort((a, b) =>
    a.company_name.localeCompare(b.company_name)
  );

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
      </div>
      <ClientsList clients={klanten} />
    </div>
  );
}
