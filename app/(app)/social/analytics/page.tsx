import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Analytics } from '@/components/social/Analytics';
import { SocialNav } from '@/components/social/SocialNav';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Analytics · Social · Studio Levant' };

// Analytics van de geplaatste posts en de accounts (GET /api/social/inzichten).
export default async function SocialAnalyticsPage() {
  await vereisTeamlidPagina('/social/analytics');
  return (
    <div className="db so">
      <ModuleKop label="Social" titel="Analytics" />
      <SocialNav actief="analytics" />
      <Analytics />
    </div>
  );
}
