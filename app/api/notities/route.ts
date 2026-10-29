import { isUuid, teamlidRoute } from '@/lib/auth/team';
import { NOTITIE_FILTERS, parseNotitie, type NotitieFilter } from '@/lib/notities/kern';
import { notitieMaken, notitiesLijst } from '@/lib/notities/repo';
import { fout, foutAntwoord, json, leesBody } from '@/lib/notities/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Scratchpad (migratie 0031). Elke route gaat via de teamcheck (teamlidRoute) en daarna de
// gebruikerscliënt: RLS laat gedeelde notities en je eigen privé-notities zien.
//   GET  /api/notities?q=&filter=alles|mijn|klant|project|prive&klant=<id>&project=<id>&limiet=
//        → { notities } (zonder inhoud; vastgepind eerst, dan laatst bewerkt)
//   POST /api/notities  { titel?, emoji?, inhoud?, klantId?, projectId?, prive? } → { notitie }

export const GET = teamlidRoute(
  async (request, _ctx, lid) => {
    const sp = new URL(request.url).searchParams;
    const filter = (sp.get('filter') || 'alles') as NotitieFilter;
    if (!NOTITIE_FILTERS.includes(filter)) return fout(400, 'Onbekend filter.');
    const klant = sp.get('klant');
    const project = sp.get('project');
    if ((klant && !isUuid(klant)) || (project && !isUuid(project))) return fout(400, 'Ongeldig filter.');
    const limiet = Math.min(500, Math.max(1, Number(sp.get('limiet')) || 300));
    try {
      const notities = await notitiesLijst(lid.sb, {
        q: (sp.get('q') || '').slice(0, 200),
        filter,
        klantId: klant,
        projectId: project,
        mijnId: lid.userId,
        limiet
      });
      return json({ notities });
    } catch (e) {
      return foutAntwoord(e);
    }
  },
  { label: 'notities' }
);

export const POST = teamlidRoute(
  async (request, _ctx, lid) => {
    const body = await leesBody(request);
    if (!body) return fout(400, 'Ongeldige invoer.');
    const p = parseNotitie(body, true);
    if (!p.ok) return fout(400, p.fout);
    try {
      return json({ notitie: await notitieMaken(lid.sb, p.waarde) }, 201);
    } catch (e) {
      return foutAntwoord(e);
    }
  },
  { label: 'notities' }
);
