import { cronRoute } from '@/lib/auth/cron';
import { heartbeat, synchroniseerBestanden } from '@/lib/backup/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Storage-bestanden (facturen-PDF's, bonnetjes, social-assets) versleuteld en incrementeel
// naar Drive (Vercel Cron, dagelijks 04:30 UTC). Een nieuwe ronde start als de vorige
// geslaagde ouder is dan 6 dagen (dus wekelijks); een onafgemaakte ronde gaat elke dag
// verder (max. 240 s per keer). Alleen met CRON_SECRET (lib/auth/cron.ts). Ook dit telt als
// activiteit voor de keep-alive.
export const GET = cronRoute('bestanden', async (_request, { service, bron }) => {
  const hb = await heartbeat(service, bron);
  const r = await synchroniseerBestanden(service, { bron, budgetMs: 240_000 });
  return { status: r.status, heartbeat: hb, gesynchroniseerd: r.gesynchroniseerd, resterend: r.resterend, reden: r.reden };
});
