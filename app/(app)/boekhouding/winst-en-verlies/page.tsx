import type { Metadata } from 'next';
import { vereisBoekhouderPagina } from '@/lib/auth/team';
import { repoVoorPagina } from '@/lib/boekhouding/modus';
import { NietIngericht } from '@/components/boekhouding/NietIngericht';
import { WinstVerliesScherm } from '@/components/boekhouding/RapportSchermen';
import type { Zoekparams } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Winst & verlies · Studio Levant' };

// Winst & verlies (?jaar=JJJJ): de winst-en-verliesrekening als eigen kopje in Boekhouding,
// automatisch uit alle boekingen, facturen, bonnetjes en afschrijvingen.
export default async function WinstVerliesPage({ searchParams }: { searchParams: Promise<Zoekparams> }) {
  const lid = await vereisBoekhouderPagina('/boekhouding/winst-en-verlies');
  const [repo, sp] = await Promise.all([repoVoorPagina(lid), searchParams]);
  if (!repo) return <NietIngericht titel="Winst &amp; verlies" />;
  // Bonnetjes die nog "Te controleren" zijn, tellen niet mee: dat zeggen we erbij.
  const { count } = await lid.sb.from('expenses').select('id', { count: 'exact', head: true }).eq('status', 'concept');
  return <WinstVerliesScherm repo={repo} sp={sp} conceptBonnetjes={count ?? 0} />;
}
