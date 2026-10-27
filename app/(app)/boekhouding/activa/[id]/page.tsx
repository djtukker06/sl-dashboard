import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { repoVoorPagina } from '@/lib/boekhouding/modus';
import { NietIngericht } from '@/components/boekhouding/NietIngericht';
import { isUuid } from '@/lib/boekhouding/api';
import { ActivumScherm } from '@/components/boekhouding/ActivaSchermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Activum · Studio Levant' };

// Eén activum: afschrijvingsschema (per jaar en per maand), herkomst, wijzigen, desinvesteren.
export default async function ActivumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lid = await vereisTeamlidPagina(`/boekhouding/activa/${encodeURIComponent(id)}`);
  if (!isUuid(id)) notFound();
  const repo = await repoVoorPagina(lid);
  if (!repo) return <NietIngericht titel="Activum" />;
  const scherm = await ActivumScherm({ repo, id });
  if (!scherm) notFound();
  return scherm;
}
