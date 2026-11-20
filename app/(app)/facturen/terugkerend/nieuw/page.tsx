import { redirect } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';

// Een nieuwe terugkerende factuur maak je via Nieuwe factuur → Terugkerend; dit adres blijft
// voor oude links en bladwijzers.
export default async function NieuweTerugkerendePage() {
  await vereisTeamlidPagina('/facturen/terugkerend/nieuw');
  redirect('/facturen/nieuwe-factuur?soort=terugkerend');
}
