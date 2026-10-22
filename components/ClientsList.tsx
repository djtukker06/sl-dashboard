import Link from 'next/link';
import { formatEuro } from '@/lib/format';

export interface ClientRow {
  id: string;
  company_name: string;
  invoiceCount: number;
  totalAmount: number;
}

export function ClientsList({ clients }: { clients: ClientRow[] }) {
  if (clients.length === 0) {
    return <div className="leeg-melding">Nog geen klanten.</div>;
  }

  return (
    <div className="scroll-wrap klanten-grid-wrap">
      <div className="klanten-grid">
        {clients.map((klant) => (
          <Link key={klant.id} className="klant-card" href={`/facturen/klanten/${klant.id}`}>
            <div className="naam">{klant.company_name}</div>
            <div className="meta-row">
              <span>
                {klant.invoiceCount} factu{klant.invoiceCount === 1 ? 'ur' : 'ren'}
              </span>
              <span className="bedrag">&euro; {formatEuro(klant.totalAmount)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
