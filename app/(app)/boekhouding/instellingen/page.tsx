import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { demoAfgedwongen, kiesRepo } from '@/lib/boekhouding/modus';
import { InstellingenScherm } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Instellingen boekhouding · Studio Levant' };

// Instellingen van de boekhouding: bankrekeningen (standaard, toevoegen, beginsaldo),
// vennoten en categorieën.
export default async function BoekhoudInstellingenPage() {
  const lid = await vereisTeamlidPagina('/boekhouding/instellingen');
  const repo = await kiesRepo(lid);
  return <InstellingenScherm repo={repo} demoReden={demoAfgedwongen() ? 'env' : 'migratie'} />;
}
