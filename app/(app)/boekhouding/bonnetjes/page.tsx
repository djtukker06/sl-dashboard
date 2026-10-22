import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isUuid } from '@/lib/uitgaven/api';
import { UitgavenApp } from '@/components/uitgaven/UitgavenApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Bonnetjes & inkoopfacturen · Studio Levant' };

// Bonnetjes & inkoopfacturen: uploaden en snel terugvinden (voorheen /uitgaven, dat hierheen
// doorstuurt). De pagina controleert zelf het lidmaatschap; de gegevens laadt de client via
// /api/uitgaven/** (die elk ook zelf controleren).
//   ?uitgave=<id>   opent direct dat bonnetje (bv. vanaf het dashboard of na mail)
//   ?toevoegen=1    zet de nadruk op uploaden (snelle actie op het dashboard)
//   ?tab=btw        opent het btw-overzicht per kwartaal
export default async function BonnetjesPage({
  searchParams
}: {
  searchParams: Promise<{ uitgave?: string; toevoegen?: string; tab?: string }>;
}) {
  await vereisTeamlidPagina('/boekhouding/bonnetjes');

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
