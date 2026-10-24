import { isUuid } from '@/lib/agenda/invoer';
import { OPVOLG_KOLOMMEN, parseKlant } from '@/lib/crm/invoer';
import { OPVOLGEN_NA_0025, crmFout, klantOphalen } from '@/lib/crm/repo';
import { KLANT_STATUS_LABEL, type KlantInvoer, type KlantStatus } from '@/lib/crm/types';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import { CRM_NIET_INGERICHT } from '@/lib/agenda/repo';
import { fout, foutAntwoord, json, leesBody, metSessie } from '@/lib/agenda/api';
import { naKlantWijziging } from '@/lib/drive/na';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/klanten/[id]  { naam?, contactpersoon?, email?, telefoon?, adres?, postcode?, status?,
//                            volgendeStap?, opvolgenOp? } → { klant }
// Verwijderen kan hier bewust niet (dat blijft in Facturen, met de controle op bestaande
// facturen). Een statuswijziging komt (na 0025) als regel "Lead → Actief" in de tijdlijn.
// Volgende stap/opvolgdatum vóór 0025: een nette 503 'kolom_ontbreekt'.
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
    // Oude status (alleen als die verandert), voor de regel in de tijdlijn.
    let oud: KlantStatus | null = null;
    if (k.waarde.status) {
      const r = await s.sb.from('clients').select('status').eq('id', id).maybeSingle();
      if (r.error) throw crmFout(r.error);
      if (!r.data) return fout(404, 'Klant niet gevonden.');
      oud = r.data.status as KlantStatus;
    }
    const { data, error } = await s.sb.from('clients').update(k.waarde).eq('id', id).select('id').maybeSingle();
    if (error) {
      if (error.code === '23505') return fout(409, 'Er bestaat al een klant met die naam.');
      if (kolomOntbreekt(error) && OPVOLG_KOLOMMEN.some((c) => c in k.waarde)) return fout(503, OPVOLGEN_NA_0025, 'kolom_ontbreekt');
      throw crmFout(error);
    }
    if (!data) return fout(404, 'Klant niet gevonden.');
    const nieuw = k.waarde.status;
    if (nieuw && oud && nieuw !== oud && oud in KLANT_STATUS_LABEL) {
      // Best effort: vóór 0025 (geen kolom soort) gewoon overslaan, geen losse notitie.
      const { error: e2 } = await s.sb
        .from('client_notes')
        .insert({ client_id: id, tekst: `${KLANT_STATUS_LABEL[oud]} → ${KLANT_STATUS_LABEL[nieuw]}`, soort: 'status', created_by: s.bron.userId });
      if (e2 && !kolomOntbreekt(e2)) console.error('[klanten] statusregel', e2.message);
    }
    const klant = await klantOphalen(s.bron, id);
    if (!klant) return fout(404, 'Klant niet gevonden.');
    // Nieuwe naam: de klantmap in Google Drive meenemen (ná het antwoord, best effort).
    if (k.waarde.company_name !== undefined) naKlantWijziging(s.lid, id);
    return json({ klant });
  } catch (e) {
    return foutAntwoord(e);
  }
}
