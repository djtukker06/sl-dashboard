import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { vereisTeamlidPagina, type Teamlid } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isUuid } from '@/lib/agenda/invoer';
import { huidigJaarNL } from '@/lib/dashboard/facturen';
import { isNietIngericht, klantPagina } from '@/lib/crm/repo';
import { driveStatus } from '@/lib/drive/koppeling';
import type { DriveStatus } from '@/lib/drive/types';
import { CrmNietIngericht } from '@/components/crm/CrmKop';
import { CrmProviders } from '@/components/crm/CrmProviders';
import { KlantInhoud } from '@/components/crm/KlantInhoud';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Klant · Studio Levant' };

async function bestandenStatus(lid: Teamlid): Promise<DriveStatus | null> {
  try {
    return await driveStatus(lid);
  } catch (e) {
    console.error('[bestanden] status', (e as Error)?.message ?? e);
    return null;
  }
}

// Klantpagina: kop met naam (inline te hernoemen), status en Mailen/Bellen; kerncijfers
// (omzet, facturen, open aanbetalingen, projecten — facturen alleen gelezen); voor een lead
// bovenaan het opvolgen (volgende stap, datum, gewonnen/afgewezen); daaronder projecten,
// open taken en de tijdlijn, en opzij contact, facturen & prijsopgaven en bestanden.
export default async function KlantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lid = await vereisTeamlidPagina(`/klanten/${id}`);
  if (lid.overgang) return <CrmNietIngericht actief="klanten" />;
  if (!isUuid(id)) notFound();

  let data;
  const drive = bestandenStatus(lid);
  try {
    data = await klantPagina(bronVan(lid), id, huidigJaarNL());
  } catch (e) {
    if (isNietIngericht(e)) return <CrmNietIngericht actief="klanten" />;
    throw e;
  }
  if (!data) notFound();
  const driveSt = await drive;
  return (
    <CrmProviders>
      <KlantInhoud data={data} vandaag={vandaagNL()} drive={driveSt} />
    </CrmProviders>
  );
}
