'use client';

import Link from 'next/link';
import { PdfDownloadKnop } from './PdfDownloadKnop';
import { useTransition } from 'react';
import { deleteInvoice } from '@/app/actions/invoices';
import { formatDatumNL, formatEuro } from '@/lib/format';
import { RestfactuurKnop } from './RestfactuurKnop';
import { BetaalStatus } from './facturen/BetaalStatus';
import type { BankKeuze } from './facturen/BetaalFormulier';
import type { BetaalInfo } from '@/lib/boekhouding/kern/betaalcheck';

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  client_company_name: string;
  issued_at: string;
  total: number;
  deposit_percentage?: number | null;
  remainder_percentage?: number | null;
  // Bij een aanbetaling: de restfactuur, als die er al is.
  restfactuur?: { id: string; invoice_number: string } | null;
  // Gemaakt door een terugkerende factuur (migratie 0036).
  terugkerend_id?: string | null;
  verzonden_op?: string | null;
  // Aangemaakt, maar zonder akkoord nog niet verstuurd (migratie 0038).
  wacht_op_akkoord?: boolean | null;
  // Betaalstatus uit de boekhouding (lib/boekhouding/betaalstatus.ts); alleen met het vinkje Boekhouding.
  betaling?: BetaalInfo | null;
}

export function InvoicesTable({
  invoices,
  volgendNummer,
  betaal
}: {
  invoices: InvoiceRow[];
  volgendNummer?: string;
  /** Rekeningen en vandaag voor "betaald boeken"; zonder (geen boekhoudrechten): geen betaalkolom. */
  betaal?: { rekeningen: BankKeuze[]; vandaag: string } | null;
}) {
  const [isPending, startTransition] = useTransition();

  if (invoices.length === 0) {
    return <div className="leeg-melding">Nog geen facturen in dit jaar.</div>;
  }

  function handleDelete(id: string, factuurnummer: string) {
    if (!confirm(`Factuur ${factuurnummer} definitief verwijderen?`)) return;
    startTransition(async () => {
      try {
        await deleteInvoice(id);
      } catch {
        alert('Verwijderen is mislukt. Probeer het opnieuw.');
      }
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
            {betaal && <th>Betaling</th>}
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
                {typeof f.deposit_percentage === 'number' && (
                  <span className="soort-label">Aanbetaling {f.deposit_percentage}%</span>
                )}
                {typeof f.remainder_percentage === 'number' && (
                  <span className="soort-label">Restbetaling {f.remainder_percentage}%</span>
                )}
                {f.terugkerend_id && (
                  <Link
                    href={f.wacht_op_akkoord ? '/facturen/terugkerend#akkoord' : '/facturen/terugkerend'}
                    className="soort-label tk-label"
                    title={f.verzonden_op ? 'Automatisch aangemaakt en verstuurd' : f.wacht_op_akkoord ? 'Aangemaakt, wacht op jouw akkoord om te versturen' : 'Automatisch aangemaakt'}
                  >
                    Terugkerend{f.verzonden_op ? ' · verstuurd' : f.wacht_op_akkoord ? ' · wacht op akkoord' : ''}
                  </Link>
                )}
                {typeof f.deposit_percentage === 'number' && (
                  <div className="rest-regel">
                    {f.restfactuur ? (
                      <>
                        Restfactuur:{' '}
                        <a
                          href={`/api/invoices/${f.restfactuur.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {f.restfactuur.invoice_number}
                        </a>
                      </>
                    ) : (
                      volgendNummer && (
                        <RestfactuurKnop
                          factuurId={f.id}
                          volgendNummer={volgendNummer}
                          restPercentage={100 - f.deposit_percentage}
                        />
                      )
                    )}
                  </div>
                )}
              </td>
              <td>{f.client_company_name}</td>
              <td>{formatDatumNL(new Date(f.issued_at))}</td>
              <td className="bedrag">&euro; {formatEuro(f.total)}</td>
              {betaal && (
                <td className="betaal-col">
                  {f.betaling ? (
                    <BetaalStatus factuurId={f.id} nummer={f.invoice_number} info={f.betaling} rekeningen={betaal.rekeningen} vandaag={betaal.vandaag} />
                  ) : (
                    <span className="betaal-leeg">—</span>
                  )}
                </td>
              )}
              <td className="acties-col">
                <PdfDownloadKnop href={`/api/invoices/${f.id}/pdf`} label={`Factuur ${f.invoice_number} downloaden`} />
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
