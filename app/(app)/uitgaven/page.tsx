import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isUuid } from '@/lib/uitgaven/api';
import { UitgavenApp } from '@/components/uitgaven/UitgavenApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Uitgaven · Studio Levant' };

// Uitgaven: bonnetjes en betaalde facturen. De pagina controleert zelf de sessie; de
// gegevens laadt de client via /api/uitgaven/** (die elk ook zelf de sessie controleren).
//   ?uitgave=<id>   opent direct het bewerkpaneel (bv. vanaf het dashboard of na mail)
//   ?toevoegen=1    zet de nadruk op "Bonnetje toevoegen" (snelle actie op het dashboard)
//   ?tab=btw        opent "Btw & cijfers"
export default async function UitgavenPage({
  searchParams
}: {
  searchParams: Promise<{ uitgave?: string; toevoegen?: string; tab?: string }>;
}) {
  await vereisTeamlidPagina('/uitgaven');

  const sp = await searchParams;
  return (
    <UitgavenApp
      vandaag={vandaagNL()}
      openUitgave={isUuid(sp.uitgave) ? sp.uitgave : null}
      toevoegen={sp.toevoegen === '1'}
      startTab={sp.tab === 'btw' ? 'btw' : 'overzicht'}
    />
  );
}
