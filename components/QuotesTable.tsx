'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { deleteQuote } from '@/app/actions/quotes';
import { formatDatumNL, formatEuro } from '@/lib/format';

export interface QuoteRow {
  id: string;
  quote_number: string | null;
  name: string | null;
  client_company_name: string | null;
  issued_at: string;
  total: number;
}

export function QuotesTable({ quotes }: { quotes: QuoteRow[] }) {
  const [isPending, startTransition] = useTransition();

  if (quotes.length === 0) {
    return <div className="leeg-melding">Nog geen prijsopgaven.</div>;
  }

  function handleDelete(id: string, omschrijving: string) {
    if (!confirm(`${omschrijving} definitief verwijderen?`)) return;
    startTransition(() => {
      deleteQuote(id);
    });
  }

  return (
    <div className="scroll-wrap facturen-tabel-wrap">
      <table className="facturen-tabel">
        <thead>
          <tr>
            <th>Prijsopgave</th>
            <th>Klant</th>
            <th>Datum</th>
            <th>Totaal</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((p) => {
            // Nummer en naam zijn allebei optioneel; laat zien wat er is.
            const omschrijving = p.quote_number || p.name || 'Prijsopgave';
            return (
              <tr key={p.id}>
                <td>
                  <a href={`/api/quotes/${p.id}/pdf`} target="_blank" rel="noreferrer">
                    {omschrijving}
                  </a>
                </td>
                <td>{p.client_company_name || '–'}</td>
                <td>{formatDatumNL(new Date(p.issued_at))}</td>
                <td className="bedrag">&euro; {formatEuro(p.total)}</td>
                <td className="acties-col">
                  <Link href={`/facturen/prijsopgaven/${p.id}/bewerken`} className="bewerk-link">
                    Aanpassen
                  </Link>
                </td>
                <td>
                  <button
                    type="button"
                    className="verwijder-link"
                    title="Prijsopgave verwijderen"
                    disabled={isPending}
                    onClick={() => handleDelete(p.id, omschrijving)}
                  >
                    &times;
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
