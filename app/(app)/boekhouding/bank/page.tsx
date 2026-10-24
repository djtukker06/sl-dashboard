import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { demoAfgedwongen, kiesRepo } from '@/lib/boekhouding/modus';
import { BankScherm, type Zoekparams } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Bank & boekingen · Studio Levant' };

// Bank & boekingen: alles wat er op de rekeningen gebeurt, in regels (uitgaven, inkomsten,
// privé, overboekingen, btw). Filters in de URL: ?rekening=&jaar=&kw=&soort=&status=&q=
export default async function BankPage({ searchParams }: { searchParams: Promise<Zoekparams> }) {
  const lid = await vereisTeamlidPagina('/boekhouding/bank');
  const [repo, sp] = await Promise.all([kiesRepo(lid), searchParams]);
  return <BankScherm repo={repo} sp={sp} demoReden={demoAfgedwongen() ? 'env' : 'migratie'} />;
}
