import { redirect } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';

export const dynamic = 'force-dynamic';

// Projecten staan nu onder Klanten & projecten (/projecten). Oude links en bladwijzers
// naar /agenda/projecten komen daar vanzelf terecht.
export default async function OudeProjectenPage() {
  await vereisTeamlidPagina('/projecten');
  redirect('/projecten');
}
