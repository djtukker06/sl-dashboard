import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { demoAfgedwongen, kiesRepo } from '@/lib/boekhouding/modus';
import { ImportScherm } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Afschrift importeren · Studio Levant' };

// Bankafschrift (CSV) importeren: RegioBank en Revolut worden herkend, een ander formaat via
// een kolomkeuze. Dubbele regels worden overgeslagen; nieuwe regels zijn "te verwerken".
export default async function ImporterenPage() {
  const lid = await vereisTeamlidPagina('/boekhouding/bank/importeren');
  const repo = await kiesRepo(lid);
  return <ImportScherm repo={repo} demoReden={demoAfgedwongen() ? 'env' : 'migratie'} />;
}
