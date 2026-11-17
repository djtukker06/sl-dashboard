import { redirect } from 'next/navigation';

// Een nieuwe terugkerende factuur maak je via Nieuwe factuur → Terugkerend; dit adres blijft
// voor oude links en bladwijzers.
export default function NieuweTerugkerendePage() {
  redirect('/facturen/nieuwe-factuur?soort=terugkerend');
}
