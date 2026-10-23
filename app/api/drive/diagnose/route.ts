import { driveRoute, json } from '@/lib/drive/api';
import { diagnoseDrive } from '@/lib/drive/diagnose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/drive/diagnose (alleen de eigenaar) → { ok, stappen: [{ naam, uitkomst, tekst, link }], duurMs }
// "Test Drive-koppeling": controleert env, koppeling/token, de hoofdmap en de vaste mappen
// (maakt ontbrekende aan), zonder een bestand te uploaden. POST omdat er mappen kunnen
// ontstaan (en zodat de herkomstcontrole van controleerRoute geldt).
export const POST = driveRoute(async (_request, _ctx, lid) => json(await diagnoseDrive(lid.bewijs)), { alleenEigenaar: true });
