import { bkRoute, fout, json } from '@/lib/boekhouding/api';
import { demoHerstellen } from '@/lib/boekhouding/repo/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/boekhouding/demo/herstel → { ok }   Alleen in de demo-modus: zet de voorbeeld-
// gegevens van dit teamlid terug. In de echte boekhouding gebeurt er niets (409).
export const POST = bkRoute(async (_request, _ctx, { lid, repo }) => {
  if (repo.modus !== 'demo') return fout(409, 'De boekhouding draait niet in de demo-modus.', 'geen_demo');
  demoHerstellen(lid.userId);
  return json({ ok: true });
});
