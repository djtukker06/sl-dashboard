import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { QuotesTable, type QuoteRow } from '@/components/QuotesTable';
import { vereisTeamlidPagina } from '@/lib/auth/team';

// Een eigen plek, los van het factuuroverzicht: prijsopgaven tellen niet mee in de
// omzet of het aantal facturen.
export default async function PrijsopgavenPage() {
  // Sessie + teamlidmaatschap (lib/auth/team.ts); verder ongewijzigd.
  await vereisTeamlidPagina('/facturen/prijsopgaven');
  const supabase = await createClient();

  const { data } = await supabase
    .from('quotes')
    .select('id, quote_number, name, client_company_name, issued_at, total')
    .order('issued_at', { ascending: false })
    .order('created_at', { ascending: false });

  const prijsopgaven = (data || []) as QuoteRow[];

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="wordmark">
          Studio <span>Levant</span>
        </Link>
        <nav>
          <Link href="/facturen">Facturen</Link>
          <Link href="/facturen/prijsopgaven/nieuw">Nieuwe prijsopgave</Link>
        </nav>
      </div>

      <div className="hero">
        <h1>Prijsopgaven Studio Levant</h1>
        <p>
          Overzicht van alle prijsopgaven. Deze staan los van de facturen en tellen niet mee
          in de omzet.
        </p>
        <Link href="/facturen/prijsopgaven/nieuw" className="btn-pil">
          + Nieuwe prijsopgave
        </Link>
      </div>

      <div className="section-head">
        <h2>Prijsopgaven</h2>
      </div>
      <QuotesTable quotes={prijsopgaven} />
    </div>
  );
}
