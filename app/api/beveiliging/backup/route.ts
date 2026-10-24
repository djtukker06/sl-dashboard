import { NextResponse } from 'next/server';
import { eigenaarRoute } from '@/lib/auth/team';
import { binnenGebruikslimiet } from '@/lib/auth/inlogpogingen';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { backupStatus } from '@/lib/backup/status';
import { maakDbBackup, synchroniseerBestanden } from '@/lib/backup/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

// Eigenaar (met 2FA-sessie):
//   GET   status van back-ups en keep-alive (blok "Back-ups" op /beveiliging)
//   POST  { soort: 'db' }        "Nu back-up maken" (database, versleuteld naar Drive)
//         { soort: 'bestanden' } bestanden nu synchroniseren (start een ronde of gaat verder)
// Maximaal 3 keer per uur. Herkomstcheck via eigenaarRoute → teamlidRoute.
export const GET = eigenaarRoute(async (_request, _ctx, lid) => {
  return NextResponse.json(await backupStatus(lid.sb), { headers: GEEN_CACHE });
}, { label: 'backup' });

export const POST = eigenaarRoute(async (request, _ctx, lid) => {
  const body = (await request.json().catch(() => null)) as { soort?: unknown } | null;
  const soort = body?.soort === 'bestanden' ? 'bestanden' : 'db';
  if (!binnenGebruikslimiet(`backup:${soort}:${lid.userId}`, 3)) {
    return NextResponse.json({ error: 'Je hebt dit het afgelopen uur al 3 keer gedaan. Probeer het later opnieuw.' }, { status: 429, headers: GEEN_CACHE });
  }
  const service = createServiceRoleClient(lid.bewijs);
  if (soort === 'bestanden') {
    const r = await synchroniseerBestanden(service, { bron: 'handmatig', door: lid.userId, budgetMs: 240_000, forceer: true });
    if (r.status === 'migratie_ontbreekt') return NextResponse.json({ error: 'Voer eerst supabase/UITVOEREN_0026.sql uit.' }, { status: 409, headers: GEEN_CACHE });
    if (r.status === 'mislukt') return NextResponse.json({ error: r.fout ?? 'Synchroniseren mislukt.', uitkomst: r }, { status: 502, headers: GEEN_CACHE });
    return NextResponse.json({ ok: true, uitkomst: r }, { headers: GEEN_CACHE });
  }
  const r = await maakDbBackup(service, { bron: 'handmatig', door: lid.userId });
  if (r.status === 'migratie_ontbreekt') return NextResponse.json({ error: 'Voer eerst supabase/UITVOEREN_0026.sql uit.' }, { status: 409, headers: GEEN_CACHE });
  if (r.status === 'overgeslagen') return NextResponse.json({ error: 'Er loopt al een back-up. Wacht even en ververs.' }, { status: 409, headers: GEEN_CACHE });
  if (r.status === 'mislukt') return NextResponse.json({ error: r.fout ?? 'Back-up mislukt.', uitkomst: r }, { status: 502, headers: GEEN_CACHE });
  return NextResponse.json({ ok: true, uitkomst: r }, { headers: GEEN_CACHE });
}, { label: 'backup' });
