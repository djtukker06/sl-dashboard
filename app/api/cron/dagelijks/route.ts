import { cronRoute } from '@/lib/auth/cron';
import { logFout } from '@/lib/log';
import { dbBackupNodig, heartbeat, maakDbBackup, opruimen } from '@/lib/backup/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Dagelijkse taak (Vercel Cron 03:00 UTC; GitHub Actions elke 3 dagen als vangnet, ?bron=github).
// Alleen met "Authorization: Bearer <CRON_SECRET>" (lib/auth/cron.ts).
//   1. keep-alive: altijd eerst een kleine schrijfactie (heartbeat), zodat het gratis
//      Supabase-project nooit pauzeert. Werkt ook vóór migratie 0026 (dan een leesquery);
//   2. opruimen: heartbeat, inlogpogingen, oude audit-regels;
//   3. database-back-up eens per 3 dagen: alleen als de laatste geslaagde ouder is dan ~3 dagen
//      (anders overgeslagen). De keep-alive (stap 1) blijft wél elke nacht draaien.
export const GET = cronRoute('dagelijks', async (_request, { service, bron }) => {
  const hb = await heartbeat(service, bron);
  await opruimen(service);

  let backup: Record<string, unknown>;
  try {
    const nodig = await dbBackupNodig(service);
    if (nodig === 'migratie_ontbreekt') backup = { status: 'migratie_ontbreekt' };
    else if (!nodig) backup = { status: 'overgeslagen', reden: 'laatste back-up is nog geen 3 dagen oud' };
    else {
      const r = await maakDbBackup(service, { bron });
      backup = { status: r.status, bestand: r.bestand, grootte: r.grootte, reden: r.reden };
    }
  } catch (e) {
    // De heartbeat is al gelukt; een back-upfout staat in backup_runs/de logs.
    logFout('[cron] back-up', e);
    backup = { status: 'mislukt' };
  }
  return { status: backup.status === 'mislukt' ? 'backup_mislukt' : 'ok', heartbeat: hb, backup };
});
