import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { repoVoorPagina } from '@/lib/boekhouding/modus';
import { NietIngericht } from '@/components/boekhouding/NietIngericht';
import { OpenstaandScherm } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Openstaand & afletteren · Studio Levant' };

// Openstaande posten: debiteuren (facturen die nog niet betaald zijn, met ouderdom) en
// crediteuren (bonnetjes zonder bankregel), koppelsuggesties en de controles van de boekhouder.
export default async function OpenstaandPage() {
  const lid = await vereisTeamlidPagina('/boekhouding/openstaand');
  const repo = await repoVoorPagina(lid);
  if (!repo) return <NietIngericht titel="Openstaand &amp; afletteren" />;
  return <OpenstaandScherm repo={repo} />;
}
