import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { dbFout, fout, isUuid, json, leesJson, uitgavenRoute } from '@/lib/uitgaven/api';
import { isDatum, isSoort, type UitgaveInvoer } from '@/lib/uitgaven/model';
import { bekijkUrls } from '@/lib/uitgaven/opslag';
import {
  metKolommen,
  naarUitgave,
  parseInvoer,
  uitgavenInPeriode,
  voorbeeldPaden,
  zoekUitgaven,
  zonderSoortAlsNodig,
  type UitgaveRij
} from '@/lib/uitgaven/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const geheel = (v: string | null) => (v && /^\d{1,4}$/.test(v) ? Number(v) : null);

// GET /api/uitgaven?q=&jaar=&maand=&soort=&door=  → { uitgaven, voorbeelden, totaal, vandaag }
//   Zoeken in het hele archief (max. 200 resultaten), nieuwste eerst. `voorbeelden` zijn
//   signed URL's (10 min) van de eerste foto per uitgave, voor de galerij.
// GET /api/uitgaven?van=YYYY-MM-DD&tot=YYYY-MM-DD  → { uitgaven, vandaag }   (periode; oude vorm)
export const GET = uitgavenRoute(async (request, _ctx, sb) => {
  const sp = new URL(request.url).searchParams;
  const van = sp.get('van');
  const tot = sp.get('tot');
  if (van !== null || tot !== null) {
    if (!isDatum(van) || !isDatum(tot) || van > tot) return fout(400, 'Ongeldige periode.');
    const uitgaven = await uitgavenInPeriode(sb, van, tot);
    return json({ uitgaven, vandaag: vandaagNL() });
  }

  const soort = sp.get('soort');
  const door = sp.get('door');
  const q = (sp.get('q') ?? '').slice(0, 300);
  if (soort && !isSoort(soort)) return fout(400, 'Onbekende soort.');
  if (door && !isUuid(door)) return fout(400, 'Onbekende uploader.');
  const { uitgaven, rijen, totaal } = await zoekUitgaven(sb, {
    q,
    jaar: geheel(sp.get('jaar')),
    maand: geheel(sp.get('maand')),
    soort: isSoort(soort) ? soort : null,
    door: door || null
  });

  const paden = voorbeeldPaden(rijen);
  const urls = await bekijkUrls([...paden.values()]);
  const voorbeelden: Record<string, string> = {};
  for (const [id, pad] of paden) {
    const url = urls.get(pad);
    if (url) voorbeelden[id] = url;
  }
  return json({ uitgaven, voorbeelden, totaal, vandaag: vandaagNL() });
});

// POST /api/uitgaven  { datum?, leverancier?, …, totaal? } → { uitgave }  (handmatig, zonder bonnetje)
export const POST = uitgavenRoute(async (request, _ctx, sb, lid) => {
  const body = (await leesJson(request)) as UitgaveInvoer;
  const p = parseInvoer({ ...body, aiVelden: [] });
  if (!p.ok) return fout(400, p.fout);
  if (p.waarde.status === 'verwerkt' && (!p.waarde.expense_date || p.waarde.total_amount == null)) {
    return fout(400, 'Vul eerst een datum en een bedrag in.');
  }
  const { data, error } = await metKolommen((k, metSoort) =>
    sb
      .from('expenses')
      .insert({ ...zonderSoortAlsNodig(p.waarde, metSoort), source: 'handmatig', created_by: lid.userId })
      .select(k)
      .single()
  );
  if (error) throw dbFout(error);
  return json({ uitgave: naarUitgave(data as unknown as UitgaveRij) }, 201);
});
