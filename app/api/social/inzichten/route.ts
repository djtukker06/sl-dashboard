import { leesInzichten } from '@/lib/social/inzichten-lezen';
import { SocialFout, fout, json, socialRoute } from '@/lib/social/posts';
import { isDatum, periodeBereik, volgendeDag } from '@/lib/social/weergave';
import { MIGRATIE_MELDING } from '@/lib/social/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/social/inzichten?van=YYYY-MM-DD&tot=YYYY-MM-DD → InzichtenAntwoord
// Standaard de laatste 30 dagen; max. 366 dagen. Vóór migratie 0041: lege lijsten + melding.
export const GET = socialRoute(async (request, _ctx, service) => {
  const p = new URL(request.url).searchParams;
  const standaard = periodeBereik(30, new Date());
  const van = p.get('van') || standaard.van;
  const tot = p.get('tot') || standaard.tot;
  if (!isDatum(van) || !isDatum(tot)) return fout(400, 'Ongeldige datum (YYYY-MM-DD).');
  if (van > tot) return fout(400, 'De begindatum ligt na de einddatum.');
  if (volgendeDag(van, 366) < tot) return fout(400, 'Kies een periode van max. een jaar.');
  try {
    return json(await leesInzichten(service, van, tot));
  } catch (e) {
    if (e instanceof SocialFout && e.code === 'migratie') return json({ van, tot, accounts: [], posts: [], melding: MIGRATIE_MELDING });
    throw e;
  }
}, 'social inzichten');
