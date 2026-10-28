import type { Metadata } from 'next';
import { vereisBoekhouderPagina } from '@/lib/auth/team';
import { repoVoorPagina } from '@/lib/boekhouding/modus';
import { NietIngericht } from '@/components/boekhouding/NietIngericht';
import { BtwScherm } from '@/components/boekhouding/BtwSchermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Btw-aangifte · Studio Levant' };

// Btw-aangifte: alle kwartalen met status (loopt nog, aangifte doen, ingediend, betaald), het
// bedrag en de deadline; bovenaan het eerstvolgende kwartaal waarvoor aangifte moet worden gedaan.
export default async function BtwPage() {
  const lid = await vereisBoekhouderPagina('/boekhouding/btw');
  const repo = await repoVoorPagina(lid);
  if (!repo) return <NietIngericht titel="Btw-aangifte" />;
  return <BtwScherm repo={repo} />;
}
