import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { isDriveId } from '@/lib/drive/kern';
import { driveStatus } from '@/lib/drive/koppeling';
import type { DriveStatus } from '@/lib/drive/types';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { DriveInstellingen } from '@/components/bestanden/DriveInstellingen';
import { KoppelMelding } from '@/components/bestanden/KoppelMelding';
import { NietGekoppeld } from '@/components/bestanden/NietGekoppeld';
import { Verkenner } from '@/components/bestanden/Verkenner';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Bestanden · Studio Levant' };

// Bestanden: de gezamenlijke Google Drive van Studio Levant (map "Studio Levant"). Eén
// koppeling door de eigenaar; daarna gebruikt iedereen in het team de bestanden hier, zonder
// eigen Google-toegang. De pagina controleert zelf het lidmaatschap; de bestanden laadt de
// client via /api/drive/** (die elk ook zelf controleren).
//   ?map=<id>       opent die map (bv. "Map openen" vanaf een klant of project)
//   ?drive=<code>   uitkomst van het koppelen (callback)
export default async function BestandenPage({ searchParams }: { searchParams: Promise<{ map?: string; drive?: string }> }) {
  const lid = await vereisTeamlidPagina('/bestanden');
  const sp = await searchParams;

  let status: DriveStatus | null = null;
  try {
    status = await driveStatus(lid);
  } catch (e) {
    console.error('[bestanden] status', (e as Error)?.message ?? e);
  }

  return (
    <>
      <ModuleKop label="Studio Levant · Google Drive" titel="Bestanden" />
      <div className="bs">
        <KoppelMelding code={typeof sp.drive === 'string' ? sp.drive : null} />
        {!status ? (
          <div className="db-melding db-melding-fout">
            <p className="db-melding-titel">Bestanden zijn even niet beschikbaar</p>
            <p className="db-melding-tekst">De koppeling kon niet worden gelezen. Ververs de pagina over een moment.</p>
          </div>
        ) : !status.tabellen || !status.ingericht || !status.gekoppeld ? (
          <section className="db-kaart">
            <div className="db-kaart-inhoud">
              <NietGekoppeld status={status} />
            </div>
          </section>
        ) : (
          <>
            <section className="db-kaart bs-hoofd">
              <Verkenner start={{ map: isDriveId(sp.map) ? sp.map : null }} status={status} />
            </section>
            <DriveInstellingen status={status} />
          </>
        )}
      </div>
    </>
  );
}
