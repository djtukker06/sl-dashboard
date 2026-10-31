import { OPVOLG_KOLOMMEN, parseKlant } from '@/lib/crm/invoer';
import { KOUD_NA_0033, OPVOLGEN_NA_0025, crmFout } from '@/lib/crm/repo';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import type { KlantInvoer } from '@/lib/crm/types';
import { CRM_NIET_INGERICHT } from '@/lib/agenda/repo';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/klanten  { naam, contactpersoon?, email?, status?, volgendeStap?, opvolgenOp? }
// → { klant: { id } }. Snel een klant toevoegen (alleen een naam is genoeg; standaard
// status 'lead'; 'koud' = Op de radar, vanaf 0033). Gedeeld met het hele team; de
// facturen zien dezelfde klant (zelfde tabel clients).
export async function POST(request: Request) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');

  const body = await leesBody<KlantInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const k = parseKlant(body, true);
  if (!k.ok) return fout(400, k.fout);

  try {
    const { data, error } = await s.sb.from('clients').insert(k.waarde).select('id').single();
    if (error) {
      if (error.code === '23505') return fout(409, 'Er bestaat al een klant met die naam.');
      // Vóór 0033 kent de check-constraint de status 'koud' (Op de radar) nog niet.
      if (error.code === '23514' && k.waarde.status === 'koud') return fout(503, KOUD_NA_0033, 'kolom_ontbreekt');
      if (kolomOntbreekt(error) && OPVOLG_KOLOMMEN.some((c) => c in k.waarde)) return fout(503, OPVOLGEN_NA_0025, 'kolom_ontbreekt');
      throw crmFout(error);
    }
    return json({ klant: { id: data.id as string } }, 201);
  } catch (e) {
    return foutAntwoord(e);
  }
}
