import { FacturenSkelet } from '@/components/shell/LadenScherm';

// Binnen Facturen staat de kop al in facturen/layout.tsx (die blijft staan): hier alleen het
// skelet van de inhoud, in dezelfde .wrap-kolom als de facturenschermen.
export default function FacturenLaden() {
  return <FacturenSkelet />;
}
