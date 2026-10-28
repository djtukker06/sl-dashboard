import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { GebruikersApp } from '@/components/beveiliging/GebruikersApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Gebruikers · Studio Levant' };

// Alleen voor de admin: gebruikers aanmaken, wijzigen, deactiveren en verwijderen. De routes
// eronder (app/api/beveiliging/gebruikers) eisen zelf ook admin + aal2.
export default async function GebruikersPagina() {
  const lid = await vereisTeamlidPagina('/gebruikers');
  if (lid.rol !== 'eigenaar') redirect('/');
  return <GebruikersApp aal2={lid.tfa.aal === 'aal2'} />;
}
