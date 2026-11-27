import type { Metadata } from 'next';
import Link from 'next/link';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { amsterdamDatum } from '@/lib/social/kern';
import { accountsVoorPagina } from '@/lib/social/posts';
import { FILTER_STATUSSEN } from '@/lib/social/weergave';
import type { PostStatus } from '@/lib/social/types';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Overzicht } from '@/components/social/Overzicht';
import { SocialNav } from '@/components/social/SocialNav';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Social · Studio Levant' };

// Social media management: overzicht van alle posts (geplaatst, ingepland, concepten,
// mislukt en posts die buiten het dashboard zijn geplaatst) als lijst of maandkalender.
// De posts haalt de client op (GET /api/social/posts), zodat de filters direct werken.
export default async function SocialPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const lid = await vereisTeamlidPagina('/social');
  const sp = await searchParams;
  const startStatus = FILTER_STATUSSEN.some((s) => s.waarde === sp.status) ? (sp.status as PostStatus) : null;
  const { accounts, melding } = await accountsVoorPagina(lid);
  return (
    <div className="db so">
      <ModuleKop label="Social media" titel="Social">
        <Link className="db-knop db-knop-primair" href="/social/nieuw">
          + Nieuwe post
        </Link>
      </ModuleKop>
      <SocialNav actief="overzicht" />
      <Overzicht accounts={accounts} melding={melding} startMaand={amsterdamDatum(new Date()).slice(0, 7)} startStatus={startStatus} />
    </div>
  );
}
