import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { demoAfgedwongen, kiesRepo } from '@/lib/boekhouding/modus';
import { JaarafsluitingScherm } from '@/components/boekhouding/JaarSchermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Jaarafsluiting · Studio Levant' };

// De jaarafsluiting van één boekjaar: checklist, banksaldi per 31-12, de afsluitpost en
// afsluiten/heropenen (alleen de eigenaar met 2FA; de API controleert dat ook).
export default async function JaarafsluitingPage({ params }: { params: Promise<{ jaar: string }> }) {
  const { jaar: tekst } = await params;
  const lid = await vereisTeamlidPagina(`/boekhouding/rapporten/jaarafsluiting/${encodeURIComponent(tekst)}`);
  const jaar = /^\d{4}$/.test(tekst) ? Number(tekst) : NaN;
  if (!(jaar >= 2000 && jaar <= 2999)) notFound();
  const repo = await kiesRepo(lid);
  return <JaarafsluitingScherm repo={repo} jaar={jaar} eigenaar={lid.rol === 'eigenaar' && lid.tfa.aal === 'aal2'} demoReden={demoAfgedwongen() ? 'env' : 'migratie'} />;
}
