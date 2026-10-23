import { parseKlant } from '@/lib/crm/invoer';
import { crmFout } from '@/lib/crm/repo';
import type { KlantInvoer } from '@/lib/crm/types';
import { CRM_NIET_INGERICHT } from '@/lib/agenda/repo';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/klanten  { naam, contactpersoon?, email?, status? } → { klant: { id } }
// Snel een klant toevoegen (standaard status 'lead'). Gedeeld met het hele team; de
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
      throw crmFout(error);
    }
    return json({ klant: { id: data.id as string } }, 201);
  } catch (e) {
    return foutAntwoord(e);
  }
}
