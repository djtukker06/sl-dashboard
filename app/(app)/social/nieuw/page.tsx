import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { accountsVoorPagina } from '@/lib/social/posts';
import { isDatum } from '@/lib/social/weergave';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Editor } from '@/components/social/Editor';
import { SocialNav } from '@/components/social/SocialNav';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Nieuwe post · Social · Studio Levant' };

// Nieuwe post. ?datum=YYYY-MM-DD (klik op een dag in de kalender) zet die dag om 19:30 klaar.
export default async function NieuwePostPage({ searchParams }: { searchParams: Promise<{ datum?: string }> }) {
  const lid = await vereisTeamlidPagina('/social/nieuw');
  const sp = await searchParams;
  const { accounts, melding } = await accountsVoorPagina(lid);
  return (
    <div className="db so">
      <ModuleKop label="Social" titel="Nieuwe post" />
      <SocialNav actief={null} />
      <Editor accounts={accounts} post={null} startDatum={isDatum(sp.datum) ? sp.datum : null} melding={melding} />
    </div>
  );
}
