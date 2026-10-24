import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { BeveiligingApp } from '@/components/beveiliging/BeveiligingApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Beveiliging · Studio Levant' };

// Alleen voor de eigenaar: wie heeft tweestapsverificatie (en 2FA resetten), en de audit-log
// van gevoelige acties. De routes eronder (app/api/beveiliging/*) eisen zelf ook eigenaar + aal2.
export default async function BeveiligingPagina() {
  const lid = await vereisTeamlidPagina('/beveiliging');
  if (lid.rol !== 'eigenaar') redirect('/account#beveiliging');
  return (
    <BeveiligingApp
      aal2={lid.tfa.aal === 'aal2'}
      migratie={lid.tfa.migratie}
      afdwingen={lid.tfa.afdwingen}
      rls={lid.tfa.rls}
      mijnId={lid.userId}
    />
  );
}
