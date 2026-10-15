import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/LogoutButton';
import { InvoicesTable, type InvoiceRow } from '@/components/InvoicesTable';
import { ClientsList, type ClientRow } from '@/components/ClientsList';
import { formatEuro } from '@/lib/format';
import { vandaagNL, volgendFactuurnummer } from '@/lib/invoice/nummer';

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{ jaar?: string }>;
}) {
  const { jaar } = await searchParams;
  const supabase = await createClient();

  const [{ data: invoices }, { data: klantRecords }] = await Promise.all([
    supabase
      .from('invoices')
      // Bewust alle kolommen: draait de deploy even voor op migratie 0013, dan ontbreken
      // de restfactuur-kolommen gewoon in plaats dat het hele overzicht leeg blijft.
      .select('*')
      .order('invoice_number', { ascending: false }),
    supabase.from('clients').select('id, company_name').order('company_name')
  ]);

  const opgehaald = (invoices || []) as (InvoiceRow & {
    client_id: string;
    year: number;
    revenue_subtotal: number;
    deposit_percentage: number | null;
    remainder_of_invoice_id: string | null;
  })[];

  // Koppel elke aanbetaling aan zijn restfactuur (die kan ook in een later jaar vallen,
  // dus over alle facturen heen).
  const restfactuurVan = new Map(
    opgehaald
      .filter((f) => f.remainder_of_invoice_id)
      .map((f) => [f.remainder_of_invoice_id, { id: f.id, invoice_number: f.invoice_number }])
  );
  const alleFacturen = opgehaald.map((f) => ({
    ...f,
    restfactuur: restfactuurVan.get(f.id) ?? null
  }));
  const openAanbetalingen = alleFacturen.filter(
    (f) => typeof f.deposit_percentage === 'number' && !f.restfactuur
  );

  // Nederlandse tijd: de server draait in UTC, dus rond de jaarwisseling zou het
  // "huidige jaar" er anders een dag lang naast zitten.
  const huidigJaar = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' })
      .format(new Date())
      .slice(0, 4)
  );

  // Elk jaar waarin een factuur bestaat blijft zichtbaar; het huidige jaar staat er
  // altijd bij, ook als er nog geen factuur van is.
  const factuurJaren = alleFacturen.map((f) => f.year);
  const jaren = Array.from(new Set([huidigJaar, ...factuurJaren])).sort((a, b) => b - a);

  // Standaard het nieuwste jaar waarin al een factuur staat: begin januari blijf je zo
  // nog het afgelopen jaar zien, en zodra de eerste factuur van het nieuwe jaar erin
  // staat, springt het overzicht daar vanzelf naartoe.
  const standaardJaar = factuurJaren.length > 0 ? Math.max(...factuurJaren) : huidigJaar;
  const gekozenJaar = jaren.includes(Number(jaar)) ? Number(jaar) : standaardJaar;

  const facturenVanJaar = alleFacturen.filter((f) => f.year === gekozenJaar);

  // Het nummer dat een restfactuur nu zou krijgen; alleen nodig als er iets open staat.
  const volgendNummer =
    openAanbetalingen.length > 0
      ? (await volgendFactuurnummer(supabase, Number(vandaagNL().slice(0, 4)))).factuurnummer
      : undefined;
  const omzetVanJaar = facturenVanJaar.reduce((som, f) => som + f.revenue_subtotal, 0);

  // De klantenlijst komt uit de clients-tabel (niet uit de factuur-snapshots), zodat een
  // hernoemde klant meteen goed staat en een klant zonder facturen ook zichtbaar — en dus
  // te bewerken of te verwijderen — is. Klanten blijven over de jaren heen staan, dus deze
  // lijst telt alle facturen mee, ongeacht het gekozen jaar.
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
          <Link href="/prijsopgaven">Prijsopgaven</Link>
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

      {jaren.length > 1 && (
        <div className="jaar-keuze">
          {jaren.map((j) => (
            <Link
              key={j}
              href={j === standaardJaar ? '/' : `/?jaar=${j}`}
              className={j === gekozenJaar ? 'jaar actief' : 'jaar'}
            >
              {j}
            </Link>
          ))}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <div className="n">{facturenVanJaar.length}</div>
          <div className="l">Facturen {gekozenJaar}</div>
        </div>
        <div className="stat">
          <div className="n">&euro; {formatEuro(omzetVanJaar)}</div>
          <div className="l">Omzet {gekozenJaar} excl. btw</div>
        </div>
      </div>

      {openAanbetalingen.length > 0 && (
        <>
          <div className="section-head">
            <h2>Open aanbetalingen</h2>
            <span className="section-hint">
              Nog geen restfactuur — maak hem met één klik
            </span>
          </div>
          <InvoicesTable invoices={openAanbetalingen} volgendNummer={volgendNummer} />
        </>
      )}

      <div className="section-head">
        <h2>
          Facturen {gekozenJaar}{' '}
          <span className="omzet-inline">
            - Omzet excl. btw: &euro; {formatEuro(omzetVanJaar)}
          </span>
        </h2>
      </div>
      <InvoicesTable invoices={facturenVanJaar} volgendNummer={volgendNummer} />

      <div className="section-head" style={{ marginTop: 40 }}>
        <h2>Klanten</h2>
        <span className="section-hint">Klik op een klant om gegevens aan te passen</span>
      </div>
      <ClientsList clients={klanten} />
    </div>
  );
}
