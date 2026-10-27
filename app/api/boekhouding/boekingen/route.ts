import { bkRoute, fout, json, leesJson } from '@/lib/boekhouding/api';
import { vandaagNL } from '@/lib/boekhouding/kern/periode';
import { parseBoekingInvoer, vergrendelFout } from '@/lib/boekhouding/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/boekhouding/boekingen → { modus, boekingen }   (alle niet-verwijderde regels)
export const GET = bkRoute(async (_request, _ctx, { repo }) => {
  const boekingen = await repo.boekingen();
  return json({ modus: repo.modus, boekingen });
});

// POST /api/boekhouding/boekingen  { rekeningId?, datum, omschrijving, soort, richting?, bedrag,
//   isExcl?, btwCode, btwHandmatig?, grootboek?, vennootId?, tegenpartij?, notities? } → { boeking }
//   De btw en het kwartaal rekent de server zelf uit (lib/boekhouding/model.ts).
export const POST = bkRoute(async (request, _ctx, { repo }) => {
  const body = await leesJson(request);
  const stam = await repo.stamdata();
  const p = parseBoekingInvoer(body, stam, { vandaag: vandaagNL() });
  if (!p.ok) return json({ error: p.fout, veld: p.veld }, 400);
  const slot = vergrendelFout(null, p.waarde, stam.vergrendeling);
  if (slot) return fout(409, slot, 'periode_vergrendeld');
  const boeking = await repo.boekingToevoegen(p.waarde);
  return json({ boeking }, 201);
});
