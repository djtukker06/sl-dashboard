import { NextResponse } from 'next/server';
import { controleerRoute } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { vandaagNL } from '@/lib/invoice/nummer';
import { parseTerugkerend, type TerugkerendInvoer } from '@/lib/invoice/terugkerend-kern';
import { controleerMailbox, NA_0036, tabelOntbreekt, zonder0038 } from '@/lib/invoice/terugkerend-beheer';
import { kolomOntbreekt } from '@/lib/db/ontbreekt';
import { upsertKlant } from '@/lib/invoice/opslag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/terugkerend  { klant: { bedrijfsnaam, tav, adres, postcode }, naam, regels, interval, dag, volgendeDatum, eindDatum?,
//   versturen, emailAan, emailCc, mailboxId, onderwerp, bericht, btw… } → { id }
//   Een nieuwe terugkerende factuur (migratie 0036). De cron maakt hem aan op volgendeDatum.
//   De klantgegevens worden net als bij een gewone factuur bij de klant vastgelegd (upsert op naam).
export async function POST(request: Request) {
  const toegang = await controleerRoute(request);
  if ('antwoord' in toegang) return toegang.antwoord;
  const lid = toegang.lid;

  const body = ((await request.json().catch(() => null)) ?? {}) as TerugkerendInvoer;
  const p = parseTerugkerend(body, { vandaag: vandaagNL() });
  if (!p.ok) return NextResponse.json({ error: p.fout, veld: p.veld }, { status: 400 });
  const mailboxFout = await controleerMailbox(lid, p.waarde.sjabloon);
  if (mailboxFout) return NextResponse.json({ error: mailboxFout, veld: 'mailboxId' }, { status: 400 });

  const service = createServiceRoleClient(lid.bewijs);
  const klant = await upsertKlant(service, p.waarde.klant);
  if (!klant.ok) return NextResponse.json({ error: klant.fout }, { status: 500 });
  const rij = { ...p.waarde.sjabloon, client_id: klant.id, aangemaakt_door: lid.userId };
  const invoegen = (r: typeof rij) => service.from('terugkerende_facturen').insert(r).select('id').single();
  let { data, error } = await invoegen(rij);
  // Vóór 0038 bestaat de kolom akkoord_vereist nog niet: dan zonder akkoord vooraf.
  if (error && kolomOntbreekt(error)) ({ data, error } = await invoegen(zonder0038(rij)));
  if (error) {
    if (tabelOntbreekt(error)) return NextResponse.json({ error: NA_0036, code: 'tabel_ontbreekt' }, { status: 503 });
    if (error.code === '23503') return NextResponse.json({ error: 'Deze klant bestaat niet (meer).', veld: 'klantId' }, { status: 400 });
    console.error('[terugkerend] aanmaken mislukt', error.code ?? '', error.message);
    return NextResponse.json({ error: 'Opslaan mislukt.' }, { status: 500 });
  }
  return NextResponse.json({ id: (data as { id: string }).id }, { status: 201 });
}
