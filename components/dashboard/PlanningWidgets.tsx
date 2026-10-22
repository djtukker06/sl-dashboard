import { createClient } from '@/lib/supabase/server';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { AgendaFout, dashboardPlanning } from '@/lib/agenda/repo';
import { KaartSkelet } from './Kaart';
import { Planning, type PlanningData } from './Planning';

// Server-deel van de planning op het dashboard: haalt deze week + achterstallige taken op
// (gebruikerscliënt, RLS) en geeft ze aan de client-widgets.
export async function PlanningWidgets() {
  const supabase = await createClient();
  const vandaag = vandaagNL();
  let data: PlanningData | null = null;
  let fout: 'niet-ingericht' | 'fout' | null = null;
  try {
    data = await dashboardPlanning(supabase, vandaag);
  } catch (e) {
    fout = e instanceof AgendaFout && e.code === 'tabel_ontbreekt' ? 'niet-ingericht' : 'fout';
  }
  return <Planning vandaag={vandaag} data={data} fout={fout} />;
}

/** Laadstaat met dezelfde vorm als de echte widgets. */
export function PlanningSkelet() {
  return (
    <>
      <section className="db-snel" aria-hidden="true">
        <div className="db-skelet db-skelet-invoer" />
      </section>
      <KaartSkelet label="Vandaag" regels={3} className="db-breed" />
      <KaartSkelet label="Deze week" regels={2} className="db-smal" />
      <KaartSkelet label="Taken" regels={4} className="db-breed" />
    </>
  );
}
