import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { demoAfgedwongen, kiesRepo } from '@/lib/boekhouding/modus';
import { BtwScherm } from '@/components/boekhouding/BtwSchermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Btw-aangifte · Studio Levant' };

// Btw-aangifte: alle kwartalen met status (loopt nog, aangifte doen, ingediend, betaald), het
// bedrag en de deadline; bovenaan het eerstvolgende kwartaal waarvoor aangifte moet worden gedaan.
export default async function BtwPage() {
  const lid = await vereisTeamlidPagina('/boekhouding/btw');
  const repo = await kiesRepo(lid);
  return <BtwScherm repo={repo} demoReden={demoAfgedwongen() ? 'env' : 'migratie'} />;
}
