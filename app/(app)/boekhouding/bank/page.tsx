import type { Metadata } from 'next';
import { vereisBoekhouderPagina } from '@/lib/auth/team';
import { repoVoorPagina } from '@/lib/boekhouding/modus';
import { NietIngericht } from '@/components/boekhouding/NietIngericht';
import { BankScherm, type Zoekparams } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Bank & boekingen · Studio Levant' };

// Bank & boekingen: alles wat er op de rekeningen gebeurt, in regels (uitgaven, inkomsten,
// privé, overboekingen, btw). Filters in de URL: ?rekening=&jaar=&kw=&soort=&status=&q=
export default async function BankPage({ searchParams }: { searchParams: Promise<Zoekparams> }) {
  const lid = await vereisBoekhouderPagina('/boekhouding/bank');
  const [repo, sp] = await Promise.all([repoVoorPagina(lid), searchParams]);
  if (!repo) return <NietIngericht titel="Bank &amp; boekingen" />;
  return <BankScherm repo={repo} sp={sp} />;
}
