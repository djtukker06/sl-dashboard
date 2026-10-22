import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { dbFout, fout, json, leesJson, uitgavenRoute } from '@/lib/uitgaven/api';
import { isDatum, type UitgaveInvoer } from '@/lib/uitgaven/model';
import { KOLOMMEN, naarUitgave, parseInvoer, uitgavenInPeriode, type UitgaveRij } from '@/lib/uitgaven/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/uitgaven?van=YYYY-MM-DD&tot=YYYY-MM-DD → { uitgaven, vandaag }
// Alle uitgaven met een datum in [van, tot] plus alle uitgaven zonder datum (concepten die
// nog gecontroleerd moeten worden). Zoeken en filteren gebeurt in de browser.
export const GET = uitgavenRoute(async (request, _ctx, sb) => {
  const sp = new URL(request.url).searchParams;
  const van = sp.get('van');
  const tot = sp.get('tot');
  if (!isDatum(van) || !isDatum(tot) || van > tot) return fout(400, 'Ongeldige periode.');
  const uitgaven = await uitgavenInPeriode(sb, van, tot);
  return json({ uitgaven, vandaag: vandaagNL() });
});

// POST /api/uitgaven  { datum?, leverancier?, …, totaal? } → { uitgave }  (handmatig, zonder bonnetje)
export const POST = uitgavenRoute(async (request, _ctx, sb) => {
  const body = (await leesJson(request)) as UitgaveInvoer;
  const p = parseInvoer({ ...body, aiVelden: [] });
  if (!p.ok) return fout(400, p.fout);
  if (p.waarde.status === 'verwerkt' && (!p.waarde.expense_date || p.waarde.total_amount == null)) {
    return fout(400, 'Vul eerst een datum en een bedrag in.');
  }
  const { data, error } = await sb
    .from('expenses')
    .insert({ ...p.waarde, source: 'handmatig' })
    .select(KOLOMMEN)
    .single();
  if (error) throw dbFout(error);
  return json({ uitgave: naarUitgave(data as unknown as UitgaveRij) }, 201);
});
