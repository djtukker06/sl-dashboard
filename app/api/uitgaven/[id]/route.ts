import { dbFout, fout, isUuid, json, leesJson, uitgavenRoute } from '@/lib/uitgaven/api';
import type { UitgaveInvoer } from '@/lib/uitgaven/model';
import { verwijder } from '@/lib/uitgaven/opslag';
import {
  bestandenVan,
  metKolommen,
  moetUitgave,
  naarUitgave,
  parseInvoer,
  zonderSoortAlsNodig,
  type UitgaveRij
} from '@/lib/uitgaven/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/uitgaven/[id] → { uitgave }
export const GET = uitgavenRoute(async (_request, ctx: Ctx, sb) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze uitgave bestaat niet (meer).');
  const { uitgave } = await moetUitgave(sb, id);
  return json({ uitgave });
});

// PATCH /api/uitgaven/[id]  (alle velden optioneel) → { uitgave }
export const PATCH = uitgavenRoute(async (request, ctx: Ctx, sb) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze uitgave bestaat niet (meer).');
  const body = (await leesJson(request)) as UitgaveInvoer;
  const p = parseInvoer(body);
  if (!p.ok) return fout(400, p.fout);

  const { uitgave } = await moetUitgave(sb, id);
  const status = (p.waarde.status as string | undefined) ?? uitgave.status;
  const datum = 'expense_date' in p.waarde ? p.waarde.expense_date : uitgave.datum;
  const totaal = 'total_amount' in p.waarde ? p.waarde.total_amount : uitgave.totaal;
  if (status === 'verwerkt' && (!datum || totaal === null || totaal === undefined)) {
    return fout(400, 'Vul eerst een datum en een bedrag in voordat je de uitgave op verwerkt zet.');
  }
  // Wie zelf iets invult, vervangt de melding van het uitlezen.
  const kolommen = { ...p.waarde, ...(uitgave.aiStatus === 'mislukt' ? { ai_message: '' } : {}) };

  const { data, error } = await metKolommen((k, metSoort) =>
    sb
      .from('expenses')
      // Alleen "soort" gewijzigd vóór migratie 0021: dan blijft er niets over; raak dan alleen updated_at aan.
      .update({ updated_at: new Date().toISOString(), ...zonderSoortAlsNodig(kolommen, metSoort) })
      .eq('id', id)
      .select(k)
      .maybeSingle()
  );
  if (error) throw dbFout(error);
  if (!data) return fout(404, 'Deze uitgave bestaat niet (meer).');
  return json({ uitgave: naarUitgave(data as unknown as UitgaveRij) });
});

// DELETE /api/uitgaven/[id] → { ok: true }   (verwijdert ook de bestanden uit de opslag)
export const DELETE = uitgavenRoute(async (_request, ctx: Ctx, sb) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Deze uitgave bestaat niet (meer).');
  const bestanden = await bestandenVan(sb, id);
  const { data, error } = await sb.from('expenses').delete().eq('id', id).select('id');
  if (error) throw dbFout(error);
  if (!data?.length) return fout(404, 'Deze uitgave bestaat niet (meer).');
  // Eerst de rij (cascade naar expense_files), dan de bestanden: mislukt dat laatste, dan
  // blijft er hooguit een los bestand achter (gelogd), nooit een uitgave zonder bonnetje.
  await verwijder(bestanden.map((b) => b.storage_path));
  return json({ ok: true });
});
