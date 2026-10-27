import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { repoVoorPagina } from '@/lib/boekhouding/modus';
import { NietIngericht } from '@/components/boekhouding/NietIngericht';
import { ImportScherm } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Afschrift importeren · Studio Levant' };

// Bankafschrift (CSV) importeren: RegioBank en Revolut worden herkend, een ander formaat via
// een kolomkeuze. Dubbele regels worden overgeslagen; nieuwe regels zijn "te verwerken".
export default async function ImporterenPage() {
  const lid = await vereisTeamlidPagina('/boekhouding/bank/importeren');
  const repo = await repoVoorPagina(lid);
  if (!repo) return <NietIngericht titel="Afschrift importeren" />;
  return <ImportScherm repo={repo} />;
}
