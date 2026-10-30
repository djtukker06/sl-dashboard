import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { isDag, vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isUuid } from '@/lib/agenda/invoer';
import { AgendaApp } from '@/components/agenda/AgendaApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agenda & taken · Studio Levant' };

// Agenda & taken. De pagina zelf controleert de sessie; de gegevens laadt de client via
// /api/agenda en /api/taken (die elk ook zelf de sessie controleren). Je ziet hier alleen
// wat op JOUW naam staat; wat je voor een ander maakte staat onder de tab "Uitgezet".
//   ?dag=YYYY-MM-DD      week/maand rond die dag (vanaf het dashboard "Deze week")
//   ?weergave=dag|week|maand  vaste weergave (zonder: week, op de telefoon één dag)
//   ?taak=<id>           opent direct de taak-popup; ?afspraak=<id> het afsprakenpaneel
//   ?lijst=uitgezet      opent de takenlijst op de tab "Uitgezet"
//   ?project=<id>        takenlijst gefilterd op een project
// Een oude link met ?wie=team of ?wie=<id> (teamweergave, bestaat niet meer) gaat naar
// dezelfde pagina zonder die parameter.
export default async function AgendaPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await vereisTeamlidPagina('/agenda');

  const ruw = await searchParams;
  const sp: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(ruw)) sp[k] = Array.isArray(v) ? v[0] : v;

  if (sp.wie !== undefined) {
    const p = new URLSearchParams();
    for (const k of ['dag', 'weergave', 'taak', 'afspraak', 'lijst', 'project']) if (sp[k]) p.set(k, sp[k]!);
    const qs = p.toString();
    redirect(`/agenda${qs ? `?${qs}` : ''}`);
  }

  // Gok op de telefoon (User-Agent / Client Hint), zodat de eerste render al de telefoonweergave
  // (dag / 3 dagen) toont i.p.v. eerst kort de hele week. Na het laden beslist de schermbreedte.
  const h = await headers();
  const telefoon = h.get('sec-ch-ua-mobile') === '?1' || /\b(iPhone|iPod|Android.+Mobile|Mobile)\b/i.test(h.get('user-agent') ?? '');

  const vandaag = vandaagNL();
  return (
    <AgendaApp
      vandaag={vandaag}
      telefoon={telefoon}
      startDag={isDag(sp.dag) ? sp.dag : vandaag}
      startWeergave={sp.weergave === 'maand' || sp.weergave === 'week' || sp.weergave === 'dag' ? sp.weergave : null}
      startFilter={sp.lijst === 'uitgezet' ? 'uitgezet' : 'vandaag'}
      startProject={isUuid(sp.project) ? sp.project : null}
      openTaak={isUuid(sp.taak) ? sp.taak : null}
      openAfspraak={isUuid(sp.afspraak) ? sp.afspraak : null}
    />
  );
}
