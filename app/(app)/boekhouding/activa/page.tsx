import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { repoVoorPagina } from '@/lib/boekhouding/modus';
import { NietIngericht } from '@/components/boekhouding/NietIngericht';
import { ActivaScherm } from '@/components/boekhouding/ActivaSchermen';
import type { Zoekparams } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Activa & afschrijvingen · Studio Levant' };

// Activa: de activastaat per jaar (?jaar=), voorstellen om aankopen te activeren en een nieuw
// activum (?activeer=boeking:<id> of uitgave:<id> opent het paneel met die aankoop).
export default async function ActivaPage({ searchParams }: { searchParams: Promise<Zoekparams> }) {
  const lid = await vereisTeamlidPagina('/boekhouding/activa');
  const [repo, sp] = await Promise.all([repoVoorPagina(lid), searchParams]);
  if (!repo) return <NietIngericht titel="Activa &amp; afschrijvingen" />;
  return <ActivaScherm repo={repo} sp={sp} />;
}
