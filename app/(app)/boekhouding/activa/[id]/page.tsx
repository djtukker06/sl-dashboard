import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { demoAfgedwongen, kiesRepo } from '@/lib/boekhouding/modus';
import { isUuid } from '@/lib/boekhouding/api';
import { ActivumScherm } from '@/components/boekhouding/ActivaSchermen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Activum · Studio Levant' };

// Eén activum: afschrijvingsschema (per jaar en per maand), herkomst, wijzigen, desinvesteren.
export default async function ActivumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lid = await vereisTeamlidPagina(`/boekhouding/activa/${encodeURIComponent(id)}`);
  if (!isUuid(id)) notFound();
  const repo = await kiesRepo(lid);
  const scherm = await ActivumScherm({ repo, id, demoReden: demoAfgedwongen() ? 'env' : 'migratie' });
  if (!scherm) notFound();
  return scherm;
}
