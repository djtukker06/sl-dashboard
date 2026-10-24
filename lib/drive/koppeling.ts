import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Teamlid, TeamlidBewijs } from '@/lib/auth/team';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { clientId, clientSecret, ontbrekendeEnv, ontsleutelToken } from './config';
import { DriveClient, DriveFout, MELDING, vernieuwToken } from './kern';
import type { DriveStatus } from './types';

// De ene koppeling met de Google Drive van Studio Levant (tabel drive_koppeling, migratie
// 0024; alleen de service-role leest hem, en alleen ná de teamlidcontrole: het bewijs).
//
// Access tokens (1 uur geldig) blijven in het geheugen van de server tot vlak voor het
// verlopen; het refresh token staat versleuteld in de database (lib/drive/config.ts).
// Een ingetrokken toestemming (invalid_grant) geeft DriveFout 'opnieuw_koppelen'.

export interface KoppelingRij {
  google_email: string;
  refresh_token_enc: string;
  root_id: string;
  gekoppeld_door: string | null;
  gekoppeld_op: string;
}

export interface Verbinding {
  client: DriveClient;
  rootId: string;
  email: string;
  service: SupabaseClient;
}

export async function leesKoppeling(service: SupabaseClient): Promise<KoppelingRij | null> {
  const { data, error } = await service
    .from('drive_koppeling')
    .select('google_email, refresh_token_enc, root_id, gekoppeld_door, gekoppeld_op')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    if (tabelOntbreekt(error)) throw new DriveFout('tabel_ontbreekt', MELDING.tabel_ontbreekt);
    console.error('[drive] koppeling lezen', error.code ?? '', error.message);
    throw new DriveFout('google', 'De koppeling kon niet worden gelezen. Probeer het opnieuw.');
  }
  return (data as KoppelingRij | null) ?? null;
}

// ---------------------------------------------------------------------------------
// Access token in het geheugen (per refresh token)
// ---------------------------------------------------------------------------------
let cache: { sleutel: string; token: string; verloopt: number } | null = null;
let lopend: { sleutel: string; belofte: Promise<string> } | null = null;

export function vergeetToken(): void {
  cache = null;
  lopend = null;
}

/** Zet een vers access token (bv. direct na het koppelen) in de cache. */
export function onthoudToken(sleutel: string, token: string, verlooptOverSec: number): void {
  cache = { sleutel, token, verloopt: Date.now() + Math.max(60, verlooptOverSec - 120) * 1000 };
}

async function accessToken(refreshToken: string, sleutel: string, vers = false): Promise<string> {
  if (!vers && cache && cache.sleutel === sleutel && cache.verloopt > Date.now()) return cache.token;
  if (lopend && lopend.sleutel === sleutel) return lopend.belofte;
  const belofte = (async () => {
    try {
      const t = await vernieuwToken(fetch, { clientId: clientId(), clientSecret: clientSecret(), refreshToken });
      onthoudToken(sleutel, t.accessToken, t.verlooptOver);
      return t.accessToken;
    } catch (e) {
      if (e instanceof DriveFout && e.code === 'opnieuw_koppelen') cache = null;
      throw e;
    } finally {
      lopend = null;
    }
  })();
  lopend = { sleutel, belofte };
  return belofte;
}

/** De Drive-client van de koppeling; gooit DriveFout als er (nog) niets is. */
export async function verbind(bewijs: TeamlidBewijs): Promise<Verbinding> {
  return verbindMetService(createServiceRoleClient(bewijs));
}

/**
 * Zelfde als verbind(), met een al gemaakte service-role client. Voor de back-up-cron
 * (de systeem-client van lib/auth/cron.ts, pas na de controle van CRON_SECRET) en de
 * back-uproutes.
 */
export async function verbindMetService(service: SupabaseClient): Promise<Verbinding> {
  if (ontbrekendeEnv().length) throw new DriveFout('niet_ingericht', MELDING.niet_ingericht);
  const k = await leesKoppeling(service);
  if (!k) throw new DriveFout('niet_gekoppeld', MELDING.niet_gekoppeld);
  const refresh = ontsleutelToken(k.refresh_token_enc);
  if (!refresh) throw new DriveFout('opnieuw_koppelen', MELDING.opnieuw_koppelen);
  const client = new DriveClient(fetch, (vers) => accessToken(refresh, k.refresh_token_enc, vers));
  return { client, rootId: k.root_id, email: k.google_email, service };
}

/** Status voor de schermen (nooit tokens). */
export async function driveStatus(lid: Teamlid): Promise<DriveStatus> {
  const ontbreekt = ontbrekendeEnv();
  const basis: DriveStatus = {
    ingericht: ontbreekt.length === 0,
    ontbreekt,
    tabellen: true,
    gekoppeld: false,
    email: null,
    rootId: null,
    eigenaar: lid.rol === 'eigenaar'
  };
  if (lid.overgang) return { ...basis, tabellen: false };
  try {
    const k = await leesKoppeling(createServiceRoleClient(lid.bewijs));
    if (!k) return basis;
    return { ...basis, gekoppeld: true, email: k.google_email || null, rootId: k.root_id };
  } catch (e) {
    if (e instanceof DriveFout && e.code === 'tabel_ontbreekt') return { ...basis, tabellen: false };
    throw e;
  }
}
