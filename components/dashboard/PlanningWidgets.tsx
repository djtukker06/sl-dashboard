import type { Teamlid } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { plusDagen, vandaag as vandaagNL } from '@/lib/agenda/datum';
import { AgendaFout, dashboardPlanning } from '@/lib/agenda/repo';
import { metExterneAfspraken } from '@/lib/agenda/extern-server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
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
    const p = await dashboardPlanning(bronVan(lid), vandaag);
    // Plus je afspraken uit gekoppelde Google- en Apple-agenda's (0035, 0040; best effort, max. 2,5 s).
    data = { ...p, afspraken: await metExterneAfspraken(createServiceRoleClient(lid.bewijs), lid.userId, vandaag, plusDagen(vandaag, 6), p.afspraken) };
  } catch (e) {
    fout = e instanceof AgendaFout && e.code === 'tabel_ontbreekt' ? 'niet-ingericht' : 'fout';
  }
  return <Planning vandaag={vandaag} data={data} fout={fout} />;
}

/** Laadstaat met dezelfde vorm als de echte widgets. */
export function PlanningSkelet() {
  return (
    <>
      <KaartSkelet label="Vandaag" regels={3} className="db-breed db-vandaag" />
      <KaartSkelet label="Deze week" regels={2} className="db-smal db-week-stapel" />
      <KaartSkelet label="Taken" regels={4} className="db-breed db-taken" />
    </>
  );
}
