import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { feedStatus } from '@/lib/agenda/feed';
import { veiligVervolg } from '@/lib/vervolg';
import { AgendaKoppelen } from '@/components/agenda-koppelen/AgendaKoppelen';
import '../../public/shell/shell.css';
import '../(app)/app.css';
import '../(app)/agenda.css';
import '../(app)/account.css';
import '../welkom/welkom.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agenda koppelen · Studio Levant' };

// Verplicht: je SL-agenda (taken op jouw naam en afspraken waar je bij bent) koppelen aan
// Apple Agenda of Google Agenda. app/(app)/layout.tsx stuurt hierheen tot de link minstens
// één keer door een agenda-app is opgehaald (of een dag is uitgesteld). Ook later te openen
// om opnieuw te koppelen. Bewust buiten app/(app): geen rail.
export default async function AgendaKoppelenPagina({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const lid = await vereisTeamlidPagina('/agenda-koppelen');
  if (!lid.welkomKlaar) redirect('/welkom');
  const status = await feedStatus(lid);
  if (!status.ingericht) redirect('/');
  return <AgendaKoppelen voornaam={lid.profiel.voornaam} start={status} vervolg={veiligVervolg(next)} />;
}
