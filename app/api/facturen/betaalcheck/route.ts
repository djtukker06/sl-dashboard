import { NextResponse } from 'next/server';
import { controleerRoute, type Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import { isUuid } from '@/lib/boekhouding/api';
import { betaalOverzicht } from '@/lib/boekhouding/betaalstatus';
import { teChecken, verstuurdOp, volgendeCheck, type CheckFactuur } from '@/lib/boekhouding/kern/betaalcheck';
import { datumNL, isDatum } from '@/lib/boekhouding/kern/periode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Betaalcheck (migratie 0037): een week na versturen vraagt de app "Is factuur … betaald?".
// Alleen voor teamleden met het vinkje Boekhouding; anders 403 (de pop-up blijft dan weg).
//
// GET  → { items: [{ id, nummer, klant, totaal, open, deels, verstuurd }], rekeningen, vandaag, na0037 }
//        De facturen die nu nagevraagd moeten worden, oudste eerst (lib/boekhouding/kern/betaalcheck.ts).
// POST { id } → { volgendeCheck }   "Nee": over 7 dagen opnieuw vragen (invoices.betaalcheck_na).
//        Vóór 0037 → 503 met code 'kolom_ontbreekt' (de pop-up onthoudt het dan op dit apparaat).
//
// Betaald boeken gaat niet hier, maar via POST /api/boekhouding/koppelingen/betaald.

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: GEEN_CACHE });
const NA_0037 = 'Onthouden kan pas na migratie 0037: voer in Supabase supabase/UITVOEREN_0037.sql uit.';

type Extra = { id: string; verzonden_op?: string | null; betaalcheck_na?: string | null; wacht_op_akkoord?: boolean | null };

/** verzonden_op, betaalcheck_na en wacht_op_akkoord per factuur; zonder kolom (vóór 0036/0037/0038) gewoon leeg. */
async function leesExtra(sb: Teamlid['sb']) {
  for (const kolommen of ['id, verzonden_op, betaalcheck_na, wacht_op_akkoord', 'id, verzonden_op, betaalcheck_na', 'id, verzonden_op']) {
    const { data, error } = await sb.from('invoices').select(kolommen).limit(10000);
    if (!error) return { rijen: (data ?? []) as unknown as Extra[], na0037: kolommen.includes('betaalcheck_na') };
    if (!kolomOntbreekt(error)) throw error;
  }
  return { rijen: [] as Extra[], na0037: false };
}

const dag = (v: unknown) => {
  if (typeof v !== 'string' || !v) return null;
  if (isDatum(v)) return v;
  try {
    return datumNL(v);
  } catch {
    return null;
  }
};

export async function GET(request: Request) {
  const c = await controleerRoute(request);
  if ('antwoord' in c) return c.antwoord;
  if (!c.lid.boekhouding) return json({ error: 'Je hebt geen toegang tot de boekhouding.', code: 'geen_boekhouding' }, 403);
  const overzicht = await betaalOverzicht(c.lid);
  if (!overzicht) return json({ items: [], rekeningen: [], vandaag: null, na0037: false });
  let extra: Awaited<ReturnType<typeof leesExtra>>;
  try {
    extra = await leesExtra(c.lid.sb);
  } catch (e) {
    console.error('[betaalcheck] lezen mislukt', (e as { code?: string }).code ?? '');
    return json({ error: 'Er ging iets mis.' }, 500);
  }
  const perId = new Map(extra.rijen.map((r) => [r.id, r]));
  // Een terugkerende factuur die nog op akkoord wacht, is niet verstuurd: dan ook niet naar betaling vragen.
  const kandidaten: (CheckFactuur & { nummer: string; klant: string })[] = overzicht.facturen.filter((f) => !perId.get(f.id)?.wacht_op_akkoord).map((f) => ({
    id: f.id,
    nummer: f.nummer,
    klant: f.klant,
    datum: f.datum,
    verzonden: dag(perId.get(f.id)?.verzonden_op),
    checkNa: dag(perId.get(f.id)?.betaalcheck_na),
    totaal: f.totaal
  }));
  const items = teChecken(kandidaten, overzicht.info, overzicht.vandaag).map((f) => {
    const i = overzicht.info.get(f.id)!;
    return { id: f.id, nummer: f.nummer, klant: f.klant, totaal: f.totaal, open: i.open, deels: i.stand === 'deels', verstuurd: verstuurdOp(f) };
  });
  return json({ items, rekeningen: overzicht.rekeningen, vandaag: overzicht.vandaag, na0037: extra.na0037 });
}

export async function POST(request: Request) {
  const c = await controleerRoute(request);
  if ('antwoord' in c) return c.antwoord;
  const lid = c.lid;
  if (!lid.boekhouding) return json({ error: 'Je hebt geen toegang tot de boekhouding.', code: 'geen_boekhouding' }, 403);
  const body = ((await request.json().catch(() => null)) ?? {}) as { id?: unknown };
  if (!isUuid(body.id)) return json({ error: 'Kies een factuur.' }, 400);
  const na = volgendeCheck(datumNL(new Date()));
  // Schrijven naar invoices gaat via de service-role (geen update-policy, zie 0003), na de teamcheck.
  const service = createServiceRoleClient(lid.bewijs);
  const { data, error } = await service.from('invoices').update({ betaalcheck_na: na }).eq('id', body.id).select('id');
  if (error) {
    if (kolomOntbreekt(error)) return json({ error: NA_0037, code: 'kolom_ontbreekt' }, 503);
    console.error('[betaalcheck] uitstellen mislukt', error.code ?? '', error.message);
    return json({ error: 'Opslaan mislukt. Probeer het opnieuw.' }, 500);
  }
  if (!data || data.length === 0) return json({ error: 'Deze factuur bestaat niet (meer).' }, 404);
  return json({ volgendeCheck: na });
}
