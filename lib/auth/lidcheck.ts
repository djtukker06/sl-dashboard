import type { SupabaseClient } from '@supabase/supabase-js';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { foutSamenvatting } from '@/lib/log';
import { alsAal, type Aal } from './tfa-kern';

// Lichte lidmaatschapscontrole voor plekken waar net een sessie is geopend (inloggen,
// /auth/callback, nieuw wachtwoord) en voor proxy.ts. Eén rondgang:
//   - met migratie 0026: toegang_status() (lid, rol, aal, heeft een 2FA-factor);
//   - zonder 0026: is_teamlid() (migratie 0021), zonder 2FA-gegevens.
//   'lid'      actief teamlid
//   'geen'     ingelogd, maar geen (actief) teamlid
//   'overgang' ook is_teamlid() bestaat nog niet (0021 niet uitgevoerd): gedrag van vóór 0021
//   'storing'  controle mislukt — behandelen als geen toegang (fail closed)
export type LidCheck = 'lid' | 'geen' | 'overgang' | 'storing';

export interface Toegang {
  lid: LidCheck;
  /** Heeft een geverifieerde 2FA-factor (alleen bekend met 0026). */
  heeftFactor: boolean;
  aal: Aal;
  /** toegang_status() bestaat (migratie 0026 uitgevoerd). */
  migratie: boolean;
}

export async function toegangStatus(sb: SupabaseClient): Promise<Toegang> {
  const { data, error } = await sb.rpc('toegang_status');
  if (!error && data && typeof data === 'object') {
    const d = data as { lid?: boolean; aal?: string; heeft_factor?: boolean };
    return { lid: d.lid === true ? 'lid' : 'geen', heeftFactor: d.heeft_factor === true, aal: alsAal(d.aal), migratie: true };
  }
  if (error && !tabelOntbreekt(error)) {
    console.error('[team] toegang_status mislukt', foutSamenvatting(error));
    return { lid: 'storing', heeftFactor: false, aal: 'aal1', migratie: true };
  }
  return { lid: await controleerLid(sb), heeftFactor: false, aal: 'aal1', migratie: false };
}

export async function controleerLid(sb: SupabaseClient): Promise<LidCheck> {
  const { data, error } = await sb.rpc('is_teamlid');
  if (error) {
    if (tabelOntbreekt(error)) return process.env.TEAM_VEREIST === '0' ? 'overgang' : 'storing';
    console.error('[team] is_teamlid mislukt', foutSamenvatting(error));
    return 'storing';
  }
  return data === true ? 'lid' : 'geen';
}
