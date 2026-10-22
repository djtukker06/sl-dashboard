import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { isDag, vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isUuid } from '@/lib/agenda/invoer';
import { AgendaApp } from '@/components/agenda/AgendaApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agenda & taken · Studio Levant' };

// Agenda & taken. De pagina zelf controleert de sessie; de gegevens laadt de client via
// /api/agenda en /api/taken (die elk ook zelf de sessie controleren).
//   ?dag=YYYY-MM-DD      week/maand rond die dag (vanaf het dashboard "Deze week")
//   ?weergave=maand      maandweergave
//   ?taak=<id>           opent direct de taak-popup; ?afspraak=<id> het afsprakenpaneel
//   ?wie=team|<user-id>  heel team of één teamlid (standaard: alleen jouw taken/afspraken)
//   ?project=<id>        takenlijst gefilterd op een project
export default async function AgendaPage({
  searchParams
}: {
  searchParams: Promise<{ dag?: string; weergave?: string; taak?: string; afspraak?: string; wie?: string; project?: string }>;
}) {
  await vereisTeamlidPagina('/agenda');

  const sp = await searchParams;
  const vandaag = vandaagNL();
  return (
    <AgendaApp
      vandaag={vandaag}
      startDag={isDag(sp.dag) ? sp.dag : vandaag}
      startWeergave={sp.weergave === 'maand' ? 'maand' : 'week'}
      startWie={sp.wie === 'team' ? 'team' : isUuid(sp.wie) ? sp.wie.toLowerCase() : sp.wie === 'ik' ? 'ik' : null}
      startProject={isUuid(sp.project) ? sp.project : null}
      openTaak={isUuid(sp.taak) ? sp.taak : null}
      openAfspraak={isUuid(sp.afspraak) ? sp.afspraak : null}
    />
  );
}
