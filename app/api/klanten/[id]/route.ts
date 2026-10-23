import { isUuid } from '@/lib/agenda/invoer';
import { parseKlant } from '@/lib/crm/invoer';
import { crmFout, klantOphalen } from '@/lib/crm/repo';
import type { KlantInvoer } from '@/lib/crm/types';
import { CRM_NIET_INGERICHT } from '@/lib/agenda/repo';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/klanten/[id]  { naam?, contactpersoon?, email?, telefoon?, adres?, postcode?, status? }
// → { klant }. Verwijderen kan hier bewust niet (dat blijft in Facturen, met de controle
// op bestaande facturen).
export async function PATCH(request: Request, ctx: Ctx) {
  const s = await metSessie(request);
  if ('antwoord' in s) return s.antwoord;
  if (!s.bron.team) return fout(503, CRM_NIET_INGERICHT, 'tabel_ontbreekt');

  const { id } = await ctx.params;
  if (!isUuid(id)) return fout(404, 'Klant niet gevonden.');
  const body = await leesBody<KlantInvoer>(request);
  if (!body) return fout(400, 'Ongeldige invoer.');
  const k = parseKlant(body, false);
  if (!k.ok) return fout(400, k.fout);

  try {
    const { data, error } = await s.sb.from('clients').update(k.waarde).eq('id', id).select('id').maybeSingle();
    if (error) {
      if (error.code === '23505') return fout(409, 'Er bestaat al een klant met die naam.');
      throw crmFout(error);
    }
    if (!data) return fout(404, 'Klant niet gevonden.');
    const klant = await klantOphalen(s.bron, id);
    if (!klant) return fout(404, 'Klant niet gevonden.');
    return json({ klant });
  } catch (e) {
    return foutAntwoord(e);
  }
}
