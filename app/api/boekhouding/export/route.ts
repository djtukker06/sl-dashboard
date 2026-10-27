import { bkRoute } from '@/lib/boekhouding/api';
import { exportActie } from '@/lib/boekhouding/acties-jaar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/boekhouding/export?soort=boekingen|journaal|wv|balans|proefbalans|vennoten|xaf|pdf|aangifte&jaar=JJJJ[&kw=1-4]
//   Exports voor de boekhouder: CSV (Excel), XAF-auditfile, jaarrapport-PDF en de btw-aangifte als PDF.
export const GET = bkRoute(async (request, _ctx, { repo }) => exportActie(request, repo));
