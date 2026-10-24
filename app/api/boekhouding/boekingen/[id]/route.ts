import { bkRoute, fout, isUuid, json, leesJson } from '@/lib/boekhouding/api';
import { vandaagNL } from '@/lib/boekhouding/kern/periode';
import { koppelBronVoor } from '@/lib/boekhouding/kern/afletteren';
import { boekingAlsInvoer, parseBoekingInvoer, vergrendelFout } from '@/lib/boekhouding/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/boekhouding/boekingen/[id]  (velden optioneel, zoals bij POST) → { boeking }
//   In een vergrendelde periode mogen alleen omschrijving, tegenpartij, notities en status.
export const PATCH = bkRoute(async (request, ctx: Ctx, { repo }) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze boeking bestaat niet (meer).');
  const [bestaand, stam, body, koppelingen] = await Promise.all([repo.boeking(id), repo.stamdata(), leesJson(request), repo.koppelingen()]);
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
  const [bestaand, stam] = await Promise.all([repo.boeking(id), repo.stamdata()]);
  if (!bestaand) return fout(404, 'Deze boeking bestaat niet (meer).');
  const slot = vergrendelFout(bestaand, null, stam.vergrendeling);
  if (slot) return fout(409, slot, 'periode_vergrendeld');
  await repo.boekingVerwijderen(id, reden);
  return json({ ok: true });
});
