import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { demoAfgedwongen, kiesRepo } from '@/lib/boekhouding/modus';
import { InstellingenScherm } from '@/components/boekhouding/Schermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Instellingen boekhouding · Studio Levant' };

// Instellingen van de boekhouding: bedrijfsgegevens, bankrekeningen (standaard, toevoegen,
// beginsaldo), vennoten en winstverdeling, categorieën en het memoriaal (beginbalans/correcties).
export default async function BoekhoudInstellingenPage() {
  const lid = await vereisTeamlidPagina('/boekhouding/instellingen');
  const repo = await kiesRepo(lid);
  return <InstellingenScherm repo={repo} demoReden={demoAfgedwongen() ? 'env' : 'migratie'} eigenaar={lid.rol === 'eigenaar' && lid.tfa.aal === 'aal2'} />;
}
