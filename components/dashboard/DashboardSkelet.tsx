import { KaartSkelet } from '@/components/dashboard/Kaart';
import { InboxKaartSkelet } from '@/components/dashboard/InboxKaart';
import { PlanningSkelet } from '@/components/dashboard/PlanningWidgets';

// Het raster van het dashboard met precies dezelfde skeletten als de Suspense-fallbacks in
// app/(app)/page.tsx: het laadscherm (app/(app)/loading.tsx) toont dit onder de kop, zodat
// de kaarten daarna op hun plek inladen in plaats van te verspringen.
export function DashboardSkelet() {
  return (
    <div className="db-grid" aria-busy="true" aria-label="Laden…">
      <PlanningSkelet />
      <InboxKaartSkelet />
      <KaartSkelet label="Recente posts" regels={2} className="db-breed db-social" />
      <div className="db-smal db-stapel">
        <KaartSkelet label="Projecten" regels={1} className="db-projecten" />
        <KaartSkelet label="Facturen" className="db-facturen" />
        <KaartSkelet label="Laatste bonnetjes" className="db-uitgaven" />
      </div>
      <KaartSkelet label="Scratchpad" regels={3} className="db-scratchpad" />
    </div>
  );
}
