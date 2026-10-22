import type { Teamlid } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { AgendaFout, dashboardPlanning } from '@/lib/agenda/repo';
import { KaartSkelet } from './Kaart';
import { Planning, type PlanningData } from './Planning';

// Server-deel van jouw planning op het dashboard: deze week + achterstallige taken voor
// jou, en wat je aan anderen uitdeelde (gebruikerscliënt, RLS). Daarna houden de
// client-widgets het zelf bij.
export async function PlanningWidgets({ lid }: { lid: Teamlid }) {
  const vandaag = vandaagNL();
  let data: PlanningData | null = null;
  let fout: 'niet-ingericht' | 'fout' | null = null;
  try {
    data = await dashboardPlanning(bronVan(lid), vandaag);
  } catch (e) {
    fout = e instanceof AgendaFout && e.code === 'tabel_ontbreekt' ? 'niet-ingericht' : 'fout';
  }
  return <Planning vandaag={vandaag} data={data} fout={fout} />;
}

/** Laadstaat met dezelfde vorm als de echte widgets. */
export function PlanningSkelet() {
  return (
    <>
      <KaartSkelet label="Vandaag" regels={3} className="db-breed" />
      <KaartSkelet label="Deze week" regels={2} className="db-smal" />
      <KaartSkelet label="Taken" regels={4} className="db-breed" />
    </>
  );
}
