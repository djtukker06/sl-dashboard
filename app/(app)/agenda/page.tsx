import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isDag, vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isUuid } from '@/lib/agenda/invoer';
import { AgendaApp } from '@/components/agenda/AgendaApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agenda & taken · Studio Levant' };

// Agenda & taken. De pagina zelf controleert de sessie; de gegevens laadt de client via
// /api/agenda en /api/taken (die elk ook zelf de sessie controleren).
//   ?dag=YYYY-MM-DD      week/maand rond die dag (vanaf het dashboard "Deze week")
//   ?weergave=maand      maandweergave
//   ?taak=<id> / ?afspraak=<id>   opent direct het bewerkpaneel
export default async function AgendaPage({
  searchParams
}: {
  searchParams: Promise<{ dag?: string; weergave?: string; taak?: string; afspraak?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/agenda');

  const sp = await searchParams;
  const vandaag = vandaagNL();
  return (
    <AgendaApp
      vandaag={vandaag}
      startDag={isDag(sp.dag) ? sp.dag : vandaag}
      startWeergave={sp.weergave === 'maand' ? 'maand' : 'week'}
      openTaak={isUuid(sp.taak) ? sp.taak : null}
      openAfspraak={isUuid(sp.afspraak) ? sp.afspraak : null}
    />
  );
}
