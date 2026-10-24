import 'server-only';
import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Teamlid } from '@/lib/auth/team';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logFout } from '@/lib/log';
import { DemoRepo } from './repo/demo';
import { SupabaseRepo } from './repo/supabase';
import { BoekhoudFout, type BoekhoudModus, type BoekhoudRepo } from './repo/types';

// Welke opslag gebruikt de boekhouding?
//   - BOEKHOUDING_DEMO=1                    → demo (voorbeeldgegevens, niets opslaan)
//   - tabel bk_instellingen bestaat niet     → demo (migratie 0027 nog niet uitgevoerd; de
//                                              preview op Vercel deelt de productiedatabase)
//   - een andere fout bij het controleren    → foutmelding (fail closed, nooit stil naar demo)
//   - anders                                  → live (de echte tabellen, met RLS)
// "live" onthouden we 5 minuten per serverinstantie (geen extra rondgang per verzoek);
// "demo" door een ontbrekende tabel controleren we elke keer opnieuw, zodat de app direct na
// het uitvoeren van 0027 overschakelt.

const LIVE_ONTHOUDEN_MS = 5 * 60 * 1000;
let liveTot = 0;

export function demoAfgedwongen(): boolean {
  return process.env.BOEKHOUDING_DEMO === '1';
}

async function bepaalModus(sb: SupabaseClient): Promise<BoekhoudModus> {
  if (demoAfgedwongen()) return 'demo';
  if (Date.now() < liveTot) return 'live';
  const { error } = await sb.from('bk_instellingen').select('id').limit(1);
  if (!error) {
    liveTot = Date.now() + LIVE_ONTHOUDEN_MS;
    return 'live';
  }
  if (tabelOntbreekt(error)) return 'demo';
  logFout('[boekhouding] modus bepalen', error);
  throw new BoekhoudFout(503, 'De boekhouding is even niet bereikbaar. Probeer het zo opnieuw.', 'storing');
}

/** De modus voor dit verzoek (binnen één render maar één keer bepaald). */
export const boekhoudModus = cache(async (lid: Teamlid): Promise<BoekhoudModus> => bepaalModus(lid.sb));

/** De opslag voor dit teamlid: echt (RLS) of de demo in het geheugen. */
export async function kiesRepo(lid: Teamlid): Promise<BoekhoudRepo> {
  const modus = await boekhoudModus(lid);
  return modus === 'demo' ? new DemoRepo(lid.userId, lid.userId) : new SupabaseRepo(lid.sb, lid.userId);
}
