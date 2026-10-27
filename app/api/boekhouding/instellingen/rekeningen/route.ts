import { bkRoute, fout, isUuid, json, leesJson } from '@/lib/boekhouding/api';
import { parseRekeningInvoer } from '@/lib/boekhouding/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/boekhouding/instellingen/rekeningen → { rekeningen }
export const GET = bkRoute(async (_request, _ctx, { repo }) => {
  const { rekeningen } = await repo.stamdata();
  return json({ rekeningen });
});

// POST /api/boekhouding/instellingen/rekeningen  { naam, iban?, importFormaat?, beginsaldo?, begindatum? }
//   → { rekening }  (krijgt een eigen grootboekrekening 11xx)
export const POST = bkRoute(async (request, _ctx, { repo }) => {
  const p = parseRekeningInvoer(await leesJson(request), true);
  if (!p.ok) return json({ error: p.fout, veld: p.veld }, 400);
  const w = p.waarde;
  const rekening = await repo.rekeningToevoegen({
    naam: w.naam!,
    iban: w.iban ?? null,
    importFormaat: w.importFormaat ?? 'generiek',
    beginsaldo: w.beginsaldo ?? 0,
    begindatum: w.begindatum ?? null
  });
  return json({ rekening }, 201);
});

// PATCH /api/boekhouding/instellingen/rekeningen  { id, naam?, iban?, importFormaat?, beginsaldo?,
//   begindatum?, actief?, standaard?: true } → { rekening }
export const PATCH = bkRoute(async (request, _ctx, { repo }) => {
  const body = await leesJson(request);
  if (!isUuid(body.id)) return fout(404, 'Die rekening bestaat niet (meer).');
  const { rekeningen } = await repo.stamdata();
  const huidig = rekeningen.find((r) => r.id === body.id);
  if (!huidig) return fout(404, 'Die rekening bestaat niet (meer).');
  const p = parseRekeningInvoer({ ...body, begindatum: body.begindatum === undefined && body.beginsaldo !== undefined ? huidig.begindatum : body.begindatum }, false);
  if (!p.ok) return json({ error: p.fout, veld: p.veld }, 400);
  if (p.waarde.actief === false && (huidig.standaard || body.standaard === true)) {
    return fout(400, 'Maak eerst een andere rekening de standaard voordat je deze uitzet.', 'standaard');
  }
  let rekening = huidig;
  if (Object.keys(p.waarde).length) rekening = await repo.rekeningWijzigen(huidig.id, p.waarde);
  if (body.standaard === true && !huidig.standaard) {
    await repo.standaardRekening(huidig.id);
    rekening = { ...rekening, standaard: true };
  }
  return json({ rekening });
});
