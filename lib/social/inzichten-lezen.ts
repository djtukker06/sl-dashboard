import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { amsterdamNaarUtc } from './kern';
import { dbFout, leesAccounts } from './posts';
import { volgendeDag } from './weergave';
import type { AccountInzichtDto, InzichtCijfers, InzichtenAntwoord, PostInzichtDto } from './types';

// Analytics lezen (GET /api/social/inzichten). De cijfers zelf haalt de sync/cron bij Meta
// op (lib/social/plaatsen.ts e.a.) en zet ze in social_inzichten (per post, per dag een stand)
// en social_account_inzichten (per account per dag). Hier alleen lezen, via de service-role
// ná de teamlidcontrole.
//
// - accounts: de dagreeks (volgers, bereik, weergaven, profielbezoeken) binnen de periode;
// - posts: elke post die in de periode geplaatst is, met zijn laatst opgehaalde stand. Ook
//   posts die buiten het dashboard zijn geplaatst (bron 'extern') staan erbij: die heeft de
//   sync als post met kanaal opgeslagen, of (zonder kanaal) alleen in social_inzichten.

const MAX_KANALEN = 2000;

export async function leesInzichten(service: SupabaseClient, van: string, tot: string): Promise<InzichtenAntwoord> {
  const vanUtc = amsterdamNaarUtc(van, '00:00')!.toISOString();
  const totUtc = amsterdamNaarUtc(volgendeDag(tot), '00:00')!.toISOString();

  const [accounts, reeksen, kanalen, zonderKanaal] = await Promise.all([
    leesAccounts(service),
    service
      .from('social_account_inzichten')
      .select('account_id,datum,volgers,bereik,weergaven,profielbezoeken,cijfers')
      .gte('datum', van)
      .lte('datum', tot)
      .order('datum')
      .limit(5000),
    service
      .from('social_post_kanalen')
      .select('id,post_id,account_id,extern_post_id,permalink,geplaatst_op')
      .not('extern_post_id', 'is', null)
      .gte('geplaatst_op', vanUtc)
      .lt('geplaatst_op', totUtc)
      .order('geplaatst_op', { ascending: false })
      .limit(MAX_KANALEN),
    service
      .from('social_inzichten')
      .select('account_id,extern_post_id,datum,cijfers')
      .is('post_kanaal_id', null)
      .gte('datum', van)
      .lte('datum', tot)
      .order('datum', { ascending: false })
      .limit(5000)
  ]);
  for (const r of [reeksen, kanalen, zonderKanaal]) if (r.error) throw dbFout(r.error);

  // Laatste stand per post-kanaal.
  const kanaalRijen = (kanalen.data ?? []) as { id: string; post_id: string; account_id: string; extern_post_id: string; permalink: string | null; geplaatst_op: string | null }[];
  const laatste = new Map<string, InzichtCijfers>();
  for (let i = 0; i < kanaalRijen.length; i += 150) {
    const stuk = kanaalRijen.slice(i, i + 150).map((k) => k.id);
    const { data, error } = await service
      .from('social_inzichten')
      .select('post_kanaal_id,datum,cijfers')
      .in('post_kanaal_id', stuk)
      .order('datum', { ascending: false })
      .limit(10000);
    if (error) throw dbFout(error);
    for (const r of (data ?? []) as { post_kanaal_id: string; cijfers: InzichtCijfers }[]) {
      if (!laatste.has(r.post_kanaal_id)) laatste.set(r.post_kanaal_id, r.cijfers ?? {});
    }
  }

  const posts: PostInzichtDto[] = kanaalRijen.map((k) => ({
    post_id: k.post_id,
    post_kanaal_id: k.id,
    account_id: k.account_id,
    extern_post_id: k.extern_post_id,
    permalink: k.permalink,
    geplaatst_op: k.geplaatst_op,
    cijfers: laatste.get(k.id) ?? {}
  }));
  const gezien = new Set(posts.map((p) => `${p.account_id}:${p.extern_post_id}`));
  for (const r of (zonderKanaal.data ?? []) as { account_id: string; extern_post_id: string; cijfers: InzichtCijfers }[]) {
    const sleutel = `${r.account_id}:${r.extern_post_id}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    posts.push({ post_id: null, post_kanaal_id: null, account_id: r.account_id, extern_post_id: r.extern_post_id, permalink: null, geplaatst_op: null, cijfers: r.cijfers ?? {} });
  }

  const perAccount = new Map<string, AccountInzichtDto[]>();
  for (const r of (reeksen.data ?? []) as (AccountInzichtDto & { account_id: string })[]) {
    const lijst = perAccount.get(r.account_id) ?? [];
    lijst.push({ datum: r.datum, volgers: r.volgers, bereik: r.bereik, weergaven: r.weergaven, profielbezoeken: r.profielbezoeken, cijfers: r.cijfers ?? {} });
    perAccount.set(r.account_id, lijst);
  }

  return {
    van,
    tot,
    accounts: accounts.map((account) => ({ account, reeks: perAccount.get(account.id) ?? [] })),
    posts
  };
}
