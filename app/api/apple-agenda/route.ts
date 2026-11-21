import { teamlidRoute } from '@/lib/auth/team';
import { leesBody } from '@/lib/agenda/api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { appleStatus, koppelAccount, normAppWachtwoord, normAppleId } from '@/lib/apple-agenda/koppeling';
import { appleFoutAntwoord, fout, json } from '@/lib/apple-agenda/api';
import type { ExternStatus } from '@/lib/agenda/extern-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function status(service: ReturnType<typeof createServiceRoleClient>, userId: string): Promise<ExternStatus> {
  const s = await appleStatus(service, userId);
  return { apple: s.status, google: null, accounts: s.accounts };
}

// GET /api/apple-agenda → ExternStatus: je gekoppelde Apple ID's en hun agenda's. Nooit wachtwoorden.
export const GET = teamlidRoute(async (_request, _ctx, lid) => {
  try {
    return json(await status(createServiceRoleClient(lid.bewijs), lid.userId));
  } catch (e) {
    return appleFoutAntwoord(e);
  }
}, { label: 'apple-agenda' });

// POST /api/apple-agenda  { appleId, wachtwoord } → ExternStatus
// Koppelen (of opnieuw koppelen) met een app-specifiek wachtwoord. Het wachtwoord gaat
// alleen naar iCloud en wordt versleuteld bewaard; het komt nooit meer terug naar de browser.
export const POST = teamlidRoute(async (request, _ctx, lid) => {
  const body = await leesBody<{ appleId?: unknown; wachtwoord?: unknown }>(request);
  const appleId = normAppleId(body?.appleId);
  if (!appleId) return fout(400, 'Vul je Apple ID in (het e-mailadres waarmee je inlogt op je iPhone).');
  const wachtwoord = normAppWachtwoord(body?.wachtwoord);
  if (!wachtwoord) return fout(400, 'Vul het app-specifieke wachtwoord in: vier groepjes van vier letters (xxxx-xxxx-xxxx-xxxx).');
  const service = createServiceRoleClient(lid.bewijs);
  try {
    await koppelAccount(service, lid.userId, appleId, wachtwoord);
    return json(await status(service, lid.userId));
  } catch (e) {
    return appleFoutAntwoord(e);
  }
}, { label: 'apple-agenda' });
