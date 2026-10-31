import { DashboardSkelet } from '@/components/dashboard/DashboardSkelet';
import { LadenScherm } from '@/components/shell/LadenScherm';

// Direct zichtbaar bij het wisselen van tabblad: de rail blijft staan en de kop van de
// nieuwe pagina (label, titel, subnavigatie, knoppen) staat meteen op zijn vaste plek; alleen
// de inhoud eronder is een skelet tot de pagina er is (de server streamt hem daarna in).
// LadenScherm kiest de kop bij het pad. Dankzij deze grens haalt Next de shell van een
// tabblad ook al vooraf op (prefetch) zodra de link in beeld is.
export default function Laden() {
  return <LadenScherm dashboard={<DashboardSkelet />} />;
}
