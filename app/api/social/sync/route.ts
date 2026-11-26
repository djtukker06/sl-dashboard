import { teamlidRoute } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { syncAlles } from '@/lib/social/sync';
import { MIGRATIE_MELDING } from '@/lib/social/types';
import { fout, json } from '@/lib/social/meta/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/social/sync → { ok, accounts, nieuw, inzichten, fouten }: nu de posts (ook die
// buiten het dashboard zijn geplaatst) en de cijfers ophalen voor alle gekoppelde accounts.
// Hetzelfde als de cron eens per 6 uur doet (lib/social/sync.ts); per account hooguit eens
// per 2 minuten.
export const POST = teamlidRoute(async (_request, _ctx, lid) => {
  const r = await syncAlles(createServiceRoleClient(lid.bewijs), new Date(), { alleenNodig: false, deadline: Date.now() + 100_000 });
  if (r.status === 'niet_ingericht') return fout(503, 'Meta is nog niet ingericht op de server (META_APP_ID, META_APP_SECRET en een sleutel).', 'niet_ingericht');
  if (r.status === 'migratie_ontbreekt') return fout(503, MIGRATIE_MELDING, 'tabel_ontbreekt');
  return json({ ok: true, ...r });
}, { label: 'social-sync' });
