import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { repoVoorPagina } from '@/lib/boekhouding/modus';
import { NietIngericht } from '@/components/boekhouding/NietIngericht';
import { RapportenScherm } from '@/components/boekhouding/RapportSchermen';
import type { Zoekparams } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Rapporten & jaarrekening · Studio Levant' };

// Rapporten & jaarrekening: ?jaar=JJJJ&r=wv|balans|vennoten|proef|grootboek(&code=1100),
// met de exports voor de boekhouder en de status van de jaarafsluiting.
export default async function RapportenPage({ searchParams }: { searchParams: Promise<Zoekparams> }) {
  const lid = await vereisTeamlidPagina('/boekhouding/rapporten');
  const [repo, sp] = await Promise.all([repoVoorPagina(lid), searchParams]);
  if (!repo) return <NietIngericht titel="Rapporten &amp; jaarrekening" />;
  return <RapportenScherm repo={repo} sp={sp} />;
}
