import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { systeemClient } from '@/lib/supabase/systeem';
import { cronSecret } from '@/lib/backup/config';
import { logAudit } from '@/lib/audit';
import { logFout } from '@/lib/log';
import { cronBron, cronToegestaan, type CronBron } from './cron-kern';

// Beveiliging van de cron-routes (/api/cron/*). Geen sessie (Vercel Cron en GitHub Actions
// zijn geen gebruikers), dus:
//   - alleen GET, met "Authorization: Bearer <CRON_SECRET>" (vergeleken in constante tijd);
//   - zonder (geldige) CRON_SECRET in de env: altijd 503 (fail closed, nooit open);
//   - pas daarna een systeem-service-role (systeemClient('cron')) en een audit-regel.
// proxy.ts laat precies deze paden zonder sessie door; verder doet deze wrapper alles.

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
export type { CronBron };

export function cronRoute(naam: string, fn: (request: Request, ctx: { service: SupabaseClient; bron: CronBron }) => Promise<Record<string, unknown>>) {
  return async (request: Request): Promise<Response> => {
    const toegang = cronToegestaan(request.headers.get('authorization'), cronSecret());
    if (toegang === 'niet_ingericht') {
      return NextResponse.json({ error: 'CRON_SECRET is niet ingesteld.', code: 'niet_ingericht' }, { status: 503, headers: GEEN_CACHE });
    }
    if (toegang !== 'ok') {
      return NextResponse.json({ error: 'Niet toegestaan.', code: 'niet_ingelogd' }, { status: 401, headers: GEEN_CACHE });
    }
    const bron: CronBron = cronBron(request.url);
    try {
      const service = systeemClient('cron');
      const uitkomst = await fn(request, { service, bron });
      await logAudit(`cron_${naam}`, { bron, details: { status: String(uitkomst.status ?? 'ok') } });
      return NextResponse.json({ ok: true, ...uitkomst }, { headers: GEEN_CACHE });
    } catch (e) {
      logFout(`[cron] ${naam}`, e);
      return NextResponse.json({ ok: false, error: 'De taak is mislukt.' }, { status: 500, headers: GEEN_CACHE });
    }
  };
}
