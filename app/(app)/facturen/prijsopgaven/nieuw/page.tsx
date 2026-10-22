import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { InvoiceForm } from '@/components/InvoiceForm';
import { nieuwePrijsopgaveBeginwaarden } from '@/lib/invoice/formulier';

export default async function NieuwePrijsopgavePage() {
  const supabase = await createClient();

  // Datum van vandaag in Nederlandse tijd, als YYYY-MM-DD voor de date-input.
  const vandaag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(
    new Date()
  );
  const jj = vandaag.slice(2, 4);

  // Voorstel voor het nummer: P + jaar + volgnummer, bijv. P26-004. Het nummer is vrij
  // tekst en optioneel, dus alleen nummers in precies dit formaat tellen mee voor het
  // voorstel.
  const { data: nummers } = await supabase
    .from('quotes')
    .select('quote_number')
    .like('quote_number', `P${jj}-%`);

  const hoogste = (nummers || []).reduce((max, { quote_number }) => {
    const match = (quote_number || '').match(/^P\d{2}-(\d{3})$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const voorgesteldNummer = `P${jj}-${String(hoogste + 1).padStart(3, '0')}`;

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="wordmark">
          Studio <span>Levant</span>
        </Link>
        <nav>
          <Link href="/facturen/prijsopgaven">Prijsopgaven</Link>
        </nav>
      </div>

      <header className="app-header">
        <Link href="/facturen/prijsopgaven" className="terug">
          &larr; Prijsopgaven
        </Link>
        <h1>Nieuwe prijsopgave</h1>
      </header>

      <InvoiceForm
        soort="prijsopgave"
        beginwaarden={nieuwePrijsopgaveBeginwaarden(voorgesteldNummer, vandaag)}
      />
    </div>
  );
}
