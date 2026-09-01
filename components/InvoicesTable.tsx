'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { deleteInvoice } from '@/app/actions/invoices';
import { formatDatumNL, formatEuro } from '@/lib/format';

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  client_company_name: string;
  issued_at: string;
  total: number;
}

export function InvoicesTable({ invoices }: { invoices: InvoiceRow[] }) {
  const [isPending, startTransition] = useTransition();

  if (invoices.length === 0) {
    return <div className="leeg-melding">Nog geen facturen in dit jaar.</div>;
  }

  function handleDelete(id: string, factuurnummer: string) {
    if (!confirm(`Factuur ${factuurnummer} definitief verwijderen?`)) return;
    startTransition(() => {
      deleteInvoice(id);
    });
  }

  return (
    <div className="scroll-wrap facturen-tabel-wrap">
      <table className="facturen-tabel">
        <thead>
          <tr>
            <th>Nummer</th>
            <th>Klant</th>
            <th>Datum</th>
            <th>Totaal</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((f) => (
            <tr key={f.id}>
              <td>
                <a href={`/api/invoices/${f.id}/pdf`} target="_blank" rel="noreferrer">
                  {f.invoice_number}
                </a>
              </td>
              <td>{f.client_company_name}</td>
              <td>{formatDatumNL(new Date(f.issued_at))}</td>
              <td className="bedrag">&euro; {formatEuro(f.total)}</td>
              <td className="acties-col">
                <Link href={`/facturen/${f.id}/bewerken`} className="bewerk-link">
                  Aanpassen
                </Link>
              </td>
              <td>
                <button
                  type="button"
                  className="verwijder-link"
                  title="Factuur verwijderen"
                  disabled={isPending}
                  onClick={() => handleDelete(f.id, f.invoice_number)}
                >
                  &times;
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
