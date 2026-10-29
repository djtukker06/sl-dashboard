import { isUuid, teamlidRoute } from '@/lib/auth/team';
import { parseNotitie, parseSinds } from '@/lib/notities/kern';
import { notitieOphalen, notitieVerwijderen, notitieWijzigen } from '@/lib/notities/repo';
import { fout, foutAntwoord, json, leesBody } from '@/lib/notities/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Eén notitie van de Scratchpad (migratie 0031); RLS beslist (gedeeld of je eigen privé).
//   GET     → { notitie } met de volledige inhoud (Tiptap-JSON)
//   PATCH   { titel?, emoji?, inhoud?, klantId?, projectId?, prive?, vastgepind?, verwijderd?: false, sinds? }
//           → { notitie } (zonder inhoud). Met sinds (bewerktOp zoals jij hem kent): 409 + de
//           huidige versie als een ander hem intussen wijzigde. Privé maken: alleen de maker.
//   DELETE  → zacht verwijderen (ongedaan maken: PATCH { verwijderd: false })

type Ctx = { params: Promise<{ id: string }> };

const NIET_GEVONDEN = 'Deze notitie bestaat niet (meer).';

export const GET = teamlidRoute(
  async (_request, ctx: Ctx, lid) => {
    const { id } = await ctx.params;
    if (!isUuid(id)) return fout(404, NIET_GEVONDEN, 'niet_gevonden');
    try {
      const notitie = await notitieOphalen(lid.sb, id);
      if (!notitie) return fout(404, NIET_GEVONDEN, 'niet_gevonden');
      return json({ notitie });
    } catch (e) {
      return foutAntwoord(e);
    }
  },
  { label: 'notities' }
);

export const PATCH = teamlidRoute(
  async (request, ctx: Ctx, lid) => {
    const { id } = await ctx.params;
    if (!isUuid(id)) return fout(404, NIET_GEVONDEN, 'niet_gevonden');
    const body = await leesBody(request);
    if (!body) return fout(400, 'Ongeldige invoer (of de notitie is te groot).');
    const p = parseNotitie(body, false);
    if (!p.ok) return fout(400, p.fout);
    try {
      return json({ notitie: await notitieWijzigen(lid.sb, id, p.waarde, parseSinds(body.sinds)) });
    } catch (e) {
      return foutAntwoord(e);
    }
  },
  { label: 'notities' }
);

export const DELETE = teamlidRoute(
  async (_request, ctx: Ctx, lid) => {
    const { id } = await ctx.params;
    if (!isUuid(id)) return fout(404, NIET_GEVONDEN, 'niet_gevonden');
    try {
      await notitieVerwijderen(lid.sb, id);
      return json({ ok: true });
    } catch (e) {
      return foutAntwoord(e);
    }
  },
  { label: 'notities' }
);
