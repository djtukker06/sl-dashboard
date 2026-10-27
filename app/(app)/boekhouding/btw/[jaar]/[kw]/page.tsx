import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { repoVoorPagina } from '@/lib/boekhouding/modus';
import { NietIngericht } from '@/components/boekhouding/NietIngericht';
import { leesKwartaal } from '@/lib/boekhouding/acties';
import { AangifteScherm } from '@/components/boekhouding/BtwSchermen';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ jaar: string; kw: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  const kw = leesKwartaal(p.jaar, p.kw);
  return { title: kw ? `Btw Q${kw.kwartaal} ${kw.jaar} · Studio Levant` : 'Btw-aangifte · Studio Levant' };
}

// De btw-aangifte van één kwartaal: rubrieken zoals op het formulier (hele euro's), doorklik
// naar de boekingen, controles, markeren als ingediend (vergrendelt) en de betaling koppelen.
export default async function AangiftePage({ params }: Props) {
  const p = await params;
  const lid = await vereisTeamlidPagina(`/boekhouding/btw/${encodeURIComponent(p.jaar)}/${encodeURIComponent(p.kw)}`);
  const kw = leesKwartaal(p.jaar, p.kw);
  if (!kw) notFound();
  const repo = await repoVoorPagina(lid);
  if (!repo) return <NietIngericht titel="Btw-aangifte" />;
  return <AangifteScherm repo={repo} jaar={kw.jaar} kwartaal={kw.kwartaal} eigenaar={lid.rol === 'eigenaar'} />;
}
