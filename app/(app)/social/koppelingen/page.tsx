import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Koppelingen } from '@/components/social/Koppelingen';
import { SocialNav } from '@/components/social/SocialNav';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Koppelingen · Social · Studio Levant' };

// Instagram- en Facebook-koppelingen. Na het koppelen stuurt de callback terug met
// ?gekoppeld=<aantal> of ?fout=<code> (app/api/social/meta/callback).
export default async function SocialKoppelingenPage({ searchParams }: { searchParams: Promise<{ gekoppeld?: string; fout?: string }> }) {
  await vereisTeamlidPagina('/social/koppelingen');
  const sp = await searchParams;
  const gekoppeld = typeof sp.gekoppeld === 'string' && /^\d{1,3}$/.test(sp.gekoppeld) ? sp.gekoppeld : null;
  const fout = typeof sp.fout === 'string' && /^[a-z_]{1,40}$/.test(sp.fout) ? sp.fout : null;
  return (
    <div className="db so">
      <ModuleKop label="Social" titel="Koppelingen" />
      <SocialNav actief="koppelingen" />
      <Koppelingen gekoppeld={gekoppeld} fout={fout} />
    </div>
  );
}
