import { driveRoute, json } from '@/lib/drive/api';
import { driveStatus } from '@/lib/drive/koppeling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/drive/status → DriveStatus (ingericht, gekoppeld, account, eigenaar). Nooit tokens.
export const GET = driveRoute(async (_request, _ctx, lid) => json(await driveStatus(lid)));
