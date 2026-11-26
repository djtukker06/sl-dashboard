import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid, vereisTeamlidPagina } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { vandaagNL, volgendFactuurnummer } from '@/lib/invoice/nummer';
import { laadBeheer, NA_0036 } from '@/lib/invoice/terugkerend-beheer';
import { inboxKeuzes } from '@/lib/invoice/terugkerend-pagina';
import { TerugkerendFormulier } from '@/components/facturen/TerugkerendFormulier';

export const dynamic = 'force-dynamic';

export default async function TerugkerendBewerkenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lid = await vereisTeamlidPagina(`/facturen/terugkerend/${id}`);
  if (!isUuid(id)) notFound();
  const [data, inboxen] = await Promise.all([laadBeheer(createServiceRoleClient(lid.bewijs), id), inboxKeuzes(lid)]);
  const sjabloon = data?.sjablonen[0];
  if (data && !sjabloon) notFound();

  return (
    <div className="wrap">
      <header className="app-header">
        <Link href="/facturen/terugkerend" className="terug">
          &larr; Terugkerende facturen
        </Link>
        <h2>{sjabloon ? sjabloon.naam : 'Terugkerende factuur'}</h2>
      </header>
      {data && sjabloon ? (
        <TerugkerendFormulier
          sjabloon={sjabloon}
          inboxen={inboxen}
          vandaag={vandaagNL()}
          volgendNummer={(await volgendFactuurnummer(lid.sb, Number(sjabloon.volgendeDatum.slice(0, 4)))).factuurnummer}
        />
      ) : (
        <div className="foutmelding">{NA_0036}</div>
      )}
    </div>
  );
}
