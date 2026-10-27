import { bkRoute, fout, isUuid, json, leesJson } from '@/lib/boekhouding/api';
import { vandaagNL } from '@/lib/boekhouding/kern/periode';
import { koppelBronVoor } from '@/lib/boekhouding/kern/afletteren';
import { boekingAlsInvoer, parseBoekingInvoer, vergrendelFout } from '@/lib/boekhouding/model';
import { boekingExcl } from '@/lib/boekhouding/kern/activeren';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/boekhouding/boekingen/[id]  (velden optioneel, zoals bij POST) → { boeking }
//   In een vergrendelde periode mogen alleen omschrijving, tegenpartij, notities en status.
export const PATCH = bkRoute(async (request, ctx: Ctx, { repo }) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze boeking bestaat niet (meer).');
  const [bestaand, stam, body, koppelingen, activa] = await Promise.all([repo.boeking(id), repo.stamdata(), leesJson(request), repo.koppelingen(), repo.activa()]);
  if (!bestaand) return fout(404, 'Deze boeking bestaat niet (meer).');
  const p = parseBoekingInvoer({ ...boekingAlsInvoer(bestaand), ...body }, stam, { vandaag: vandaagNL() });
  if (!p.ok) return json({ error: p.fout, veld: p.veld }, 400);
  const slot = vergrendelFout(bestaand, p.waarde, stam.vergrendeling);
  if (slot) return fout(409, slot, 'periode_vergrendeld');
  // Een gekoppelde betaling: soort, richting, bedrag en bank liggen vast zolang de koppeling er is.
  const eigen = koppelingen.filter((k) => k.boekingId === id);
  if (eigen.length) {
    const nieuw = { ...bestaand, ...p.waarde };
    if (koppelBronVoor(nieuw) !== eigen[0].bron || nieuw.richting !== bestaand.richting || nieuw.bedrag !== bestaand.bedrag || nieuw.isExcl !== bestaand.isExcl || nieuw.rekeningId !== bestaand.rekeningId) {
      return fout(409, 'Deze regel is gekoppeld aan een factuur of bonnetje. Ontkoppel eerst om soort, bedrag of bank te wijzigen.', 'gekoppeld');
    }
  }
  // Geactiveerd (activum met deze regel als bron): het blijft een uitgave en het bedrag excl.
  // btw moet de aanschafprijs blijven dekken.
  const eigenActiva = activa.filter((a) => a.boekingId === id);
  if (eigenActiva.length) {
    const nieuw = { ...bestaand, ...p.waarde };
    const nodig = eigenActiva.reduce((t, a) => t + a.aanschaf, 0);
    if (nieuw.soort !== 'uitgave' || nieuw.richting !== 'af' || boekingExcl(nieuw) < nodig || nieuw.datum !== bestaand.datum) {
      return fout(409, `Deze regel is geactiveerd (${eigenActiva.map((a) => a.omschrijving).join(', ')}). Pas eerst het activum aan of verwijder het om soort, datum of bedrag te wijzigen.`, 'geactiveerd');
    }
  }
  const boeking = await repo.boekingWijzigen(id, p.waarde);
  return json({ boeking });
});

// DELETE /api/boekhouding/boekingen/[id]  { reden } → { ok }
//   Bewaarplicht: de regel wordt gemarkeerd als verwijderd (met reden), niet echt gewist.
export const DELETE = bkRoute(async (request, ctx: Ctx, { repo }) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze boeking bestaat niet (meer).');
  const body = await leesJson(request);
  const reden = typeof body.reden === 'string' ? body.reden.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (!reden) return json({ error: 'Geef een reden op (bv. "dubbel geboekt").', veld: 'reden' }, 400);
  const [bestaand, stam, activa] = await Promise.all([repo.boeking(id), repo.stamdata(), repo.activa()]);
  if (!bestaand) return fout(404, 'Deze boeking bestaat niet (meer).');
  const eigen = activa.filter((a) => a.boekingId === id);
  if (eigen.length) return fout(409, `Deze regel is geactiveerd (${eigen.map((a) => a.omschrijving).join(', ')}). Verwijder eerst het activum.`, 'geactiveerd');
  const slot = vergrendelFout(bestaand, null, stam.vergrendeling);
  if (slot) return fout(409, slot, 'periode_vergrendeld');
  await repo.boekingVerwijderen(id, reden);
  return json({ ok: true });
});
