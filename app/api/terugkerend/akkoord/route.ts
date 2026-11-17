import { NextResponse } from 'next/server';
import { controleerRoute, isUuid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import { vandaagNL } from '@/lib/invoice/nummer';
import { akkoordStand } from '@/lib/invoice/terugkerend-kern';
import { SJABLOON_KOLOMMEN, type SjabloonRij } from '@/lib/invoice/terugkerend';
import { tabelOntbreekt } from '@/lib/invoice/terugkerend-beheer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: GEEN_CACHE });
const NA_0038 = 'Akkoord vooraf werkt zodra migratie 0038 is uitgevoerd (supabase/UITVOEREN_0038.sql).';

// Akkoord vooraf voor terugkerende facturen (migratie 0038).
// GET  → { gevraagd, wachtend }   voor de melding: sjablonen die binnen een week aan de beurt zijn
//        zonder akkoord, en facturen die al gemaakt zijn maar op akkoord wachten (niet verstuurd).
// POST { ids } → { ok, aantal }    akkoord voor de eerstvolgende periode van deze sjablonen.
export async function GET(request: Request) {
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const service = createServiceRoleClient(toegang.lid.bewijs);
  const vandaag = vandaagNL();
  const [sjablonen, facturen] = await Promise.all([
    service.from('terugkerende_facturen').select(SJABLOON_KOLOMMEN).eq('actief', true).limit(500),
    service.from('invoices').select('id, invoice_number, client_company_name, terugkerend_id').eq('wacht_op_akkoord', true).limit(200)
  ]);
  if (sjablonen.error || facturen.error) {
    const e = sjablonen.error ?? facturen.error;
    if (tabelOntbreekt(e) || kolomOntbreekt(e)) return json({ gevraagd: [], wachtend: [] });
    return json({ error: 'Ophalen mislukt.' }, 500);
  }
  const gevraagd = ((sjablonen.data ?? []) as unknown as SjabloonRij[])
    .filter((s) => akkoordStand(s, vandaag) === 'gevraagd')
    .sort((a, b) => a.volgende_datum.localeCompare(b.volgende_datum))
    .map((s) => ({ id: s.id, naam: s.naam, datum: s.volgende_datum }));
  const wachtend = ((facturen.data ?? []) as { id: string; invoice_number: string; client_company_name: string; terugkerend_id: string | null }[]).map((f) => ({
    id: f.id,
    nummer: f.invoice_number,
    klant: f.client_company_name,
    sjabloon: f.terugkerend_id
  }));
  return json({ gevraagd, wachtend });
}

export async function POST(request: Request) {
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter(isUuid).slice(0, 200) : [];
  if (!ids.length) return json({ error: 'Kies minstens één terugkerende factuur.' }, 400);
  const service = createServiceRoleClient(toegang.lid.bewijs);
  const { data, error } = await service.from('terugkerende_facturen').select('id, volgende_datum').in('id', ids).eq('actief', true);
  if (error) return json({ error: 'Ophalen mislukt.' }, 500);
  const nu = new Date().toISOString();
  let aantal = 0;
  for (const s of (data ?? []) as { id: string; volgende_datum: string }[]) {
    const { error: e } = await service
      .from('terugkerende_facturen')
      .update({ akkoord_periode: s.volgende_datum, akkoord_door: toegang.lid.userId, akkoord_op: nu })
      .eq('id', s.id)
      // Alleen als de geplande datum intussen niet is veranderd.
      .eq('volgende_datum', s.volgende_datum);
    if (e) return kolomOntbreekt(e) ? json({ error: NA_0038, code: 'kolom_ontbreekt' }, 503) : json({ error: 'Opslaan mislukt.' }, 500);
    aantal++;
  }
  return json({ ok: true, aantal });
}
