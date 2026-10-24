import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { demoAfgedwongen, kiesRepo } from '@/lib/boekhouding/modus';
import { OpenstaandScherm } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Openstaand & afletteren · Studio Levant' };

// Openstaande posten: debiteuren (facturen die nog niet betaald zijn, met ouderdom) en
// crediteuren (bonnetjes zonder bankregel), koppelsuggesties en de controles van de boekhouder.
export default async function OpenstaandPage() {
  const lid = await vereisTeamlidPagina('/boekhouding/openstaand');
  const repo = await kiesRepo(lid);
  return <OpenstaandScherm repo={repo} demoReden={demoAfgedwongen() ? 'env' : 'migratie'} />;
}
