import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Dag } from './datum';
import type { Afspraak } from './types';
import { metGoogleAfspraken } from '@/lib/google-agenda/afspraken';
import { metAppleAfspraken } from '@/lib/apple-agenda/afspraken';

/**
 * Eigen afspraken aangevuld met die uit gekoppelde agenda's (Google: vandaag + 6 dagen,
 * Apple: [van, tot]). Beide tegelijk en best effort (elk max. 2,5 s).
 */
export async function metExterneAfspraken(service: SupabaseClient, userId: string, van: Dag, tot: Dag, eigen: Afspraak[]): Promise<Afspraak[]> {
  const [google, apple] = await Promise.all([
    metGoogleAfspraken(service, userId, van, []).catch(() => [] as Afspraak[]),
    metAppleAfspraken(service, userId, van, tot, []).catch(() => [] as Afspraak[])
  ]);
  if (!google.length && !apple.length) return eigen;
  return [...eigen, ...google, ...apple].sort((a, b) => a.start.localeCompare(b.start));
}
