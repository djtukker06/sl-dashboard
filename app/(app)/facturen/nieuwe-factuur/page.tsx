import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { InvoiceForm } from '@/components/InvoiceForm';
import { TerugkerendFormulier } from '@/components/facturen/TerugkerendFormulier';
import { nieuweFactuurBeginwaarden } from '@/lib/invoice/formulier';
import { vandaagNL, volgendFactuurnummer } from '@/lib/invoice/nummer';
import { inboxKeuzes } from '@/lib/invoice/terugkerend-pagina';
import { vereisTeamlidPagina } from '@/lib/auth/team';

// Nieuwe factuur, met bovenaan de keuze Eenmalig (het gewone factuurformulier) of Terugkerend
// (elke maand/kwartaal/jaar automatisch, migratie 0036). De keuze staat in de URL
// (?soort=terugkerend), zodat terug/vooruit en bladwijzers gewoon werken.
export default async function NieuweFactuurPage({ searchParams }: { searchParams: Promise<{ soort?: string }> }) {
  // Sessie + teamlidmaatschap (lib/auth/team.ts).
  const lid = await vereisTeamlidPagina('/facturen/nieuwe-factuur');
  const terugkerend = (await searchParams).soort === 'terugkerend';
  const vandaag = vandaagNL();

  return (
    <div className="wrap">
      <header className="app-header">
        <Link href="/facturen" className="terug">
          &larr; Overzicht
        </Link>
        <h2>Nieuwe factuur</h2>
      </header>

      <nav className="factuursoort" aria-label="Soort factuur">
        <Link href="/facturen/nieuwe-factuur" className={terugkerend ? '' : 'is-aan'} aria-current={terugkerend ? undefined : 'page'}>
          Eenmalig
          <span>Eén factuur, nu</span>
        </Link>
        <Link href="/facturen/nieuwe-factuur?soort=terugkerend" className={terugkerend ? 'is-aan' : ''} aria-current={terugkerend ? 'page' : undefined}>
          Terugkerend
          <span>Elke maand, kwartaal of jaar automatisch</span>
        </Link>
      </nav>

      {terugkerend ? (
        <TerugkerendFormulier
          inboxen={await inboxKeuzes(lid)}
          vandaag={vandaag}
          volgendNummer={(await volgendFactuurnummer(await createClient(), Number(vandaag.slice(0, 4)))).factuurnummer}
        />
      ) : (
        <InvoiceForm
          beginwaarden={nieuweFactuurBeginwaarden((await volgendFactuurnummer(await createClient(), Number(vandaag.slice(0, 4)))).factuurnummer, vandaag)}
        />
      )}
    </div>
  );
}
