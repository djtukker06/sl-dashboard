import { bkRoute, json } from '@/lib/boekhouding/api';
import { activumToevoegenActie } from '@/lib/boekhouding/acties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/boekhouding/activa → { activa }
export const GET = bkRoute(async (_request, _ctx, { repo }) => json({ activa: await repo.activa() }));

// POST /api/boekhouding/activa  { omschrijving, categorie: '0210'|'0200', aanschafdatum,
//   ingebruikname?, aanschaf (excl. btw), restwaarde?, looptijdMaanden | jaren, uitgaveId? |
//   boekingId?, notities? } → { activum }
//   Met een bron (bonnetje of bankregel) is de aanschafdatum die van de aankoop; de
//   aanschafprijs mag niet hoger zijn dan het bedrag exclusief btw.
export const POST = bkRoute((request, _ctx, { repo }) => activumToevoegenActie(request, repo));
