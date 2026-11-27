import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ontsleutelMet, versleutelMet } from '@/lib/mail/kluis-kern';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logFout } from '@/lib/log';
import { accountNaarDto } from './kern';
import { ingericht, sleutel } from './meta/config';
import { ACCOUNT_FOUT, magPlaatsen, tokenAad, type AccountFout } from './meta/kern';
import type { MetaPagina } from './meta/oauth';
import { MIGRATIE_MELDING, type AccountsAntwoord, type Platform, type SocialAccountRij } from './types';

// De gekoppelde Meta-accounts (social_accounts, migratie 0041): opslaan na de login, lezen,
// ontkoppelen en de fout-status bijhouden. Alleen de server (service-role) leest en schrijft.
//
// Het page access token gaat door dezelfde AES-256-GCM-kluis als Drive en de mailboxen
// (sleutel: SOCIAL_ENCRYPTION_KEY, anders MAIL_ENCRYPTION_KEY), met een AAD die aan het
// platform en het externe id vastzit ("social-meta:instagram:<ig-id>"): een gekopieerde
// waarde is bij een ander account onbruikbaar. Het ontsleutelde token verlaat de server nooit
// en komt nooit in een log.
//
// Ontkoppelen haalt het token weg en zet het account op inactief (de rij blijft, zodat
// geplaatste posts en hun cijfers bewaard blijven; opnieuw koppelen zet hem weer aan).

export const ACCOUNT_KOLOMMEN =
  'id,platform,extern_id,naam,gebruikersnaam,afbeelding_url,page_id,token_enc,token_verloopt_op,scopes,gekoppeld_door,gekoppeld_op,laatst_gesynct_op,fout,actief';

export class KoppelFout extends Error {
  code: 'niet_ingericht' | 'tabel_ontbreekt' | 'db';
  constructor(code: KoppelFout['code'], melding: string) {
    super(melding);
    this.code = code;
  }
}

function dbFout(error: unknown, waar: string): KoppelFout {
  if (tabelOntbreekt(error)) return new KoppelFout('tabel_ontbreekt', MIGRATIE_MELDING);
  logFout(`[social] ${waar}`, error);
  return new KoppelFout('db', 'De social-koppelingen konden niet worden gelezen of opgeslagen.');
}

export function versleutelToken(platform: Platform, externId: string, token: string): string {
  const k = sleutel();
  if (!k) throw new KoppelFout('niet_ingericht', 'Er is geen sleutel ingesteld voor de social-koppeling.');
  return versleutelMet(k, token, tokenAad(platform, externId));
}

/** Het page token van een account, of null (ontkoppeld, andere sleutel of geknoei). */
export function tokenVan(rij: Pick<SocialAccountRij, 'platform' | 'extern_id' | 'token_enc'>): string | null {
  const k = sleutel();
  if (!k || !rij.token_enc) return null;
  try {
    return ontsleutelMet(k, rij.token_enc, tokenAad(rij.platform, rij.extern_id));
  } catch {
    return null;
  }
}

export async function alleAccounts(service: SupabaseClient): Promise<SocialAccountRij[]> {
  const { data, error } = await service.from('social_accounts').select(ACCOUNT_KOLOMMEN).order('platform').order('naam');
  if (error) throw dbFout(error, 'accounts lezen');
  return (data ?? []) as SocialAccountRij[];
}

export async function accountsMetIds(service: SupabaseClient, ids: string[]): Promise<Map<string, SocialAccountRij>> {
  const uit = new Map<string, SocialAccountRij>();
  const uniek = [...new Set(ids)];
  if (!uniek.length) return uit;
  const { data, error } = await service.from('social_accounts').select(ACCOUNT_KOLOMMEN).in('id', uniek);
  if (error) throw dbFout(error, 'accounts lezen');
  for (const r of (data ?? []) as SocialAccountRij[]) uit.set(r.id, r);
  return uit;
}

/** Voor GET /api/social/accounts: zonder tokens; vóór de migratie een melding in plaats van een fout. */
export async function accountsAntwoord(service: SupabaseClient): Promise<AccountsAntwoord> {
  try {
    return { accounts: (await alleAccounts(service)).map(accountNaarDto), ingericht: ingericht() };
  } catch (e) {
    if (e instanceof KoppelFout && e.code === 'tabel_ontbreekt') return { accounts: [], ingericht: ingericht(), melding: MIGRATIE_MELDING };
    throw e;
  }
}

/** Zet (of wist) de fout van een account. Best effort: een fout hierin blokkeert niets. */
export async function markeerAccount(service: SupabaseClient, accountId: string, fout: AccountFout | null, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await service.from('social_accounts').update({ fout, ...extra }).eq('id', accountId);
  if (error) logFout('[social] accountstatus bijwerken', error);
}

/**
 * Na de login: per pagina (waar je inhoud mag maken) een Facebook-account, en als er een
 * Instagram-account aan hangt ook dat (met het page token van die pagina). Bestaande rijen
 * (platform + extern_id) krijgen het nieuwe token en gaan weer aan.
 */
export async function slaKoppelingenOp(
  service: SupabaseClient,
  o: { paginas: MetaPagina[]; userId: string; scopes: string[]; verlooptOp: Date | null }
): Promise<{ facebook: number; instagram: number; overgeslagen: number }> {
  const nu = new Date().toISOString();
  const rijen: Record<string, unknown>[] = [];
  let overgeslagen = 0;
  const gemeen = {
    token_verloopt_op: o.verlooptOp ? o.verlooptOp.toISOString() : null,
    scopes: o.scopes.join(',').slice(0, 2000),
    gekoppeld_door: o.userId,
    gekoppeld_op: nu,
    fout: null,
    actief: true
  };
  for (const p of o.paginas) {
    if (!p.access_token || !magPlaatsen(p.tasks)) {
      overgeslagen++;
      continue;
    }
    rijen.push({
      platform: 'facebook',
      extern_id: p.id,
      naam: String(p.name ?? 'Facebookpagina').slice(0, 200),
      gebruikersnaam: null,
      afbeelding_url: p.picture?.data?.url?.slice(0, 2000) ?? null,
      page_id: p.id,
      token_enc: versleutelToken('facebook', p.id, p.access_token),
      ...gemeen
    });
    const ig = p.instagram_business_account;
    if (ig?.id && /^\d{1,40}$/.test(ig.id)) {
      rijen.push({
        platform: 'instagram',
        extern_id: ig.id,
        naam: String(ig.name || ig.username || 'Instagram').slice(0, 200),
        gebruikersnaam: ig.username?.slice(0, 100) ?? null,
        afbeelding_url: ig.profile_picture_url?.slice(0, 2000) ?? null,
        page_id: p.id,
        token_enc: versleutelToken('instagram', ig.id, p.access_token),
        ...gemeen
      });
    }
  }
  if (rijen.length) {
    const { error } = await service.from('social_accounts').upsert(rijen, { onConflict: 'platform,extern_id' });
    if (error) throw dbFout(error, 'koppeling opslaan');
  }
  return {
    facebook: rijen.filter((r) => r.platform === 'facebook').length,
    instagram: rijen.filter((r) => r.platform === 'instagram').length,
    overgeslagen
  };
}

/**
 * Ontkoppelen: token weg, inactief. Ingeplande kanalen van dit account krijgen een duidelijke
 * fout (ze worden niet meer geplaatst). Geeft false als het account niet bestaat.
 */
export async function ontkoppel(service: SupabaseClient, accountId: string): Promise<SocialAccountRij | null> {
  const { data, error } = await service
    .from('social_accounts')
    .update({ token_enc: '', actief: false, fout: ACCOUNT_FOUT.ontkoppeld, token_verloopt_op: null })
    .eq('id', accountId)
    .select(ACCOUNT_KOLOMMEN)
    .maybeSingle();
  if (error) throw dbFout(error, 'account ontkoppelen');
  if (!data) return null;
  const k = await service
    .from('social_post_kanalen')
    .update({ fout: 'Dit account is ontkoppeld. Koppel het opnieuw of kies een ander kanaal.' })
    .eq('account_id', accountId)
    .in('status', ['concept', 'ingepland']);
  if (k.error) logFout('[social] kanalen na ontkoppelen', k.error);
  return data as SocialAccountRij;
}
