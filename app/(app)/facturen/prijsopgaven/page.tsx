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
      <QuotesTable quotes={prijsopgaven} />
    </div>
  );
}
