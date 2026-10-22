import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';

// Lichte lidmaatschapscontrole via de database-functie is_teamlid() (migratie 0021), voor
// plekken waar net een sessie is geopend (inloggen, /auth/callback) en voor proxy.ts.
//   'lid'      actief teamlid
//   'geen'     ingelogd, maar geen (actief) teamlid
//   'overgang' de functie bestaat nog niet (0021 niet uitgevoerd): gedrag van vóór 0021
//   'storing'  controle mislukt — behandelen als geen toegang (fail closed)
export type LidCheck = 'lid' | 'geen' | 'overgang' | 'storing';

export async function controleerLid(sb: SupabaseClient): Promise<LidCheck> {
  const { data, error } = await sb.rpc('is_teamlid');
  if (error) {
    if (tabelOntbreekt(error)) return 'overgang';
    console.error('[team] is_teamlid mislukt', error.code ?? '', error.message);
    return 'storing';
  }
  return data === true ? 'lid' : 'geen';
}
