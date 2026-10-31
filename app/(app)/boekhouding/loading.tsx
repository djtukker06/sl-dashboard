import { LadenScherm } from '@/components/shell/LadenScherm';

// Wisselen tussen de Boekhouding-schermen (overzicht, bonnetjes, bank, btw, ...): de kop en de
// subnavigatie blijven staan, alleen de inhoud laadt. Zonder deze grens bleef het vorige
// scherm staan tot het nieuwe klaar was (de grens in app/(app) is dan al zichtbaar).
// Filters binnen één scherm (?jaar=, ?q=) vallen hier niet onder: die horen bij een dieper
// segment zonder loading.tsx en laten het scherm dus gewoon staan.
export default function BoekhoudingLaden() {
  return <LadenScherm />;
}
